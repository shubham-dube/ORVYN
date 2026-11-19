import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IpoSubscription } from '@orvyn/contracts';
import { ENV, type Env } from '../../config/env';

/** One IPO as a feed sees it; missing fields are null. */
export interface FeedIssue {
  slug: string;
  name: string;
  type: 'mainboard' | 'sme';
  status: 'upcoming' | 'open' | 'closed' | 'listed';
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  refundDate: string | null;
  listingDate: string | null;
  priceMin: number | null;
  priceMax: number | null;
  lotSize: number | null;
  issueSizeCr: number | null;
  gmp: number | null;
  gmpUpdatedAt: string | null;
  subscription: IpoSubscription | null;
  listingPrice: number | null;
  url: string | null;
}

/** Market data for the IPO desk (ADR-0013); replaced in tests. */
export abstract class IpoFeed {
  abstract readonly name: string;
  /** a link the provider's terms ask to show next to its data */
  abstract readonly credit: string | null;
  /** can it fetch at all (a key is set) */
  abstract ready(): boolean;
  /** live subscription is in the plan */
  abstract hasSubscription(): boolean;
  /** open and upcoming IPOs with GMP (one call) */
  abstract current(): Promise<FeedIssue[]>;
  /** recently closed and listed IPOs (one call) */
  abstract recent(): Promise<FeedIssue[]>;
  /** one IPO in full (dates, subscription when the plan has it) */
  abstract detail(slug: string): Promise<FeedIssue | null>;
}

@Injectable()
export class NoFeed extends IpoFeed {
  readonly name = 'manual';
  readonly credit = null;
  ready() {
    return false;
  }
  hasSubscription() {
    return false;
  }
  async current() {
    return [];
  }
  async recent() {
    return [];
  }
  async detail() {
    return null;
  }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const day = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

type Raw = Record<string, unknown>;

/** IPO Guru's REST API (https://www.ipoguru.in): `X-API-KEY`; data credited with a visible link. */
@Injectable()
export class IpoGuruFeed extends IpoFeed {
  readonly name = 'IPO Guru';
  readonly credit = 'https://www.ipoguru.in';
  private readonly log = new Logger('ipo.feed');

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  ready() {
    return !!this.env.IPO_FEED_KEY;
  }
  hasSubscription() {
    return this.env.IPO_FEED_SUBSCRIPTION;
  }

