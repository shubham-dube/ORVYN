import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DROP_ITEM, type DropProposal, DropProposal as ProposalSchema } from '@orvyn/contracts';
import { instantAt, wallIn } from '@orvyn/today-parse';
import { Queue, Worker } from 'bullmq';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { AiBadAnswer, AiOff, AiPaused, AiService, type Part } from '../ai/ai.service';
import { FilesService } from '../files/files.service';
import { moneyCategories } from '../money/money.schema';
import { SERVER_DEVICE, serverOrigin, type SyncApplied, SyncService } from '../sync/sync.service';
import { todaySettings } from '../today/today.schema';
import { dropItems } from './drop.schema';

type Job = { kind: 'understand'; ownerId: string; itemId: string };
type Item = typeof dropItems.$inferSelect;
const QUEUE = 'drop';

/**
 * Drop (spec 0003): something dropped → the AI proposes what it is (task / event / expense / note) with the fields
 * filled → the person confirms on a device (AC3). The AI only ever proposes; nothing is created here. The person's
 * recent corrections go along as examples. When the day's AI cap is reached the item waits for tomorrow (AC4).
 */
@Injectable()
export class DropService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('drop');
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
  ) {}

  onModuleInit(): void {
    const connection = { url: this.env.REDIS_URL };
    this.queue = new Queue<Job>(QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 15_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    if (this.env.PROCESS_ROLE !== 'api') {
      this.worker = new Worker<Job>(QUEUE, (j) => this.understand(j.data.ownerId, j.data.itemId), {
        connection,
        concurrency: 3,
      });
      this.worker.on('failed', (j, e) => this.log.warn(`understand ${j?.id} failed: ${e.message}`));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Tests (no worker): run whatever is due now. */
  async drain(): Promise<number> {
    let n = 0;
    for (;;) {
      const jobs = (await this.queue.getJobs(['waiting', 'prioritized'], 0, 50, true)).filter(
        (j) => !j.opts.delay,
      );
      if (!jobs.length) return n;
      for (const j of jobs) {
        await j.remove().catch(() => undefined);
        await this.understand(j.data.ownerId, j.data.itemId);
        n++;
      }
    }
  }

  /** Waiting jobs scheduled for later (tests check the retry is lined up). */
  delayed() {
    return this.queue.getDelayed();
  }

  @OnEvent('sync.applied', { async: true, promisify: true })
  async onSync(e: SyncApplied): Promise<void> {
    if (e.entity !== DROP_ITEM || e.op !== 'upsert' || serverOrigin.getStore()) return;
    const item = await this.item(e.ownerId, e.entityId);
    if (item?.status !== 'new') return;
    await this.queue.add(
      'understand',
      { kind: 'understand', ownerId: e.ownerId, itemId: item.id },
      { jobId: `u-${item.id}-${Date.now()}` },
    );
  }

  private async item(ownerId: string, id: string): Promise<Item | null> {
    const [r] = await this.db
      .select()
      .from(dropItems)
      .where(and(eq(dropItems.id, id), eq(dropItems.ownerId, ownerId), isNull(dropItems.deletedAt)));
    return r ?? null;
  }

  private async write(ownerId: string, id: string, fields: Record<string, unknown>): Promise<void> {
    const p = await this.access.principal(ownerId);
    if (!p) return;
    await this.sync.pushAsServer(
      { userId: ownerId, deviceId: SERVER_DEVICE, role: p.role, entitlements: p.entitlements },
      [{ entity: DROP_ITEM, entityId: id, op: 'upsert', fields }],
    );
  }

  async understand(ownerId: string, itemId: string): Promise<void> {
    const item = await this.item(ownerId, itemId);
    if (!item || !['new', 'waiting', 'thinking'].includes(item.status)) return; // confirmed or dismissed meanwhile
    const p = await this.access.principal(ownerId);
    if (!p) return;
    await this.write(ownerId, itemId, { status: 'thinking', problem: null });

    const has = (k: string) => p.role === 'owner' || p.entitlements.has(k as never);
    const kinds = ['note', ...(has('today') ? ['task', 'event'] : []), ...(has('money') ? ['expense'] : [])];
    const [settings] = await this.db
      .select({ tz: todaySettings.timeZone })
      .from(todaySettings)
      .where(eq(todaySettings.ownerId, ownerId));
    const tz = settings?.tz ?? 'Asia/Kolkata';
    const categories = has('money')
      ? (
          await this.db
            .select({ name: moneyCategories.name })
            .from(moneyCategories)
            .where(
              and(
                eq(moneyCategories.ownerId, ownerId),
                isNull(moneyCategories.deletedAt),
                eq(moneyCategories.archived, false),
              ),
            )
        ).map((c) => c.name)
      : [];
    const corrections = await this.db
      .select({ text: dropItems.text, proposal: dropItems.proposal, correction: dropItems.correction })
      .from(dropItems)
      .where(and(eq(dropItems.ownerId, ownerId), isNotNull(dropItems.correction)))
      .orderBy(desc(dropItems.updatedAt))
      .limit(8);

    let data: Part[];
    try {
      data = await this.parts(ownerId, item);
    } catch {
      await this.write(ownerId, itemId, { status: 'failed', problem: 'The file couldn’t be read.' });
      return;
    }
    if (corrections.length)
      data.push({
        type: 'text',
        text: `\nEarlier, this person corrected proposals like this (what was dropped → what they chose):\n${corrections
          .map((c) => `- "${c.text.slice(0, 120)}" → ${JSON.stringify(c.correction)}`)
          .join('\n')}`,
      });

    const now = new Date(this.now());
    const wall = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(now);
    try {
      const proposal = await this.ai.complete({
        ownerId,
        task: 'drop.understand',
        system: `You sort what a person in India dropped into their personal app. It is now ${wall} (${tz}).
Decide what it is — one of: ${kinds.join(', ')} — and fill the fields:
- task: {"kind":"task","title","dueDate":"YYYY-MM-DD"|null,"dueAt":ISO-8601 with offset|null,"durationMin"|null,"priority":0-3,"notes","why"}
- event: {"kind":"event","title","start":ISO-8601 with offset,"end":ISO-8601 with offset,"location","notes","why"}
- expense: {"kind":"expense","amount": number in rupees,"currency":"INR","direction":"debit"|"credit","merchant","category": one of [${categories.join(', ')}],"occurredAt": ISO|null,"note","why"}
- note: {"kind":"note","title","text","why"}
"why" is one short line saying why you chose it. A receipt or bill photo is an expense with its total. Use the
person's earlier corrections as guidance. If unsure, choose note.`,
        data,
        schema: ProposalSchema,
        maxTokens: 600,
      });
      const fixed = this.fit(proposal, kinds, tz);
      await this.write(ownerId, itemId, { status: 'proposed', proposal: fixed, problem: null });
    } catch (e) {
      if (e instanceof AiPaused) {
        await this.write(ownerId, itemId, {
          status: 'waiting',
          problem:
            e.scope === 'day'
              ? `AI is paused for today (the $${this.env.AI_DAILY_BUDGET_USD} daily limit). It continues tomorrow.`
              : 'Your share of today’s AI is used. It continues tomorrow.',
        });
        await this.queue.add(
          'understand',
          { kind: 'understand', ownerId, itemId },
          { jobId: `u-${itemId}-tomorrow`, delay: this.untilTomorrow() },
        );
        return;
      }
      const problem =
        e instanceof AiOff
          ? 'AI isn’t set up on this server yet. Choose what it is yourself.'
          : e instanceof AiBadAnswer
            ? 'Couldn’t tell what this is. Choose what it is yourself.'
            : 'Something went wrong reading this. Try again, or choose what it is yourself.';
      if (!(e instanceof AiOff || e instanceof AiBadAnswer))
        this.log.warn(`understand failed: ${(e as Error).message}`);
      await this.write(ownerId, itemId, { status: 'failed', problem });
    }
  }

  /** What's sent: the text, the link, the image itself, or the start of a text file. */
  private async parts(ownerId: string, item: Item): Promise<Part[]> {
    const out: Part[] = [];
    if (item.text) out.push({ type: 'text', text: item.text.slice(0, 8000) });
    if (item.url) out.push({ type: 'text', text: `Link: ${item.url}` });
    if (item.fileId) {
      const f = await this.files.read(ownerId, item.fileId);
      out.push({ type: 'text', text: `File: ${f.name} (${f.mime})` });
      if (f.mime.startsWith('image/'))
        out.push({
          type: 'image',
          name: f.name,
          dataUrl: `data:${f.mime};base64,${Buffer.from(f.bytes).toString('base64')}`,
        });
      else if (f.mime === 'text/plain')
        out.push({ type: 'text', text: Buffer.from(f.bytes).toString('utf8').slice(0, 8000) });
    }
    if (!out.length) out.push({ type: 'text', text: '(empty)' });
    return out;
  }

  /** Keep proposals inside what the person has (no expense without Money) and times in their zone. */
  private fit(p: DropProposal, kinds: string[], tz: string): DropProposal {
    if (!kinds.includes(p.kind)) {
      const title = 'title' in p ? p.title : 'merchant' in p ? p.merchant || 'Note' : 'Note';
      return { kind: 'note', title: title || 'Note', text: '', why: p.why };
    }
    if (p.kind === 'task' && p.dueDate && !p.dueAt) {
      // a day only: fine as is
      return p;
    }
    if (p.kind === 'event' && Date.parse(p.end) <= Date.parse(p.start)) {
      return { ...p, end: new Date(Date.parse(p.start) + 3_600_000).toISOString() };
    }
    void tz;
    return p;
  }

  /** Milliseconds to 00:05 tomorrow in the cap's time zone. */
  private untilTomorrow(): number {
    const w = wallIn(new Date(this.now()), this.env.AI_BUDGET_TZ);
    const next = instantAt(w.y, w.m, w.d + 1, 0, 5, this.env.AI_BUDGET_TZ);
    return Math.max(60_000, next.getTime() - this.now());
  }
}
