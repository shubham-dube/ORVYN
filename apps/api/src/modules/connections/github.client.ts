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
  pull_request?: unknown;
  user?: { login: string };
}

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