  private async get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.env.IPO_FEED_URL}${path}`, {
      headers: {
        'x-api-key': this.env.IPO_FEED_KEY ?? '',
        accept: 'application/json',
        'user-agent': 'ORVYN',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`ipo feed ${path.split('?')[0]}: ${r.status}`);
    return (await r.json()) as T;
  }

  private static list(body: unknown): Raw[] {
    if (Array.isArray(body)) return body as Raw[];
    const b = body as Raw;
    for (const k of ['data', 'ipos', 'items', 'results']) if (Array.isArray(b?.[k])) return b[k] as Raw[];
    return [];
  }

  /** Subscription from a flat summary (`total`, `qib`, `nii`, `retail`, … `applications`) or a categories list. */
  static subscription(raw: unknown): IpoSubscription | null {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Raw;
    const out: IpoSubscription = {
      total: num(s.total),
      qib: num(s.qib),
      nii: num(s.nii),
      snii: num(s.snii ?? s.sNII),
      bnii: num(s.bnii ?? s.bNII),
      retail: num(s.retail),
      employee: num(s.employee),
      shareholder: num(s.shareholder),
      applications: null,
      updatedAt: typeof s.updated_at === 'string' ? s.updated_at : null,
    };
    if (typeof s.applications === 'number' || typeof s.applications === 'string')
      out.applications = { total: num(s.applications) };
    else if (s.applications && typeof s.applications === 'object') {
      const a = s.applications as Raw;
      out.applications = { total: num(a.total), retail: num(a.retail), snii: num(a.snii ?? a.sNII) };
    }
    const cats = Array.isArray(s.categories) ? (s.categories as Raw[]) : [];
    for (const c of cats) {
      const key = String(c.key ?? '').toLowerCase();
      const times = num(c.times_value ?? c.times);
      const apps = num(c.applications);
      if (key === 'retail') {
        out.retail ??= times;
        if (apps) out.applications = { ...(out.applications ?? {}), retail: apps };
      }
      if (key === 'qib') out.qib ??= times;
      if (key === 'nii') out.nii ??= times;
      if (key === 'total') out.total ??= times;
      for (const sub of Array.isArray(c.sub_categories) ? (c.sub_categories as Raw[]) : []) {
        const sk = String(sub.key ?? sub.name ?? '').toLowerCase();
        if (sk.includes('snii') || sk.includes('small')) {
          out.snii ??= num(sub.times_value ?? sub.times);
          const sa = num(sub.applications);
          if (sa) out.applications = { ...(out.applications ?? {}), snii: sa };
        }
        if (sk.includes('bnii') || sk.includes('big')) out.bnii ??= num(sub.times_value ?? sub.times);
      }
    }
    if (s.summary && typeof s.summary === 'object' && out.total === null)
      return IpoGuruFeed.subscription(s.summary);
    return Object.values(out).some((v) => v !== null) ? out : null;
  }

  static issue(r: Raw): FeedIssue {
    const t = (r.timeline ?? {}) as Raw;
    const i = (r.issue ?? {}) as Raw;
    const g = (r.gmp ?? {}) as Raw;
    const status = String(r.status ?? '').toLowerCase();
    const listed = r.is_listed === true || status === 'listed';
    return {
      slug: String(r.slug),
      name: String(r.display_name ?? r.name ?? r.slug),
      type: String(r.type ?? '').toLowerCase() === 'sme' ? 'sme' : 'mainboard',
      status: listed ? 'listed' : status === 'open' ? 'open' : status === 'closed' ? 'closed' : 'upcoming',
      openDate: day(t.open_date ?? r.open_date),
      closeDate: day(t.close_date ?? r.close_date),
      allotmentDate: day(t.allotment_date ?? r.allotment_date),
      refundDate: day(t.refund_date ?? r.refund_date),
      listingDate: day(t.listing_date ?? r.listing_date),
      priceMin: num(i.price_min ?? r.price_min),
      priceMax: num(i.price_max ?? r.price_max ?? i.issue_price ?? r.issue_price),
      lotSize: num(i.lot_size ?? r.lot_size),
      issueSizeCr: num(i.issue_size ?? r.issue_size),
      gmp: num(g.price),
      gmpUpdatedAt: typeof g.updated_at === 'string' ? g.updated_at : null,
      subscription:
        IpoGuruFeed.subscription(r.subscription_summary) ??
        (num(r.subscription_total) !== null
          ? { ...IpoGuruFeed.empty(), total: num(r.subscription_total) }
          : null),
      listingPrice: num((r.listing as Raw | undefined)?.listing_price ?? r.listing_price),
      url: typeof r.web_url === 'string' ? r.web_url : null,
    };
  }

  static empty(): IpoSubscription {
    return {
      total: null,
      qib: null,
      nii: null,
      snii: null,
      bnii: null,
      retail: null,
      employee: null,
      shareholder: null,
      applications: null,
      updatedAt: null,
    };
  }

  async current() {
    return IpoGuruFeed.list(await this.get('/gmp')).map(IpoGuruFeed.issue);
  }

  async recent() {
    return IpoGuruFeed.list(await this.get('/ipos?months=1&limit=50')).map(IpoGuruFeed.issue);
  }

  async detail(slug: string) {
    const body = await this.get<Raw>(`/ipos/${encodeURIComponent(slug)}`);
    const r = ((body.data as Raw | undefined) ?? body) as Raw;
    if (!r?.slug) return null;
    const issue = IpoGuruFeed.issue(r);
    if (this.hasSubscription() && issue.status === 'open') {
      try {
        const sub = await this.get<Raw>(`/ipos/${encodeURIComponent(slug)}/subscription`);
        issue.subscription =
          IpoGuruFeed.subscription((sub.data as Raw | undefined) ?? sub) ?? issue.subscription;
      } catch (e) {
        this.log.warn(`subscription ${slug}: ${(e as Error).message}`);
      }
    }
    return issue;
  }
}
