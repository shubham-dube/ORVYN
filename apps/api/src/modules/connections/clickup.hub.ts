import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { TokenBox } from '../calendar/token-box';
import {
  ClickUpClient,
  ClickUpError,
  type ClickUpStatus,
  type ClickUpTask,
  type ClickUpTimeEntry,
} from './clickup.client';
import { connections } from './connections.schema';

type Row = typeof connections.$inferSelect;
interface Meta {
  userId: string;
  teams: { id: string; name: string }[];
  /** status names (lower case) that mean "I'm on this"; unset = the default rule */
  workingStatuses?: string[] | null;
}

/** A ClickUp task as ORVYN's clients see it (spec 0012 B). */
export interface HubTask {
  id: string;
  connectionId: string;
  account: string;
  workspace: string;
  teamId: string;
  name: string;
  url: string;
  status: string;
  statusColor: string | null;
  statusType: string;
  /** shown in Today (a working status) */
  working: boolean;
  list: string;
  listId: string;
  folder: string | null;
  due: string | null;
  priority: string | null;
  parentId: string | null;
  /** everyone's tracked time, minutes */
  trackedMin: number;
  updatedAt: string | null;
  closedAt: string | null;
}

/** Statuses that are past "working on it": review, QA, fixed, deployed, done, on hold (spec 0012 B1 default). */
const NOT_WORKING =
  /fix|deploy|prod|release|qa|review|test|verif|done|complete|closed|block|hold|cancel|backlog|archiv/i;
/** Names that say "I'm on this", whatever type the list gives the status. */
const WORKING = /design|develop|progress|doing|working|wip|build|implement|coding|active|ongoing/i;

/**
 * The default "I am on this": a status whose name says so (DESIGN, DEVELOPMENT, IN PROGRESS …) or any in-progress
 * (custom) status — never one past building (fixed, QA, review, deployed …) and never a closed one. "To do" (not
 * started) doesn't count unless its name says otherwise.
 */
export function defaultWorking(status: string, type: string | undefined): boolean {
  if (type === 'closed' || type === 'done' || NOT_WORKING.test(status)) return false;
  return WORKING.test(status) || type === 'custom';
}

const OPEN_TTL = 2 * 60_000; // serve from the cache, refresh behind it after this
const OPEN_MAX = 15 * 60_000; // older than this: wait for fresh data
const STATUS_TTL = 60 * 60_000;

/**
 * Everything ORVYN does with ClickUp beyond the first version: a quick cache (Today never waits on every workspace),
 * working statuses, the task sheet (status, priority, comments, time, timer). Every call finds the connection by
 * id **and** owner (rule 5); the token never leaves the server.
 */
