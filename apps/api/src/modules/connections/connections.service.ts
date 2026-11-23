import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { instantAt, parseTask, wallIn } from '@orvyn/today-parse';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { CalendarService } from '../calendar/calendar.service';
import { AiBadAnswer, AiOff, AiPaused, AiService } from '../ai/ai.service';
import { NotifyService } from '../notify/notify.service';
import { todaySettings } from '../today/today.schema';
import { TokenBox } from '../calendar/token-box';
import { googleProblem } from '../calendar/google.client';
import { ClickUpClient, ClickUpError } from './clickup.client';
import { ClickUpHub } from './clickup.hub';
import { TODAY_TASK } from '@orvyn/contracts';
import { randomUUID } from 'node:crypto';
import { SERVER_DEVICE, SyncService } from '../sync/sync.service';
import { AccessService } from '../access/access.service';
import {
  type ChecksState,
  GitHubClient,
  GitHubError,
  type GitHubItem,
  type ReviewState,
} from './github.client';
import { MAIL_PROVIDERS, Mailbox, type MailItem } from './mailbox';
import { connections } from './connections.schema';

export type Capability = 'calendar' | 'meet' | 'gmail' | 'tasks' | 'issues' | 'reviews' | 'mail';

/** Every kind of account ORVYN can connect, and what each gives (spec 0007 C2). */
export const PROVIDERS = [
  {
    id: 'google',
    name: 'Google',
    gives: ['Calendar (both ways)', 'Meet links and invitations', 'Gmail: unread mail (optional, read-only)'],
    how: 'oauth',
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    gives: [
      'What you’re working on, in Today',
      'Every status, comments and time tracking without opening ClickUp',
      'Change status, due date and priority; start and stop the timer',
    ],
    how: 'token',
    tokenHelp: 'ClickUp → avatar → Settings → Apps → API Token (starts with pk_).',
  },
  {
    id: 'github',
    name: 'GitHub',
    gives: [
      'Your pull requests: open, merged, closed — with reviews and checks',
      'Issues assigned to you and reviews waiting for you, in Today',
      'A ping when your PR is merged or needs changes',
    ],
    how: 'token',
    tokenHelp:
      'github.com → Settings → Developer settings → Personal access tokens → Fine-grained: repository access as you like, permissions Issues: read & write, Pull requests: read, Commit statuses: read (for checks). A fine-grained token sees one owner: for your company’s repos (and PRs from your fork into them) add another token with the organisation as resource owner.',
  },
  {
    id: 'mail',
    name: 'Mail (Zoho, Outlook, Yahoo, any IMAP)',
    gives: ['Unread mail next to Gmail', 'Turn a mail into a task'],
    how: 'mail',
  },
  { id: 'outlook', name: 'Microsoft 365 / Outlook', gives: ['Calendar', 'Teams links'], how: 'soon' },
  { id: 'notion', name: 'Notion', gives: ['Pages into Library', 'Tasks'], how: 'soon' },
  { id: 'slack', name: 'Slack', gives: ['Saved messages into Drop'], how: 'soon' },
] as const;

type Row = typeof connections.$inferSelect;

/**
 * The connections hub: Google accounts (kept by the calendar module) and token-based services like ClickUp, several of
 * each. Tokens are sealed at rest and never leave the server; every query is the person's own.
 */
