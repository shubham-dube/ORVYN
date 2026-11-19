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
import { ClickUpClient, ClickUpError } from './clickup.client';
import { GitHubClient, GitHubError } from './github.client';
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
    gives: ['Your open tasks in Today', 'Add tasks and change due dates', 'Tick them done from ORVYN'],
    how: 'token',
    tokenHelp: 'ClickUp → avatar → Settings → Apps → API Token (starts with pk_).',
  },
  {
    id: 'github',
    name: 'GitHub',
    gives: [
      'Issues assigned to you and reviews waiting for you, in Today',
      'Close issues from ORVYN',
      'A ping when something new lands',
    ],
    how: 'token',
    tokenHelp:
      'github.com → Settings → Developer settings → Personal access tokens → Fine-grained: repository access as you like, permissions Issues: read & write, Pull requests: read.',
  },
  {
    id: 'mail',
    name: 'Mail (Zoho, Outlook, Yahoo, any IMAP)',
    gives: ['Unread mail next to Gmail', 'Turn a mail into a task'],
    how: 'mail',
  },
  { id: 'outlook', name: 'Microsoft 365 calendar', gives: ['Calendar', 'Teams links'], how: 'soon' },
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

  /** Open ClickUp tasks assigned to the person, across every connected ClickUp account and workspace. */
  async clickupTasks(ownerId: string) {
    const rows = await this.db
      .select()
      .from(connections)
      .where(and(eq(connections.ownerId, ownerId), eq(connections.provider, 'clickup')));
    const out: {
      id: string;
      connectionId: string;
      account: string;
      workspace: string;
      name: string;
      url: string;
      status: string;
      list: string;
      due: string | null;
      priority: string | null;
    }[] = [];
    for (const r of rows) {
      const meta = r.meta as { userId: string; teams: { id: string; name: string }[] };
      try {
        const token = await this.box.open(r.secretEnc);
        for (const team of meta.teams ?? []) {
          for (const t of await this.clickup.myTasks(token, team.id, meta.userId))
            out.push({
              id: t.id,
              connectionId: r.id,
              account: r.label,
              workspace: team.name,
              name: t.name,
              url: t.url,
              status: t.status.status,
              list: t.list.name,
              due: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
              priority: t.priority?.priority ?? null,
            });
        }
        if (r.lastError) await this.mark(r, null);
      } catch (e) {
        this.log.warn(`clickup ${r.id}: ${(e as Error).message}`);
        await this.mark(
          r,
          e instanceof ClickUpError && e.status === 401
            ? 'The token was revoked. Connect again.'
            : 'ClickUp didn’t answer.',
        );
      }
    }
    return out.sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'));
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
    const row = await this.save(ownerId, 'github', String(me.id), me.login, t, { login: me.login });
    return { id: row.id, account: row.label };
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
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
          problem: (e as Error).message,
        });
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
      dueDate: parsed.dueAt ? null : parsed.dueDate,
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
            : (await this.clickupTasks(r.ownerId))
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
        await this.db
          .update(connections)
          .set({
            meta: {
              ...r.meta,
              seen: [...new Set([...now.map((n) => n.key), ...(meta.seen ?? [])])].slice(0, 500),
            },
          })
          .where(eq(connections.id, r.id));
      } catch (e) {
        this.log.warn(`watch ${r.id}: ${(e as Error).message}`);
      }
    }
    return sent;
  }

  private async mark(r: Row, problem: string | null) {
    await this.db
      .update(connections)
      .set({ lastError: problem, status: problem ? 'needs_attention' : 'active' })
      .where(eq(connections.id, r.id));
  }
}