@Injectable()
export class ClickUpHub {
  private readonly log = new Logger('clickup');
  private readonly open = new Map<string, { at: number; tasks: HubTask[]; refresh?: Promise<HubTask[]> }>();
  private readonly statusCache = new Map<string, { at: number; statuses: ClickUpStatus[] }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly box: TokenBox,
    private readonly cu: ClickUpClient,
  ) {}

  // ------------------------------------------------------------------ connections

  async rows(ownerId: string): Promise<Row[]> {
    return this.db
      .select()
      .from(connections)
      .where(and(eq(connections.ownerId, ownerId), eq(connections.provider, 'clickup')));
  }

  async one(ownerId: string, id: string): Promise<Row | null> {
    const [r] = await this.db
      .select()
      .from(connections)
      .where(
        and(eq(connections.id, id), eq(connections.ownerId, ownerId), eq(connections.provider, 'clickup')),
      );
    return r ?? null;
  }

  private token(r: Row) {
    return this.box.open(r.secretEnc);
  }

  private teamOf(r: Row, teamId?: string): string {
    const teams = (r.meta as unknown as Meta).teams ?? [];
    const t = teamId ? teams.find((x) => x.id === teamId) : teams[0];
    if (!t) throw new ClickUpError(404, 'no such workspace');
    return t.id;
  }

  private async mark(r: Row, problem: string | null) {
    if ((r.lastError ?? null) === problem) return;
    await this.db
      .update(connections)
      .set({ lastError: problem, status: problem ? 'needs_attention' : 'active' })
      .where(eq(connections.id, r.id));
  }

  invalidate(connectionId: string) {
    this.open.delete(connectionId);
  }

  // ------------------------------------------------------------------ tasks

  private shape(r: Row, workspace: string, t: ClickUpTask): HubTask {
    const meta = r.meta as unknown as Meta;
    const working = meta.workingStatuses
      ? meta.workingStatuses.includes(t.status.status.toLowerCase())
      : defaultWorking(t.status.status, t.status.type);
    return {
      id: t.id,
      connectionId: r.id,
      account: r.label,
      workspace,
      teamId: t.team_id ?? '',
      name: t.name,
      url: t.url,
      status: t.status.status,
      statusColor: t.status.color ?? null,
      statusType: t.status.type,
      working,
      list: t.list.name,
      listId: t.list.id,
      folder: t.folder && !t.folder.hidden ? t.folder.name : null,
      due: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
      priority: t.priority?.priority ?? null,
      parentId: t.parent ?? null,
      trackedMin: Math.round(Number(t.time_spent ?? 0) / 60_000),
      updatedAt: t.date_updated ? new Date(Number(t.date_updated)).toISOString() : null,
      closedAt:
        t.date_closed || t.date_done ? new Date(Number(t.date_closed ?? t.date_done)).toISOString() : null,
    };
  }

  /** One connection's open tasks, every workspace in parallel. */
  private async fetchOpen(r: Row): Promise<HubTask[]> {
    const meta = r.meta as unknown as Meta;
    const token = await this.token(r);
    const per = await Promise.all(
      (meta.teams ?? []).map(async (team) =>
        (await this.cu.myTasks(token, team.id, meta.userId)).map((t) => this.shape(r, team.name, t)),
      ),
    );
    return per.flat();
  }

  private problemOf(e: unknown): string {
    if (e instanceof ClickUpError && e.status === 401) return 'The token was revoked. Connect again.';
    if (e instanceof ClickUpError && e.status === 429)
      return 'ClickUp asked ORVYN to slow down. Retrying shortly.';
    return 'ClickUp didn’t answer.';
  }

  private refresh(r: Row): Promise<HubTask[]> {
    const c = this.open.get(r.id);
    if (c?.refresh) return c.refresh;
    const p = this.fetchOpen(r)
      .then(async (tasks) => {
        this.open.set(r.id, { at: Date.now(), tasks });
        await this.mark(r, null);
        return tasks;
      })
      .catch(async (e: unknown) => {
        this.log.warn(`clickup ${r.id}: ${(e as Error).message}`);
        await this.mark(r, this.problemOf(e));
        const old = this.open.get(r.id);
        if (old) {
          delete old.refresh;
          return old.tasks; // keep showing what we had
        }
        throw e;
      });
    this.open.set(r.id, { at: c?.at ?? 0, tasks: c?.tasks ?? [], refresh: p });
    return p;
  }

  /**
   * Open tasks across every ClickUp account: from the cache when it is fresh, refreshed behind the answer when it
   * is a little old (stale-while-revalidate), fetched when it is missing or old. Soonest due first.
   */
  async openTasks(
    ownerId: string,
    o: { fresh?: boolean } = {},
  ): Promise<{ tasks: HubTask[]; problems: string[] }> {
    const rows = await this.rows(ownerId);
    const problems: string[] = [];
    const lists = await Promise.all(
      rows.map(async (r) => {
        const c = this.open.get(r.id);
        const age = c && c.at ? Date.now() - c.at : Infinity;
        try {
          if (!o.fresh && c && c.at && age < OPEN_MAX) {
            if (age > OPEN_TTL) void this.refresh(r).catch(() => undefined);
            return c.tasks;
          }
          return await this.refresh(r);
        } catch (e) {
          problems.push(`${r.label}: ${this.problemOf(e)}`);
          return [];
        }
      }),
    );
    const tasks = lists.flat().sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'));
    return { tasks, problems };
  }

  /** Done and closed tasks of the last `days` days (only when the person opens that group). */
  async closedTasks(ownerId: string, days = 30): Promise<HubTask[]> {
    const since = Date.now() - days * 86_400_000;
    const out = await Promise.all(
      (await this.rows(ownerId)).map(async (r) => {
        const meta = r.meta as unknown as Meta;
        try {
          const token = await this.token(r);
          const per = await Promise.all(
            (meta.teams ?? []).map(async (team) =>
              (await this.cu.myTasks(token, team.id, meta.userId, { closedSince: since })).map((t) =>
                this.shape(r, team.name, t),
              ),
            ),
          );
          return per.flat();
        } catch (e) {
          this.log.warn(`clickup closed ${r.id}: ${(e as Error).message}`);
          return [];
        }
      }),
    );
    return out.flat().sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
  }

  private async listStatuses(token: string, listId: string): Promise<ClickUpStatus[]> {
    const c = this.statusCache.get(listId);
    if (c && Date.now() - c.at < STATUS_TTL) return c.statuses;
    const statuses = await this.cu.statuses(token, listId);
    this.statusCache.set(listId, { at: Date.now(), statuses });
    return statuses;
  }

  /**
   * Every status found in the lists the person has tasks in, per account, with whether it shows in Today — for the
   * "Show in Today" switches (spec 0012 B1).
   */
  async statuses(ownerId: string) {
    const { tasks } = await this.openTasks(ownerId);
    const out = [];
    for (const r of await this.rows(ownerId)) {
      const meta = r.meta as unknown as Meta;
      const token = await this.token(r);
      const lists = [...new Set(tasks.filter((t) => t.connectionId === r.id).map((t) => t.listId))].slice(
        0,
        30,
      );
      const seen = new Map<string, { name: string; color: string | null; type: string; order: number }>();
      const all = await Promise.all(lists.map((l) => this.listStatuses(token, l).catch(() => [])));
      for (const st of all.flat()) {
        const k = st.status.toLowerCase();
        if (!seen.has(k))
          seen.set(k, {
            name: st.status,
            color: st.color ?? null,
            type: st.type,
            order: Number(st.orderindex ?? 99),
          });
      }
      out.push({
        connectionId: r.id,
        account: r.label,
        custom: !!meta.workingStatuses,
        statuses: [...seen.entries()]
          .sort((a, b) => a[1].order - b[1].order)
          .map(([k, s]) => ({
            name: s.name,
            color: s.color,
            type: s.type,
            working: meta.workingStatuses ? meta.workingStatuses.includes(k) : defaultWorking(s.name, s.type),
          })),
      });
    }
    return out;
  }

  /** `null` = back to the default rule. */
  async setWorking(ownerId: string, connectionId: string, names: string[] | null): Promise<boolean> {
    const r = await this.one(ownerId, connectionId);
    if (!r) return false;
    const meta = { ...(r.meta as unknown as Meta) };
    meta.workingStatuses = names ? [...new Set(names.map((n) => n.toLowerCase()))] : null;
    await this.db
      .update(connections)
      .set({ meta: meta as unknown as Record<string, unknown> })
      .where(and(eq(connections.id, r.id), eq(connections.ownerId, ownerId)));
    this.invalidate(r.id);
    return true;
  }

  // ------------------------------------------------------------------ the task sheet

  /** Everything the task sheet shows, in one round trip: the task, its list's statuses, comments and my time. */
  async detail(ownerId: string, connectionId: string, taskId: string) {
    const r = await this.one(ownerId, connectionId);
    if (!r) return null;
    const token = await this.token(r);
    const meta = r.meta as unknown as Meta;
    const t = await this.cu.task(token, taskId);
    const teamId = t.team_id ?? this.teamOf(r);
    const workspace = meta.teams.find((x) => x.id === teamId)?.name ?? '';
    const [statuses, comments, time] = await Promise.all([
      this.listStatuses(token, t.list.id).catch(() => [] as ClickUpStatus[]),
      this.cu.comments(token, taskId).catch(() => []),
      this.cu.timeEntries(token, teamId, taskId).catch(() => [] as ClickUpTimeEntry[]),
    ]);
    return {
      task: {
        ...this.shape(r, workspace, { ...t, team_id: teamId }),
        description: (t.markdown_description ?? t.text_content ?? t.description ?? '').slice(0, 20_000),
        assignees: (t.assignees ?? []).map(person),
        estimateMin: t.time_estimate ? Math.round(Number(t.time_estimate) / 60_000) : null,
        subtasks: (t.subtasks ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status.status,
          statusColor: s.status.color ?? null,
          done: s.status.type === 'closed' || s.status.type === 'done',
        })),
      },
      statuses: statuses.map((s) => ({ name: s.status, color: s.color ?? null, type: s.type })),
      comments: comments
        .map((c) => ({
          id: String(c.id),
          text: c.comment_text,
          by: person(c.user),
          at: new Date(Number(c.date)).toISOString(),
          mine: String(c.user.id) === meta.userId,
        }))
        .sort((a, b) => a.at.localeCompare(b.at)),
      time: time.map((e) => entry(e)).filter((e) => !e.running),
    };
  }

  async update(
    ownerId: string,
    connectionId: string,
    taskId: string,
    set: { status?: string; priority?: number | null },
  ): Promise<boolean> {
    const r = await this.one(ownerId, connectionId);
    if (!r) return false;
    await this.cu.update(await this.token(r), taskId, set);
    // what Today shows changes at once, not after the cache runs out
    const c = this.open.get(r.id);
    if (c && set.status !== undefined) {
      const meta = r.meta as unknown as Meta;
      const t = c.tasks.find((x) => x.id === taskId);
      if (t) {
        t.status = set.status;
        t.working = meta.workingStatuses
          ? meta.workingStatuses.includes(set.status.toLowerCase())
          : defaultWorking(set.status, t.statusType);
      }
    }
    this.invalidate(r.id);
    return true;
  }

  async comment(ownerId: string, connectionId: string, taskId: string, text: string) {
    const r = await this.one(ownerId, connectionId);
    if (!r) return null;
    const c = await this.cu.addComment(await this.token(r), taskId, text);
    return { id: String(c.id), at: new Date(Number(c.date) || Date.now()).toISOString() };
  }

  async addTime(
    ownerId: string,
    connectionId: string,
    taskId: string,
    e: { teamId?: string; start: string; durationMin: number; note?: string },
  ) {
    const r = await this.one(ownerId, connectionId);
    if (!r) return null;
    const res = await this.cu.addTime(await this.token(r), this.teamOf(r, e.teamId), {
      taskId,
      start: Date.parse(e.start),
      duration: e.durationMin * 60_000,
      description: e.note,
    });
    this.invalidate(r.id);
    return res?.data ? entry(res.data) : { ok: true };
  }

  async deleteTime(ownerId: string, connectionId: string, teamId: string | undefined, entryId: string) {
    const r = await this.one(ownerId, connectionId);
    if (!r) return false;
    await this.cu.deleteTime(await this.token(r), this.teamOf(r, teamId), entryId);
    this.invalidate(r.id);
    return true;
  }

  // ------------------------------------------------------------------ the timer (one at a time, as in ClickUp)

  /** The running timer on any connected account, or null. A timer started in ClickUp shows here too. */
  async timer(ownerId: string) {
    for (const r of await this.rows(ownerId)) {
      const meta = r.meta as unknown as Meta;
      let token: string;
      try {
        token = await this.token(r);
      } catch {
        continue;
      }
      for (const team of meta.teams ?? []) {
        const e = await this.cu.runningTimer(token, team.id).catch(() => null);
        if (e)
          return {
            connectionId: r.id,
            teamId: team.id,
            entryId: e.id,
            taskId: e.task?.id ?? null,
            taskName: e.task?.name ?? 'No task',
            startedAt: new Date(Number(e.start)).toISOString(),
          };
      }
    }
    return null;
  }

  async startTimer(ownerId: string, connectionId: string, taskId: string, teamId?: string) {
    const r = await this.one(ownerId, connectionId);
    if (!r) return null;
    const token = await this.token(r);
    const team = this.teamOf(r, teamId);
    const res = await this.cu.startTimer(token, team, taskId);
    return {
      connectionId: r.id,
      teamId: team,
      entryId: res?.data?.id ?? null,
      taskId,
      taskName: res?.data?.task?.name ?? null,
      startedAt: res?.data?.start ? new Date(Number(res.data.start)).toISOString() : new Date().toISOString(),
    };
  }

  async stopTimer(ownerId: string, connectionId: string, teamId?: string) {
    const r = await this.one(ownerId, connectionId);
    if (!r) return null;
    const res = await this.cu.stopTimer(await this.token(r), this.teamOf(r, teamId));
    this.invalidate(r.id);
    return res?.data ? entry(res.data) : { ok: true };
  }
}

function person(u: {
  id: number;
  username: string | null;
  email?: string;
  color?: string | null;
  initials?: string;
  profilePicture?: string | null;
}) {
  const name = u.username || u.email || 'Someone';
  return {
    id: String(u.id),
    name,
    initials:
      u.initials ||
      name
        .split(/[\s@.]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join(''),
    color: u.color ?? null,
    avatar: u.profilePicture ?? null,
  };
}

function entry(e: ClickUpTimeEntry) {
  const ms = Number(e.duration);
  return {
    id: String(e.id),
    start: new Date(Number(e.start)).toISOString(),
    end: e.end ? new Date(Number(e.end)).toISOString() : null,
    minutes: ms > 0 ? Math.round(ms / 60_000) : 0,
    running: ms < 0,
    note: e.description ?? '',
  };
}