@Injectable()
export class ConnectionsService {
  private readonly log = new Logger('connections');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly box: TokenBox,
    private readonly clickup: ClickUpClient,
    private readonly calendar: CalendarService,
    private readonly github: GitHubClient,
    private readonly mailbox: Mailbox,
    private readonly notify: NotifyService,
    private readonly ai: AiService,
    private readonly hub: ClickUpHub,
    private readonly sync: SyncService,
    private readonly access: AccessService,
  ) {}

  providers() {
    const googleReady = !!(this.env.GOOGLE_WEB_CLIENT_ID && this.env.GOOGLE_WEB_CLIENT_SECRET);
    return PROVIDERS.map((p) => ({
      ...p,
      available: p.how === 'token' || p.how === 'mail' || (p.how === 'oauth' && googleReady),
      ...(p.id === 'mail'
        ? {
            mailProviders: Object.entries(MAIL_PROVIDERS).map(([id, m]) => ({
              id,
              name: m.name,
              help: m.help,
            })),
          }
        : {}),
    }));
  }

  /** Everything connected, one list. */
  async list(ownerId: string) {
    const google = await this.calendar.accounts(ownerId);
    const rows = await this.db.select().from(connections).where(eq(connections.ownerId, ownerId));
    return [
      ...google.map((g) => ({
        id: g.id,
        provider: 'google',
        account: g.email,
        status: g.status,
        capabilities: ['calendar', 'meet', ...(g.gmail ? ['gmail'] : [])] as Capability[],
        lastSyncedAt: g.lastSyncedAt,
      })),
      ...rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        account: r.label,
        status: r.status,
        capabilities: (r.provider === 'github'
          ? ['issues', 'reviews']
          : r.provider === 'mail'
            ? ['mail']
            : ['tasks']) as Capability[],
        lastSyncedAt: r.updatedAt.toISOString(),
        problem: r.lastError,
      })),
    ];
  }

  /** Connects a ClickUp account with its personal token (checked with ClickUp first). Same account again = update. */
  async connectClickUp(ownerId: string, token: string) {
    const t = token.trim();
    let me: Awaited<ReturnType<ClickUpClient['me']>>;
    let teams: Awaited<ReturnType<ClickUpClient['teams']>>;
    try {
      me = await this.clickup.me(t);
      teams = await this.clickup.teams(t);
    } catch (e) {
      if (e instanceof ClickUpError && (e.status === 401 || e.status === 400))
        return { error: 'bad_token' as const };
      throw e;
    }
    const values = {
      ownerId,
      provider: 'clickup',
      label: me.user.email || me.user.username || 'ClickUp',
      externalId: String(me.user.id),
      secretEnc: await this.box.seal(t),
      status: 'active',
      lastError: null,
      meta: { userId: String(me.user.id), teams: teams.teams.map((x) => ({ id: x.id, name: x.name })) },
    };
    const [row] = await this.db
      .insert(connections)
      .values(values)
      .onConflictDoUpdate({
        target: [connections.ownerId, connections.provider, connections.externalId],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return { id: row!.id, account: row!.label, workspaces: teams.teams.length };
  }

  async remove(ownerId: string, id: string): Promise<boolean> {
    const r = await this.db
      .delete(connections)
      .where(and(eq(connections.id, id), eq(connections.ownerId, ownerId)))
      .returning({ id: connections.id });
    return r.length > 0;
  }

  /**
   * Open ClickUp tasks assigned to the person, across every connected ClickUp account and workspace, each marked
   * `working` or not (spec 0012 B1). Served from a short cache so Today never waits on ClickUp.
   */
  async clickupTasks(ownerId: string, o: { fresh?: boolean } = {}) {
    return (await this.hub.openTasks(ownerId, o)).tasks;
  }

  async completeClickUp(ownerId: string, connectionId: string, taskId: string): Promise<boolean> {
    const [r] = await this.db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.id, connectionId),
          eq(connections.ownerId, ownerId),
          eq(connections.provider, 'clickup'),
        ),
      );
    if (!r) return false;
    await this.clickup.complete(await this.box.open(r.secretEnc), taskId);
    this.hub.invalidate(r.id);
    return true;
  }

  // ------------------------------------------------------------------ shared

  private async rows(ownerId: string, provider: string) {
    return this.db
      .select()
      .from(connections)
      .where(and(eq(connections.ownerId, ownerId), eq(connections.provider, provider)));
  }

  private async one(ownerId: string, id: string, provider: string) {
    const [r] = await this.db
      .select()
      .from(connections)
      .where(
        and(eq(connections.id, id), eq(connections.ownerId, ownerId), eq(connections.provider, provider)),
      );
    return r ?? null;
  }

  private async save(
    ownerId: string,
    provider: string,
    externalId: string,
    label: string,
    secret: string,
    meta: Record<string, unknown>,
  ) {
    const values = {
      ownerId,
      provider,
      label,
      externalId,
      secretEnc: await this.box.seal(secret),
      status: 'active',
      lastError: null,
      meta,
    };
    const [row] = await this.db
      .insert(connections)
      .values(values)
      .onConflictDoUpdate({
        target: [connections.ownerId, connections.provider, connections.externalId],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  private async tz(ownerId: string): Promise<string> {
    const [s] = await this.db
      .select({ tz: todaySettings.timeZone })
      .from(todaySettings)
      .where(eq(todaySettings.ownerId, ownerId));
    return s?.tz ?? 'Asia/Kolkata';
  }

  // ------------------------------------------------------------------ GitHub

  async connectGitHub(ownerId: string, token: string) {
    const t = token.trim();
    let me: Awaited<ReturnType<GitHubClient['me']>>;
    try {
      me = await this.github.me(t);
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 401 || e.status === 403))
        return { error: 'bad_token' as const };
      throw e;
    }
    const fp = createHash('sha256').update(t).digest('hex').slice(0, 12);
    const orgs = await this.github.orgs(t).catch(() => [] as string[]);
    const row = await this.save(
      ownerId,
      'github',
      `${me.id}:${fp}`,
      orgs.length ? `${me.login} · ${orgs.slice(0, 3).join(', ')}` : me.login,
      t,
      { login: me.login, orgs },
    );
    return { id: row.id, account: row.label, orgs };
  }

  /** Issues assigned to me and reviews waiting for me, across every GitHub account. */
  async githubWork(ownerId: string) {
    const out: {
      id: string;
      connectionId: string;
      account: string;
      kind: 'issue' | 'review';
      repo: string;
      number: number;
      title: string;
      url: string;
      updatedAt: string;
      createdAt: string;
    }[] = [];
    for (const r of await this.rows(ownerId, 'github')) {
      try {
        for (const w of await this.github.work(await this.box.open(r.secretEnc)))
          out.push({
            id: `${GitHubClient.repoOf(w.item.repository_url)}#${w.item.number}`,
            connectionId: r.id,
            account: r.label,
            kind: w.kind,
            repo: GitHubClient.repoOf(w.item.repository_url),
            number: w.item.number,
            title: w.item.title,
            url: w.item.html_url,
            updatedAt: w.item.updated_at,
            createdAt: w.item.created_at ?? w.item.updated_at,
          });
        if (r.lastError) await this.mark(r, null);
      } catch (e) {
        this.log.warn(`github ${r.id}: ${(e as Error).message}`);
        await this.mark(
          r,
          e instanceof GitHubError && e.status === 401
            ? 'The token was revoked or expired. Connect again.'
            : 'GitHub didn’t answer.',
        );
      }
    }
    // the same item seen through two tokens (personal + organisation) is one item
    const seen = new Set<string>();
    return out
      .filter((w) => (seen.has(`${w.kind}:${w.id}`) ? false : (seen.add(`${w.kind}:${w.id}`), true)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private readonly prCache = new Map<string, { at: number; prs: Pr[] }>();

  /**
   * My pull requests across every GitHub account (spec 0012 G): open ones with their review and checks, and those
   * merged or closed in the last 30 days. Cached for 2 minutes per account.
   */
  async githubPrs(ownerId: string, o: { fresh?: boolean } = {}): Promise<Pr[]> {
    const out: Pr[] = [];
    for (const r of await this.rows(ownerId, 'github')) {
      const c = this.prCache.get(r.id);
      if (!o.fresh && c && Date.now() - c.at < 2 * 60_000) {
        out.push(...c.prs);
        continue;
      }
      try {
        const token = await this.box.open(r.secretEnc);
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
        const mine = await this.github.myPrs(token, since);
        const open = await Promise.all(
          mine.open.slice(0, 20).map(async (i) => {
            const repo = GitHubClient.repoOf(i.repository_url);
            const [review, checks] = await Promise.all([
              this.github.reviewState(token, repo, i.number).catch(() => 'pending' as const),
              this.github.checks(token, repo, i.number).catch(() => 'none' as const),
            ]);
            return prOf(r, i, 'open', review, checks);
          }),
        );
        const closed = mine.closed.map((i) =>
          prOf(r, i, i.pull_request?.merged_at ? 'merged' : 'closed', null, null),
        );
        const prs = [...open, ...closed];
        this.prCache.set(r.id, { at: Date.now(), prs });
        out.push(...prs);
        if (r.lastError) await this.mark(r, null);
      } catch (e) {
        this.log.warn(`github prs ${r.id}: ${(e as Error).message}`);
        if (c) out.push(...c.prs);
        await this.mark(
          r,
          e instanceof GitHubError && e.status === 401
            ? 'The token was revoked or expired. Connect again.'
            : 'GitHub didn’t answer.',
        );
      }
    }
    const seen = new Set<string>();
    return out
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Which PR changes ping me (spec 0012 G; defaults D-0012-5: merged and changes requested). */
  async setGitHubPings(ownerId: string, connectionId: string, pings: Partial<PrPings>): Promise<boolean> {
    const r = await this.one(ownerId, connectionId, 'github');
    if (!r) return false;
    const meta = r.meta as { pings?: PrPings };
    await this.db
      .update(connections)
      .set({ meta: { ...r.meta, pings: { ...PR_PINGS, ...meta.pings, ...pings } } })
      .where(and(eq(connections.id, r.id), eq(connections.ownerId, ownerId)));
    return true;
  }

  async closeIssue(ownerId: string, connectionId: string, repo: string, number: number): Promise<boolean> {
    const r = await this.one(ownerId, connectionId, 'github');
    if (!r) return false;
    await this.github.closeIssue(await this.box.open(r.secretEnc), repo, number);
    return true;
  }

  // ------------------------------------------------------------------ ClickUp, beyond reading

  async clickupLists(ownerId: string) {
    const out: {
      connectionId: string;
      account: string;
      workspace: string;
      id: string;
      name: string;
      space: string;
    }[] = [];
    for (const r of await this.rows(ownerId, 'clickup')) {
      const meta = r.meta as { teams: { id: string; name: string }[] };
      const token = await this.box.open(r.secretEnc);
      for (const team of meta.teams ?? [])
        for (const l of await this.clickup.lists(token, team.id).catch(() => []))
          out.push({ connectionId: r.id, account: r.label, workspace: team.name, ...l });
    }
    return out;
  }

  /** A day ("YYYY-MM-DD", ClickUp shows it as a date) or a moment (with its time). */
  private dueMs(
    due: { date?: string | null; at?: string | null },
    tz: string,
  ): { ms: number | null; time: boolean } {
    if (due.at) return { ms: Date.parse(due.at), time: true };
    if (due.date) {
      const [y, m, d] = due.date.split('-').map(Number) as [number, number, number];
      return { ms: instantAt(y, m, d, 12, 0, tz).getTime(), time: false };
    }
    return { ms: null, time: false };
  }

  async createClickUpTask(
    ownerId: string,
    b: { connectionId: string; listId: string; name: string; dueDate?: string | null; dueAt?: string | null },
  ) {
    const r = await this.one(ownerId, b.connectionId, 'clickup');
    if (!r) return null;
    const due = this.dueMs({ date: b.dueDate, at: b.dueAt }, await this.tz(ownerId));
    const t = await this.clickup.createTask(await this.box.open(r.secretEnc), b.listId, {
      name: b.name,
      due: due.ms,
      dueTime: due.time,
      assignee: Number((r.meta as { userId: string }).userId),
    });
    return { id: t.id, url: t.url, name: t.name };
  }

  async setClickUpDue(
    ownerId: string,
    connectionId: string,
    taskId: string,
    due: { dueDate?: string | null; dueAt?: string | null },
  ) {
    const r = await this.one(ownerId, connectionId, 'clickup');
    if (!r) return false;
    const d = this.dueMs({ date: due.dueDate, at: due.dueAt }, await this.tz(ownerId));
    await this.clickup.setDue(await this.box.open(r.secretEnc), taskId, d.ms, d.time);
    return true;
  }

  // ------------------------------------------------------------------ mail (Gmail + any IMAP mailbox)

  async connectMail(
    ownerId: string,
    b: { provider: string; email: string; password: string; host?: string },
  ) {
    const preset = MAIL_PROVIDERS[b.provider];
    if (!preset) return { error: 'bad_provider' as const };
    const hosts = b.provider === 'custom' ? (b.host ? [b.host] : []) : preset.hosts;
    if (!hosts.length) return { error: 'bad_host' as const };
    let host: string;
    try {
      host = await this.mailbox.verify(b.email.trim(), b.password.replace(/\s+/g, ''), hosts);
    } catch (e) {
      this.log.warn(`mail connect ${b.provider}: ${(e as Error).message}`);
      return { error: 'bad_login' as const };
    }
    const row = await this.save(
      ownerId,
      'mail',
      b.email.trim().toLowerCase(),
      b.email.trim(),
      b.password.replace(/\s+/g, ''),
      {
        kind: b.provider,
        host,
        port: 993,
        webmail: b.provider === 'zoho' && host.endsWith('.com') ? 'https://mail.zoho.com' : preset.webmail,
      },
    );
    return { id: row.id, account: row.label, host };
  }

  /** Unread mail from every mailbox: Google accounts with Gmail added and IMAP accounts. */
  async mail(ownerId: string) {
    const boxes: {
      connectionId: string;
      account: string;
      provider: string;
      unread: number;
      items: MailItem[];
      problem?: string;
    }[] = [];
    for (const g of await this.calendar.accounts(ownerId)) {
      if (!g.gmail) continue;
      try {
        const r = await this.calendar.inbox(ownerId, g.id);
        if (r) boxes.push({ connectionId: g.id, account: g.email, provider: 'gmail', ...r });
      } catch (e) {
        boxes.push({
          connectionId: g.id,
          account: g.email,
          provider: 'gmail',
          unread: 0,
          items: [],
          problem: googleProblem(e),
        });
        this.log.warn(`gmail ${g.id}: ${(e as Error).message}`);
      }
    }
    for (const r of await this.rows(ownerId, 'mail')) {
      const meta = r.meta as { kind: string; host: string; port: number; webmail: string | null };
      try {
        const res = await this.mailbox.unread(
          { host: meta.host, port: meta.port, user: r.label, password: await this.box.open(r.secretEnc) },
          10,
        );
        boxes.push({
          connectionId: r.id,
          account: r.label,
          provider: meta.kind,
          unread: res.unread,
          items: res.items.map((i) => ({ ...i, url: i.url ?? meta.webmail })),
        });
        if (r.lastError) await this.mark(r, null);
      } catch (e) {
        this.log.warn(`mail ${r.id}: ${(e as Error).message}`);
        await this.mark(r, 'The mailbox refused the password. Make a new app password and connect again.');
        boxes.push({
          connectionId: r.id,
          account: r.label,
          provider: meta.kind,
          unread: 0,
          items: [],
          problem: 'Couldn’t read this mailbox.',
        });
      }
    }
    return boxes;
  }

  /**
   * A mail, as a task to confirm: the subject without "Re:/Fwd:", a date when the subject names one (ORVYN's own
   * parser), the sender and a link in the notes. With `smart`, the cheapest model reads subject and preview (as data)
   * for a clearer title and date — still only a proposal the person edits and confirms.
   */
  async mailTask(
    ownerId: string,
    m: { subject: string; from: string; snippet?: string; url?: string | null },
    smart = false,
  ) {
    const tz = await this.tz(ownerId);
    const subject = m.subject.replace(/^\s*((re|fwd?|fw|aw)\s*:\s*)+/i, '').trim() || 'Mail';
    const parsed = parseTask(subject, { now: new Date(), timeZone: tz });
    let out = {
      title: parsed.title || subject,
      // "Send the invoice by Friday": in a mail the deadline is the day to do it
      dueDate: parsed.dueAt ? null : (parsed.dueDate ?? parsed.deadline),
      dueAt: parsed.dueAt,
      notes: [`From: ${m.from}`, m.url ? m.url : null].filter(Boolean).join('\n'),
      smart: false,
    };
    if (smart) {
      try {
        const w = wallIn(new Date(), tz);
        const r = await this.ai.complete({
          ownerId,
          task: 'mail.task',
          maxTokens: 120,
          system: `Turn an email into one short to-do for its reader. Today is ${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')} (${tz}). Answer {"title": an imperative to-do under 80 characters, "dueDate": "YYYY-MM-DD" or null when no date is asked for}.`,
          data: [
            {
              type: 'text',
              text: `Subject: ${subject}\nFrom: ${m.from}\n${(m.snippet ?? '').slice(0, 600)}`,
            },
          ],
          schema: z.object({
            title: z.string().min(1).max(120),
            dueDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .nullable()
              .default(null),
          }),
        });
        out = { ...out, title: r.title, dueDate: out.dueAt ? null : (r.dueDate ?? out.dueDate), smart: true };
      } catch (e) {
        if (!(e instanceof AiOff || e instanceof AiPaused || e instanceof AiBadAnswer))
          this.log.warn((e as Error).message);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ the watcher: new work, one ping

  /**
   * Every 15 minutes: new GitHub issues assigned / reviews requested and new ClickUp tasks assigned become one
   * notification each (at most 3, then a summary). The first look at an account only remembers what is there.
   */
  async watch(ownerId?: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(connections)
      .where(
        and(
          inArray(connections.provider, ['github', 'clickup']),
          ...(ownerId ? [eq(connections.ownerId, ownerId)] : []),
        ),
      );
    let sent = 0;
    for (const r of rows) {
      try {
        const now =
          r.provider === 'github'
            ? (await this.githubWork(r.ownerId))
                .filter((w) => w.connectionId === r.id)
                .map((w) => ({
                  key: `${w.kind}:${w.id}`,
                  title: w.kind === 'review' ? `Review requested: ${w.title}` : `Assigned to you: ${w.title}`,
                  body: `${w.repo} #${w.number}`,
                  url: w.url,
                }))
            : (await this.clickupTasks(r.ownerId, { fresh: true }))
                .filter((t) => t.connectionId === r.id)
                .map((t) => ({
                  key: `task:${t.id}`,
                  title: `ClickUp: ${t.name}`,
                  body: `${t.list} · ${t.status}`,
                  url: t.url,
                }));
        const meta = r.meta as { seen?: string[] };
        const seen = new Set(meta.seen ?? []);
        const fresh = meta.seen ? now.filter((n) => !seen.has(n.key)) : [];
        for (const n of fresh.slice(0, 3)) {
          await this.notify.send({
            userId: r.ownerId,
            module: 'today',
            kind: 'connection',
            title: n.title,
            body: n.body,
            url: n.url,
            dedupeKey: `conn:${r.id}:${n.key}`,
          });
          sent++;
        }
        if (fresh.length > 3)
          await this.notify.send({
            userId: r.ownerId,
            module: 'today',
            kind: 'connection',
            title: `${fresh.length - 3} more new in ${r.provider === 'github' ? 'GitHub' : 'ClickUp'}`,
            url: '/today',
          });
        const prs = r.provider === 'github' ? await this.prPings(r) : undefined;
        const reviewTasks =
          r.provider === 'github'
            ? await this.reviewTasks(r, await this.githubWork(r.ownerId)).catch((e: Error) => {
                this.log.warn(`review tasks ${r.id}: ${e.message}`);
                return undefined;
              })
            : undefined;
        if (prs) sent += prs.sent;
        await this.db
          .update(connections)
          .set({
            meta: {
              ...r.meta,
              seen: [...new Set([...now.map((n) => n.key), ...(meta.seen ?? [])])].slice(0, 500),
              ...(prs ? { prs: prs.state } : {}),
              ...(reviewTasks ? { reviewTasks } : {}),
            },
          })
          .where(eq(connections.id, r.id));
      } catch (e) {
        this.log.warn(`watch ${r.id}: ${(e as Error).message}`);
      }
    }
    return sent;
  }

  /**
   * My PRs that changed since the last look: merged, changes requested, approved — one ping each, as the person
   * chose (spec 0012 G). The first look only remembers. Returns the new remembered state.
   */
  private async prPings(r: Row): Promise<{ sent: number; state: Record<string, string> }> {
    const meta = r.meta as { prs?: Record<string, string>; pings?: Partial<PrPings> };
    const pings = { ...PR_PINGS, ...meta.pings };
    const prs = (await this.githubPrs(r.ownerId, { fresh: true })).filter((p) => p.connectionId === r.id);
    const state: Record<string, string> = {};
    for (const p of prs) state[p.id] = p.state === 'open' ? `open:${p.review ?? 'pending'}` : p.state;
    let sent = 0;
    if (!meta.prs) return { sent, state };
    for (const p of prs) {
      const was = meta.prs[p.id];
      const is = state[p.id]!;
      if (!was || was === is) continue;
      const ping =
        is === 'merged' && pings.merged
          ? { title: `PR merged: ${p.title}`, key: 'merged' }
          : is === 'open:changes' && pings.changes
            ? { title: `Changes requested: ${p.title}`, key: 'changes' }
            : is === 'open:approved' && pings.approved
              ? { title: `PR approved: ${p.title}`, key: 'approved' }
              : null;
      if (!ping) continue;
      await this.notify.send({
        userId: r.ownerId,
        module: 'today',
        kind: 'connection',
        title: ping.title,
        body: `${p.repo} #${p.number}`,
        url: p.url,
        dedupeKey: `pr:${r.id}:${p.id}:${ping.key}:${p.updatedAt}`,
      });
      sent++;
    }
    // a PR merged more than 30 days ago drops out of the search; keep what's still there plus the open ones
    return { sent, state };
  }

  /**
   * A review requested from me becomes a task in Today, dated the day the pull request was raised, with the link
   * (spec 0014 G2). When the review no longer waits for me (done, merged, closed), the task is ticked off.
   * Switch off with pings.reviewTasks = false. Returns the remembered pull request → task map.
   */
  private async reviewTasks(
    r: Row,
    work: Awaited<ReturnType<ConnectionsService['githubWork']>>,
  ): Promise<Record<string, string>> {
    const meta = r.meta as { reviewTasks?: Record<string, string>; pings?: { reviewTasks?: boolean } };
    const known = { ...(meta.reviewTasks ?? {}) };
    if (meta.pings?.reviewTasks === false) return known;
    const p = await this.access.principal(r.ownerId);
    if (!p) return known;
    const auth = { userId: r.ownerId, deviceId: SERVER_DEVICE, role: p.role, entitlements: p.entitlements };
    const tz = await this.tz(r.ownerId);
    const waiting = work.filter((w) => w.kind === 'review' && w.connectionId === r.id);
    const firstLook = meta.reviewTasks === undefined;
    for (const w of waiting) {
      if (known[w.id]) continue;
      const id = randomUUID();
      const wd = wallIn(new Date(w.createdAt), tz);
      await this.sync.pushAsServer(auth, [
        {
          entity: TODAY_TASK,
          entityId: id,
          op: 'upsert',
          fields: {
            title: `Review: ${w.title} (#${w.number})`.slice(0, 500),
            notes: `${w.repo} #${w.number}\n${w.url}`,
            dueDate: `${wd.y}-${String(wd.m).padStart(2, '0')}-${String(wd.d).padStart(2, '0')}`,
            tags: ['review'],
            priority: 2,
            source: 'github',
          },
        },
      ]);
      known[w.id] = id;
    }
    // reviews no longer waiting: tick their tasks (not on the first look, when nothing was ours yet)
    if (!firstLook)
      for (const [pr, taskId] of Object.entries(known)) {
        if (waiting.some((w) => w.id === pr)) continue;
        await this.sync.pushAsServer(auth, [
          {
            entity: TODAY_TASK,
            entityId: taskId,
            op: 'upsert',
            fields: { completedAt: new Date().toISOString() },
          },
        ]);
        delete known[pr];
      }
    return known;
  }

  private async mark(r: Row, problem: string | null) {
    await this.db
      .update(connections)
      .set({ lastError: problem, status: problem ? 'needs_attention' : 'active' })
      .where(eq(connections.id, r.id));
  }
}

export interface PrPings {
  merged: boolean;
  changes: boolean;
  approved: boolean;
  /** a review requested from me becomes a task in Today */
  reviewTasks: boolean;
}
export const PR_PINGS: PrPings = { merged: true, changes: true, approved: false, reviewTasks: true };

export interface Pr {
  id: string;
  connectionId: string;
  account: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  review: ReviewState | null;
  checks: ChecksState | null;
  comments: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

function prOf(
  r: { id: string; label: string },
  i: GitHubItem,
  state: Pr['state'],
  review: ReviewState | null,
  checks: ChecksState | null,
): Pr {
  const repo = GitHubClient.repoOf(i.repository_url);
  return {
    id: `${repo}#${i.number}`,
    connectionId: r.id,
    account: r.label,
    repo,
    number: i.number,
    title: i.title,
    url: i.html_url,
    state,
    draft: !!i.draft,
    review,
    checks,
    comments: i.comments ?? 0,
    createdAt: i.created_at ?? i.updated_at,
    updatedAt: i.updated_at,
    closedAt: i.pull_request?.merged_at ?? i.closed_at ?? null,
  };
}
