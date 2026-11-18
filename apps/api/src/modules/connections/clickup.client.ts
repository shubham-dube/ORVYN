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
}
