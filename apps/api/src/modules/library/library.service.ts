import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LIBRARY_CATEGORIES, LIBRARY_DOC, LibraryRead } from '@orvyn/contracts';
import { instantAt, wallIn } from '@orvyn/today-parse';
import { Queue, Worker } from 'bullmq';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { AiBadAnswer, AiOff, AiPaused, AiService, type Part } from '../ai/ai.service';
import { FilesService } from '../files/files.service';
import { NotifyService } from '../notify/notify.service';
import { deliveryFor } from '../notify/ways';
import { SERVER_DEVICE, serverOrigin, type SyncApplied, SyncService } from '../sync/sync.service';
import { todaySettings } from '../today/today.schema';
import { libraryDocs } from './library.schema';

type Job = { kind: 'read'; ownerId: string; docId: string } | { kind: 'expiry' };
type Doc = typeof libraryDocs.$inferSelect;
const QUEUE = 'library';
/** Days before the expiry date a reminder goes out (and 0 = the day itself). */
export const EXPIRY_LEAD_DAYS = [30, 7, 1, 0] as const;
/** Reminders go out from this hour (the person's time) so they don't land in the night. */
const REMIND_FROM_HOUR = 9;

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * Library (spec 0004): a document or note is added → the AI reads it (title, category, tags, summary, dates, amounts) →
 * its expiry date becomes reminders on every channel the person chose (D22) → an amount due is only ever a suggestion
 * the person taps to add to Money. Everything here is owner-scoped; text read from documents is data, never instructions.
 */
