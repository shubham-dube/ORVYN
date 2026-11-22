import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

export class ClickUpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ClickUpUser {
  id: number;
  username: string | null;
  email?: string;
  color?: string | null;
  initials?: string;
  profilePicture?: string | null;
}

export interface ClickUpStatus {
  status: string;
  type: string;
  color?: string;
  orderindex?: number | string;
}

export interface ClickUpTask {
  id: string;
  name: string;
  url: string;
  status: ClickUpStatus;
  due_date: string | null;
  priority: { priority: string; color?: string } | null;
  list: { id: string; name: string };
  folder?: { id: string; name: string; hidden?: boolean };
  space?: { id: string };
  team_id?: string;
  parent?: string | null;
  time_spent?: number | null;
  time_estimate?: number | null;
  date_updated?: string;
  date_closed?: string | null;
  date_done?: string | null;
  assignees?: ClickUpUser[];
  description?: string | null;
  markdown_description?: string | null;
  text_content?: string | null;
  subtasks?: ClickUpTask[];
}

export interface ClickUpComment {
  id: string;
  comment_text: string;
  user: ClickUpUser;
  date: string;
}

export interface ClickUpTimeEntry {
  id: string;
  task?: { id: string; name: string } | null;
  user?: ClickUpUser;
  start: string;
  end?: string | null;
  /** milliseconds; negative while the timer runs */
  duration: string | number;
  description?: string;
  billable?: boolean;
}

