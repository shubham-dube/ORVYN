import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { CalendarService } from '../calendar/calendar.service';
import { TokenBox } from '../calendar/token-box';
import { ClickUpClient, ClickUpError } from './clickup.client';
import { connections } from './connections.schema';

export type Capability = 'calendar' | 'meet' | 'gmail' | 'tasks';

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
    gives: ['Your open tasks in Today', 'Tick them done from ORVYN'],
    how: 'token',
    tokenHelp: 'ClickUp → avatar → Settings → Apps → API Token (starts with pk_).',
  },
  { id: 'outlook', name: 'Microsoft 365 / Outlook', gives: ['Calendar', 'Teams links', 'Mail'], how: 'soon' },
  { id: 'notion', name: 'Notion', gives: ['Pages into Library', 'Tasks'], how: 'soon' },
  { id: 'github', name: 'GitHub', gives: ['Issues and reviews assigned to you'], how: 'soon' },
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
  ) {}

  providers() {
    const googleReady = !!(this.env.GOOGLE_WEB_CLIENT_ID && this.env.GOOGLE_WEB_CLIENT_SECRET);
    return PROVIDERS.map((p) => ({
      ...p,
      available: p.how === 'token' || (p.how === 'oauth' && googleReady),
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
        capabilities: ['tasks'] as Capability[],
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

  private async mark(r: Row, problem: string | null) {
    await this.db
      .update(connections)
      .set({ lastError: problem, status: problem ? 'needs_attention' : 'active' })
      .where(eq(connections.id, r.id));
  }
}
