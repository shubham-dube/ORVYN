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

export interface ClickUpTask {
  id: string;
  name: string;
  url: string;
  status: { status: string; type: string; color?: string };
  due_date: string | null;
  priority: { priority: string } | null;
  list: { id: string; name: string };
  space?: { id: string };
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
    if (!r.ok) throw new ClickUpError(r.status, `${method} ${path}: ${r.status}`);
    return (await r.json()) as T;
  }

  me(token: string) {
    return this.call<{ user: { id: number; username: string | null; email: string } }>(token, 'GET', '/user');
  }

  teams(token: string) {
    return this.call<{ teams: { id: string; name: string }[] }>(token, 'GET', '/team');
  }

  /** Open tasks assigned to this person in one workspace, soonest due first. */
  async myTasks(token: string, teamId: string, userId: string): Promise<ClickUpTask[]> {
    const q = new URLSearchParams({
      'assignees[]': userId,
      include_closed: 'false',
      subtasks: 'true',
      order_by: 'due_date',
    });
    const r = await this.call<{ tasks: ClickUpTask[] }>(token, 'GET', `/team/${teamId}/task?${q.toString()}`);
    return r.tasks;
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