/** A small client for ClickUp's v2 API with a personal token (spec 0007 C2). Base URL from the environment. */
@Injectable()
export class ClickUpClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private async call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.env.CLICKUP_API}${path}`, {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new ClickUpError(r.status, `${method} ${path.split('?')[0]}: ${r.status}`);
    const text = await r.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  me(token: string) {
    return this.call<{ user: { id: number; username: string | null; email: string } }>(token, 'GET', '/user');
  }

  teams(token: string) {
    return this.call<{ teams: { id: string; name: string }[] }>(token, 'GET', '/team');
  }

  /**
   * Tasks assigned to this person in one workspace. Open ones by default; `closedSince` (ms) gives the done/closed
   * ones updated since then. Up to 3 pages of 100.
   */
  async myTasks(
    token: string,
    teamId: string,
    userId: string,
    o: { closedSince?: number } = {},
  ): Promise<ClickUpTask[]> {
    const out: ClickUpTask[] = [];
    for (let page = 0; page < 3; page++) {
      const q = new URLSearchParams({
        'assignees[]': userId,
        include_closed: o.closedSince ? 'true' : 'false',
        subtasks: 'true',
        order_by: o.closedSince ? 'updated' : 'due_date',
        page: String(page),
        ...(o.closedSince ? { date_updated_gt: String(o.closedSince) } : {}),
      });
      const r = await this.call<{ tasks: ClickUpTask[]; last_page?: boolean }>(
        token,
        'GET',
        `/team/${teamId}/task?${q.toString()}`,
      );
      out.push(...r.tasks.map((t) => ({ ...t, team_id: t.team_id ?? teamId })));
      if (r.tasks.length < 100 || r.last_page !== false) break;
    }
    return o.closedSince ? out.filter((t) => t.status.type === 'closed' || t.status.type === 'done') : out;
  }

  /** One task with its subtasks and its description as markdown. */
  task(token: string, taskId: string) {
    return this.call<ClickUpTask>(
      token,
      'GET',
      `/task/${encodeURIComponent(taskId)}?include_subtasks=true&include_markdown_description=true`,
    );
  }

  /** A list's statuses, in ClickUp's order. */
  async statuses(token: string, listId: string): Promise<ClickUpStatus[]> {
    const l = await this.call<{ statuses?: ClickUpStatus[] }>(
      token,
      'GET',
      `/list/${encodeURIComponent(listId)}`,
    );
    return [...(l.statuses ?? [])].sort((a, b) => Number(a.orderindex ?? 0) - Number(b.orderindex ?? 0));
  }

  async update(token: string, taskId: string, set: { status?: string; priority?: number | null }) {
    await this.call(token, 'PUT', `/task/${encodeURIComponent(taskId)}`, set);
  }

  async comments(token: string, taskId: string): Promise<ClickUpComment[]> {
    const r = await this.call<{ comments: ClickUpComment[] }>(
      token,
      'GET',
      `/task/${encodeURIComponent(taskId)}/comment`,
    );
    return r.comments;
  }

  addComment(token: string, taskId: string, text: string) {
    return this.call<{ id: string | number; date: number | string }>(
      token,
      'POST',
      `/task/${encodeURIComponent(taskId)}/comment`,
      { comment_text: text, notify_all: false },
    );
  }

  /** My time entries on a task over the last year (ClickUp returns only the caller's own by default). */
  async timeEntries(token: string, teamId: string, taskId: string): Promise<ClickUpTimeEntry[]> {
    const now = Date.now();
    const q = new URLSearchParams({
      task_id: taskId,
      start_date: String(now - 365 * 86_400_000),
      end_date: String(now + 86_400_000),
    });
    const r = await this.call<{ data: ClickUpTimeEntry[] }>(
      token,
      'GET',
      `/team/${teamId}/time_entries?${q.toString()}`,
    );
    return r.data ?? [];
  }

  async runningTimer(token: string, teamId: string): Promise<ClickUpTimeEntry | null> {
    const r = await this.call<{ data: ClickUpTimeEntry | null }>(
      token,
      'GET',
      `/team/${teamId}/time_entries/current`,
    );
    return r.data && r.data.id ? r.data : null;
  }

  startTimer(token: string, teamId: string, taskId: string) {
    return this.call<{ data: ClickUpTimeEntry }>(token, 'POST', `/team/${teamId}/time_entries/start`, {
      tid: taskId,
    });
  }

  stopTimer(token: string, teamId: string) {
    return this.call<{ data: ClickUpTimeEntry }>(token, 'POST', `/team/${teamId}/time_entries/stop`, {});
  }

  /** A finished entry: start (ms) and duration (ms). */
  addTime(
    token: string,
    teamId: string,
    e: { taskId: string; start: number; duration: number; description?: string; billable?: boolean },
  ) {
    return this.call<{ data: ClickUpTimeEntry }>(token, 'POST', `/team/${teamId}/time_entries`, {
      tid: e.taskId,
      start: e.start,
      duration: e.duration,
      ...(e.description ? { description: e.description } : {}),
      ...(e.billable !== undefined ? { billable: e.billable } : {}),
    });
  }

  async deleteTime(token: string, teamId: string, entryId: string): Promise<void> {
    await this.call(token, 'DELETE', `/team/${teamId}/time_entries/${encodeURIComponent(entryId)}`);
  }

  /** Closes a task with its list's own "closed" status (lists name their statuses differently). */
  async complete(token: string, taskId: string): Promise<void> {
    const t = await this.call<ClickUpTask>(token, 'GET', `/task/${encodeURIComponent(taskId)}`);
    const list = await this.call<{ statuses?: { status: string; type: string }[] }>(
      token,
      'GET',
      `/list/${t.list.id}`,
    );
    const closed =
      list.statuses?.find((s) => s.type === 'closed') ?? list.statuses?.find((s) => s.type === 'done');
    await this.call(token, 'PUT', `/task/${encodeURIComponent(taskId)}`, {
      status: closed?.status ?? 'complete',
    });
  }

  /** Every list in a workspace (folderless lists and those in folders), for "add a task to…". */
  async lists(token: string, teamId: string): Promise<{ id: string; name: string; space: string }[]> {
    const spaces = await this.call<{ spaces: { id: string; name: string }[] }>(
      token,
      'GET',
      `/team/${teamId}/space?archived=false`,
    );
    const out: { id: string; name: string; space: string }[] = [];
    for (const sp of spaces.spaces.slice(0, 20)) {
      const [loose, folders] = await Promise.all([
        this.call<{ lists: { id: string; name: string }[] }>(
          token,
          'GET',
          `/space/${sp.id}/list?archived=false`,
        ),
        this.call<{ folders: { name: string; lists: { id: string; name: string }[] }[] }>(
          token,
          'GET',
          `/space/${sp.id}/folder?archived=false`,
        ),
      ]);
      for (const l of loose.lists) out.push({ id: l.id, name: l.name, space: sp.name });
      for (const f of folders.folders)
        for (const l of f.lists) out.push({ id: l.id, name: `${f.name} / ${l.name}`, space: sp.name });
    }
    return out;
  }

  /** A new task in a list, assigned to me. Due is milliseconds since epoch (ClickUp's form). */
  createTask(
    token: string,
    listId: string,
    t: { name: string; due: number | null; dueTime: boolean; assignee: number },
  ) {
    return this.call<ClickUpTask>(token, 'POST', `/list/${encodeURIComponent(listId)}/task`, {
      name: t.name,
      assignees: [t.assignee],
      ...(t.due ? { due_date: t.due, due_date_time: t.dueTime } : {}),
    });
  }

  async setDue(token: string, taskId: string, due: number | null, dueTime: boolean): Promise<void> {
    await this.call(token, 'PUT', `/task/${encodeURIComponent(taskId)}`, {
      due_date: due,
      due_date_time: dueTime,
    });
  }
}