@Injectable()
export class LibraryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('library');
  private queue!: Queue<Job>;
  private worker?: Worker<Job>;
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly ai: AiService,
    private readonly files: FilesService,
    private readonly sync: SyncService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = { url: this.env.REDIS_URL };
    this.queue = new Queue<Job>(QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 15_000 },
        removeOnComplete: 100,
        removeOnFail: 300,
      },
    });
    if (this.env.PROCESS_ROLE !== 'api') {
      await this.queue.upsertJobScheduler(
        'library-expiry',
        { every: 3_600_000 },
        { name: 'expiry', data: { kind: 'expiry' } },
      );
      this.worker = new Worker<Job>(
        QUEUE,
        async (j) => {
          if (j.data.kind === 'read') await this.read(j.data.ownerId, j.data.docId);
          else await this.remindExpiries();
        },
        { connection, concurrency: 2 },
      );
      this.worker.on('failed', (j, e) => this.log.warn(`job ${j?.id} failed: ${e.message}`));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Tests (no worker): run what is waiting now. */
  async drain(): Promise<number> {
    let n = 0;
    for (;;) {
      const jobs = (await this.queue.getJobs(['waiting', 'prioritized'], 0, 50, true)).filter(
        (j) => !j.opts.delay && j.data.kind === 'read',
      );
      if (!jobs.length) return n;
      for (const j of jobs) {
        await j.remove().catch(() => undefined);
        if (j.data.kind === 'read') await this.read(j.data.ownerId, j.data.docId);
        n++;
      }
    }
  }

  @OnEvent('sync.applied', { async: true, promisify: true })
  async onSync(e: SyncApplied): Promise<void> {
    if (e.entity !== LIBRARY_DOC || e.op !== 'upsert') return;
    const doc = await this.doc(e.ownerId, e.entityId);
    if (!doc) return;
    if (!serverOrigin.getStore() && doc.status === 'new')
      await this.queue.add(
        'read',
        { kind: 'read', ownerId: e.ownerId, docId: doc.id },
        { jobId: `r-${doc.id}-${Date.now()}` },
      );
    // a date or switch the person just changed: look again at what is due
    if (!serverOrigin.getStore() && (doc.expiresOn || doc.status === 'ready'))
      await this.remindExpiries(e.ownerId).catch(() => undefined);
  }

  private async doc(ownerId: string, id: string): Promise<Doc | null> {
    const [r] = await this.db
      .select()
      .from(libraryDocs)
      .where(and(eq(libraryDocs.id, id), eq(libraryDocs.ownerId, ownerId), isNull(libraryDocs.deletedAt)));
    return r ?? null;
  }

  private async write(ownerId: string, id: string, fields: Record<string, unknown>): Promise<void> {
    const p = await this.access.principal(ownerId);
    if (!p) return;
    await this.sync.pushAsServer(
      { userId: ownerId, deviceId: SERVER_DEVICE, role: p.role, entitlements: p.entitlements },
      [{ entity: LIBRARY_DOC, entityId: id, op: 'upsert', fields }],
    );
  }

  async read(ownerId: string, docId: string): Promise<void> {
    const doc = await this.doc(ownerId, docId);
    if (!doc || !['new', 'waiting', 'reading'].includes(doc.status)) return;
    await this.write(ownerId, docId, { status: 'reading', problem: null });
    const now = new Date(this.now());
    const today = now.toISOString().slice(0, 10);

    let data: Part[];
    try {
      data = await this.parts(ownerId, doc);
    } catch {
      await this.write(ownerId, docId, { status: 'failed', problem: 'The file couldn’t be read.' });
      return;
    }
    try {
      const r = await this.ai.complete({
        ownerId,
        task: 'library.read',
        system: `You file a person's documents in India. Today is ${today}.
Read the document and fill in: "title" (what it is, e.g. "HDFC Life term insurance policy"), "category" (one of
${LIBRARY_CATEGORIES.join(', ')}), "tags" (up to 8 short lowercase words a person would search for), "summary" (one or two
plain sentences), "keyDates" ([{"label","date":"YYYY-MM-DD"}] — only dates printed in the document), "expiresOn"
(the date it expires, ends or must be renewed, YYYY-MM-DD, or null; never guess), "amounts" ([{"label","amount" in
rupees,"currency"}] — only amounts that are due or payable, as printed), and "text" (the main words of the document,
for search, at most a few paragraphs). Never invent a date or an amount: if it is not in the document, leave it out.`,
        data,
        schema: LibraryRead,
        maxTokens: 1500,
        // the cheap read couldn't tell what it is: the stronger model looks once (spec 0007 C3)
        unsure: (a) =>
          !a.title.trim() ||
          !(LIBRARY_CATEGORIES as readonly string[]).includes(a.category) ||
          a.category === 'Other',
      });
      const cat = (LIBRARY_CATEGORIES as readonly string[]).includes(r.category) ? r.category : 'Other';
      const tags = [...new Set([...doc.tags, ...r.tags.map((t) => t.toLowerCase())])].slice(0, 20);
      await this.write(ownerId, docId, {
        title: doc.title || r.title,
        category: doc.category && doc.category !== 'Other' ? doc.category : cat,
        tags,
        summary: r.summary,
        text: doc.kind === 'note' ? doc.text : r.text,
        keyDates: r.keyDates,
        expiresOn: doc.expiresOn ?? r.expiresOn,
        amounts: r.amounts.map((a) => ({
          label: a.label,
          amountMinor: Math.round(a.amount * 100),
          currency: a.currency,
        })),
        moneyState: r.amounts.length ? 'suggested' : 'none',
        status: 'ready',
        problem: null,
      });
      await this.remindExpiries(ownerId);
    } catch (e) {
      if (e instanceof AiPaused) {
        await this.write(ownerId, docId, {
          status: 'waiting',
          problem:
            e.scope === 'day'
              ? `AI is paused for today (the $${this.env.AI_DAILY_BUDGET_USD} daily limit). It continues tomorrow.`
              : 'Your share of today’s AI is used. It continues tomorrow.',
        });
        await this.queue.add(
          'read',
          { kind: 'read', ownerId, docId },
          { jobId: `r-${docId}-tomorrow`, delay: this.untilTomorrow() },
        );
        return;
      }
      const problem =
        e instanceof AiOff
          ? 'AI isn’t set up on this server yet. Add a title and tags yourself.'
          : e instanceof AiBadAnswer
            ? 'Couldn’t read this one. Add a title and tags yourself.'
            : 'Something went wrong reading this. Try again, or fill it in yourself.';
      if (!(e instanceof AiOff || e instanceof AiBadAnswer))
        this.log.warn(`read failed: ${(e as Error).message}`);
      await this.write(ownerId, docId, { status: 'failed', problem });
    }
  }

  /** What is sent: the note's words, or the file itself (image, PDF) or the start of a text file. */
  private async parts(ownerId: string, doc: Doc): Promise<Part[]> {
    const out: Part[] = [];
    if (doc.title) out.push({ type: 'text', text: `Title given by the person: ${doc.title}` });
    if (doc.text) out.push({ type: 'text', text: doc.text.slice(0, 20_000) });
    if (doc.fileId) {
      const f = await this.files.read(ownerId, doc.fileId);
      out.push({ type: 'text', text: `File: ${f.name} (${f.mime})` });
      const url = `data:${f.mime};base64,${Buffer.from(f.bytes).toString('base64')}`;
      if (f.mime.startsWith('image/')) out.push({ type: 'image', name: f.name, dataUrl: url });
      else if (f.mime === 'application/pdf') out.push({ type: 'file', name: f.name, dataUrl: url });
      else if (f.mime === 'text/plain')
        out.push({ type: 'text', text: Buffer.from(f.bytes).toString('utf8').slice(0, 20_000) });
    }
    if (!out.length) out.push({ type: 'text', text: '(empty)' });
    return out;
  }

  /**
   * Reminders for everything that runs out: 30, 7 and 1 days before and on the day, from 09:00 the person's time, on the
   * ways they chose for date-only reminders (D22). Each is sent once (a stable key per document, date and lead).
   */
  async remindExpiries(ownerId?: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(libraryDocs)
      .where(
        and(
          isNull(libraryDocs.deletedAt),
          isNotNull(libraryDocs.expiresOn),
          eq(libraryDocs.remind, true),
          ...(ownerId ? [eq(libraryDocs.ownerId, ownerId)] : []),
        ),
      );
    let sent = 0;
    const settingsCache = new Map<string, { tz: string; via?: string[] }>();
    for (const d of rows) {
      let st = settingsCache.get(d.ownerId);
      if (!st) {
        const [s] = await this.db.select().from(todaySettings).where(eq(todaySettings.ownerId, d.ownerId));
        const rem = (s?.reminders ?? {}) as { dateOnlyVia?: string[]; via?: string[] };
        st = { tz: s?.timeZone ?? 'Asia/Kolkata', via: rem.dateOnlyVia ?? rem.via };
        settingsCache.set(d.ownerId, st);
      }
      const w = wallIn(new Date(this.now()), st.tz);
      const today = `${String(w.y).padStart(4, '0')}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
      if (w.h < REMIND_FROM_HOUR) continue;
      const left = dayDiff(d.expiresOn!, today);
      if (left < 0) continue;
      // the nearest lead we have reached and not yet sent: 30 → 7 → 1 → 0
      const lead = [...EXPIRY_LEAD_DAYS].filter((l) => left <= l).sort((a, b) => a - b)[0];
      if (lead === undefined) continue;
      const title = d.title || 'A document';
      await this.notify.send({
        userId: d.ownerId,
        module: 'library',
        kind: 'library.expiry',
        type: 'library.expiry',
        own: true,
        title:
          left === 0
            ? `${title} expires today`
            : left === 1
              ? `${title} expires tomorrow`
              : `${title} expires in ${left} days`,
        body: `Expires ${d.expiresOn}. Open it in Library to renew or update the date.`,
        url: '/library',
        dedupeKey: `library:exp:${d.id}:${d.expiresOn}:${lead}`,
        ...deliveryFor(st.via as never, false),
      });
      sent++;
    }
    return sent;
  }

  /** Milliseconds to 00:05 tomorrow in the AI cap's time zone. */
  private untilTomorrow(): number {
    const w = wallIn(new Date(this.now()), this.env.AI_BUDGET_TZ);
    const next = instantAt(w.y, w.m, w.d + 1, 0, 5, this.env.AI_BUDGET_TZ);
    return Math.max(60_000, next.getTime() - this.now());
  }
}
