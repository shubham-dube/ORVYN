import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface GitHubItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  updated_at: string;
  repository_url: string;
  pull_request?: { merged_at?: string | null; html_url?: string };
  user?: { login: string; avatar_url?: string };
  draft?: boolean;
  created_at?: string;
  closed_at?: string | null;
  comments?: number;
}

export type ReviewState = 'approved' | 'changes' | 'pending';
export type ChecksState = 'passing' | 'failing' | 'running' | 'none';

/** GitHub's REST API with a personal token (spec 0008 B). Base URL from the environment (tests: a fake). */
@Injectable()
export class GitHubClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private async call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.env.GITHUB_API}${path}`, {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ORVYN',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new GitHubError(r.status, `${method} ${path.split('?')[0]}: ${r.status}`);
    return (await r.json()) as T;
  }

  me(token: string) {
    return this.call<{ id: number; login: string; name: string | null }>(token, 'GET', '/user');
  }

  /** Open issues assigned to me and pull requests waiting for my review, newest first. */
  async work(token: string): Promise<{ kind: 'issue' | 'review'; item: GitHubItem }[]> {
    const q = (query: string) =>
      this.call<{ items: GitHubItem[] }>(
        token,
        'GET',
        `/search/issues?${new URLSearchParams({ q: query, sort: 'updated', order: 'desc', per_page: '30' })}`,
      );
    const [issues, reviews] = await Promise.all([
      q('is:open is:issue assignee:@me archived:false'),
      q('is:open is:pr review-requested:@me archived:false'),
    ]);
    return [
      ...issues.items.map((item) => ({ kind: 'issue' as const, item })),
      ...reviews.items.map((item) => ({ kind: 'review' as const, item })),
    ];
  }

  private search(token: string, query: string, per = 30) {
    return this.call<{ items: GitHubItem[] }>(
      token,
      'GET',
      `/search/issues?${new URLSearchParams({ q: query, sort: 'updated', order: 'desc', per_page: String(per) })}`,
    );
  }

  /** My pull requests: every open one, and those merged or closed since `sinceDay` (YYYY-MM-DD). */
  async myPrs(token: string, sinceDay: string): Promise<{ open: GitHubItem[]; closed: GitHubItem[] }> {
    const [open, closed] = await Promise.all([
      this.search(token, 'is:pr is:open author:@me archived:false', 50),
      this.search(token, `is:pr is:closed author:@me closed:>=${sinceDay}`, 50),
    ]);
    return { open: open.items, closed: closed.items };
  }

  /** The latest review per reviewer decides: any "changes requested" wins, then any approval. */
  async reviewState(token: string, repo: string, number: number): Promise<ReviewState> {
    const rs = await this.call<{ user?: { login: string }; state: string }[]>(
      token,
      'GET',
      `/repos/${repo}/pulls/${number}/reviews?per_page=100`,
    );
    const last = new Map<string, string>();
    for (const r of rs) if (r.state !== 'COMMENTED' && r.user) last.set(r.user.login, r.state);
    const states = [...last.values()];
    if (states.includes('CHANGES_REQUESTED')) return 'changes';
    if (states.includes('APPROVED')) return 'approved';
    return 'pending';
  }

  /** Commit statuses and check runs on the PR's head, as one word. */
  async checks(token: string, repo: string, number: number): Promise<ChecksState> {
    const pr = await this.call<{ head: { sha: string } }>(token, 'GET', `/repos/${repo}/pulls/${number}`);
    const [status, runs] = await Promise.all([
      this.call<{ state: string; total_count: number }>(
        token,
        'GET',
        `/repos/${repo}/commits/${pr.head.sha}/status`,
      ).catch(() => ({ state: 'pending', total_count: 0 })),
      this.call<{ check_runs: { status: string; conclusion: string | null }[] }>(
        token,
        'GET',
        `/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`,
      ).catch(() => ({ check_runs: [] })),
    ]);
    const bad = ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'];
    if (
      status.state === 'failure' ||
      status.state === 'error' ||
      runs.check_runs.some((r) => bad.includes(r.conclusion ?? ''))
    )
      return 'failing';
    if (
      (status.total_count > 0 && status.state === 'pending') ||
      runs.check_runs.some((r) => r.status !== 'completed')
    )
      return 'running';
    if (status.total_count === 0 && runs.check_runs.length === 0) return 'none';
    return 'passing';
  }

  /** "owner/repo" from an API repository URL. */
  static repoOf(repositoryUrl: string): string {
    return repositoryUrl.replace(/^.*\/repos\//, '');
  }

  async closeIssue(token: string, repo: string, number: number): Promise<void> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new GitHubError(400, 'bad repo');
    await this.call(token, 'PATCH', `/repos/${repo}/issues/${number}`, {
      state: 'closed',
      state_reason: 'completed',
    });
  }
}
