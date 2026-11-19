import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type ApplicationStatus,
  type ApplicationUpdate,
  formatMoney,
  type IpoCategory,
  type LedgerEntryInput,
  type NewRound,
  type PartnerAction,
  type PartnerFields,
  type SourceFields,
} from '@orvyn/contracts';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { badRequest, notFound } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { users } from '../auth/auth.schema';
import { NotifyService } from '../notify/notify.service';
import {
  ipoApplications,
  ipoIssues,
  ipoLedger,
  ipoLinks,
  ipoPartners,
  ipoRounds,
  ipoSources,
} from './ipo.schema';
import { minLots, shareOf } from './odds';

type Partner = typeof ipoPartners.$inferSelect;
type Source = typeof ipoSources.$inferSelect;
type App = typeof ipoApplications.$inferSelect;
type Issue = typeof ipoIssues.$inferSelect;
type Entry = typeof ipoLedger.$inferSelect;

const P = (rupees: number) => Math.round(rupees * 100);
const R = (paise: number) => Math.round(paise) / 100;
/** money is with the partner, waiting on the IPO */
const BLOCKING: ApplicationStatus[] = ['applied', 'mandate'];
/** cheapest money first: your own, then family, then anything else, then cards; then by fee */
const SOURCE_ORDER = { self: 0, family: 1, other: 2, card: 3 } as const;
const LINK_DAYS = 90;

/** What one application is worth once it is sold (paise). */
function outcome(a: App, issue: Pick<Issue, 'priceMax' | 'lotSize'>, partner: Pick<Partner, 'share'>) {
  const price = issue.priceMax ?? 0;
  const shares = (a.allottedLots ?? 0) * (issue.lotSize ?? 0);
  const cost = P(shares * price);
  const gain = a.soldPrice !== null ? P(shares * a.soldPrice) - cost - a.saleCostsMinor : null;
  const share = gain === null ? null : (a.shareMinor ?? P(shareOf(partner.share, R(gain))));
  return { shares, cost, gain, share };
}

/**
 * The IPO Pool (spec 0010 part B): the founder's partners, the sources of money, every movement between them, the
 * applications per IPO, and what each step earned or cost. Balances are always sums of the ledger (D-0010-2).
 */
@Injectable()
export class PoolService {
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly notify: NotifyService,
  ) {}

  // ------------------------------------------------------------------ partners and sources

  partners(ownerId: string) {
    return this.db
      .select()
      .from(ipoPartners)
      .where(eq(ipoPartners.ownerId, ownerId))
      .orderBy(ipoPartners.name);
  }

  private async partner(ownerId: string, id: string) {
    const [p] = await this.db
      .select()
      .from(ipoPartners)
      .where(and(eq(ipoPartners.id, id), eq(ipoPartners.ownerId, ownerId)));
    return p ?? null;
  }

  async savePartner(ownerId: string, id: string | null, f: PartnerFields) {
    if (id) {
      const [r] = await this.db
        .update(ipoPartners)
        .set(f)
        .where(and(eq(ipoPartners.id, id), eq(ipoPartners.ownerId, ownerId)))
        .returning();
      if (!r) throw notFound();
      return r;
    }
    const [r] = await this.db
      .insert(ipoPartners)
      .values({ ownerId, ...f })
      .returning();
    return r!;
  }

  /** Your own money is always there; the rest you add (Brother, Dad, a credit card…). */
  async sources(ownerId: string): Promise<Source[]> {
    const rows = await this.db.select().from(ipoSources).where(eq(ipoSources.ownerId, ownerId));
    if (rows.length)
      return rows.sort((a, b) => SOURCE_ORDER[a.kind] - SOURCE_ORDER[b.kind] || a.feePct - b.feePct);
    const [me] = await this.db.insert(ipoSources).values({ ownerId, name: 'Me', kind: 'self' }).returning();
    return [me!];
  }

  async saveSource(ownerId: string, id: string | null, f: SourceFields) {
    if (id) {
      const [r] = await this.db
        .update(ipoSources)
        .set(f)
        .where(and(eq(ipoSources.id, id), eq(ipoSources.ownerId, ownerId)))
        .returning();
      if (!r) throw notFound();
      return r;
    }
    const [r] = await this.db
      .insert(ipoSources)
      .values({ ownerId, ...f })
      .returning();
    return r!;
  }

  // ------------------------------------------------------------------ the ledger

  ledger(ownerId: string, o: { partnerId?: string; sourceId?: string; roundId?: string } = {}) {
    return this.db
      .select()
      .from(ipoLedger)
      .where(
        and(
          eq(ipoLedger.ownerId, ownerId),
          ...(o.partnerId ? [eq(ipoLedger.partnerId, o.partnerId)] : []),
          ...(o.sourceId ? [eq(ipoLedger.sourceId, o.sourceId)] : []),
          ...(o.roundId ? [eq(ipoLedger.roundId, o.roundId)] : []),
        ),
      )
      .orderBy(desc(ipoLedger.at), desc(ipoLedger.createdAt));
  }

  /**
   * One movement. A fund from a card writes its cost too (the card fee, as a cost of that IPO). A fund for an
   * application moves it to "funded".
   */
  async record(ownerId: string, e: LedgerEntryInput): Promise<Entry[]> {
    const needsPartner = ['fund', 'return', 'share'].includes(e.kind) || (e.kind === 'adjust' && !e.sourceId);
    const needsSource = ['fund', 'repay'].includes(e.kind);
    if (needsPartner && !e.partnerId) throw badRequest('partner_needed', 'Pick the person.');
    if (needsSource && !e.sourceId) throw badRequest('source_needed', 'Pick where the money came from.');
    const partner = e.partnerId ? await this.partner(ownerId, e.partnerId) : null;
    if (e.partnerId && !partner) throw notFound();
    const source = e.sourceId ? (await this.sources(ownerId)).find((s) => s.id === e.sourceId) : null;
    if (e.sourceId && !source) throw notFound();
    if (e.roundId && !(await this.round(ownerId, e.roundId))) throw notFound();
    const at = e.at ? new Date(e.at) : new Date(this.now());
    const [row] = await this.db
      .insert(ipoLedger)
      .values({
        ownerId,
        at,
        kind: e.kind,
        amountMinor: P(e.amount),
        sourceId: e.sourceId,
        partnerId: e.partnerId,
        roundId: e.roundId,
        applicationId: e.applicationId,
        direction: e.direction,
        method: e.method,
        note: e.note,
      })
      .returning();
    const out = [row!];
    if (e.kind === 'fund' && source && source.feePct > 0) {
      const [fee] = await this.db
        .insert(ipoLedger)
        .values({
          ownerId,
          at,
          kind: 'cost',
          amountMinor: Math.round((P(e.amount) * source.feePct) / 100),
          sourceId: source.id,
          partnerId: e.partnerId,
          roundId: e.roundId,
          method: e.method,
          note: `${source.name} fee ${source.feePct}%`,
          forEntryId: row!.id,
        })
        .returning();
      out.push(fee!);
    }
    if (e.kind === 'fund' && e.roundId && e.partnerId) {
      await this.db
        .update(ipoApplications)
        .set({ status: 'funded' })
        .where(
          and(
            eq(ipoApplications.ownerId, ownerId),
            eq(ipoApplications.roundId, e.roundId),
            eq(ipoApplications.partnerId, e.partnerId),
            eq(ipoApplications.status, 'planned'),
          ),
        );
    }
    return out;
  }

  /** A mistake: the entry goes, with the fee it wrote. */
  async unrecord(ownerId: string, id: string): Promise<boolean> {
    const gone = await this.db
      .delete(ipoLedger)
      .where(and(eq(ipoLedger.id, id), eq(ipoLedger.ownerId, ownerId)))
      .returning();
    if (!gone.length) return false;
    await this.db.delete(ipoLedger).where(and(eq(ipoLedger.ownerId, ownerId), eq(ipoLedger.forEntryId, id)));
    return true;
  }

  // ------------------------------------------------------------------ balances (always from the ledger)

  private async everything(ownerId: string) {
    const [partners, sources, entries, apps, rounds] = await Promise.all([
      this.partners(ownerId),
      this.sources(ownerId),
      this.db.select().from(ipoLedger).where(eq(ipoLedger.ownerId, ownerId)),
      this.db.select().from(ipoApplications).where(eq(ipoApplications.ownerId, ownerId)),
      this.db.select().from(ipoRounds).where(eq(ipoRounds.ownerId, ownerId)),
    ]);
    const issueIds = [...new Set(rounds.map((r) => r.issueId))];
    const issues = issueIds.length
      ? await this.db.select().from(ipoIssues).where(inArray(ipoIssues.id, issueIds))
      : [];
    return { partners, sources, entries, apps, rounds, issues };
  }

  /**
   * Each partner's position with your money: cash (what came in and stayed, plus what sales made, less what is in
   * shares now), how much of it is blocked for open bids, and what is free for the next IPO.
   */
  private positions(d: Awaited<ReturnType<PoolService['everything']>>, excludeRound?: string) {
    const issueOf = new Map(d.rounds.map((r) => [r.id, d.issues.find((i) => i.id === r.issueId)!]));
    return d.partners.map((p) => {
      let ledger = 0;
      for (const e of d.entries) {
        if (e.partnerId !== p.id) continue;
        if (e.kind === 'fund') ledger += e.amountMinor;
        if (e.kind === 'return' || e.kind === 'share') ledger -= e.amountMinor;
        if (e.kind === 'adjust' && !e.sourceId)
          ledger += e.direction === 'in' ? e.amountMinor : -e.amountMinor;
      }
      let realized = 0;
      let inShares = 0;
      let blocked = 0;
      let shareDue = 0;
      for (const a of d.apps) {
        if (a.partnerId !== p.id) continue;
        const issue = issueOf.get(a.roundId);
        if (!issue) continue;
        const o = outcome(a, issue, p);
        if (a.status === 'allotted') inShares += o.cost;
        if ((a.status === 'sold' || a.status === 'settled') && o.gain !== null) realized += o.gain;
        if (a.status === 'sold' && o.share) shareDue += o.share;
        if (BLOCKING.includes(a.status as ApplicationStatus) && a.roundId !== excludeRound)
          blocked += a.amountMinor;
      }
      const cash = ledger + realized - inShares;
      return {
        partnerId: p.id,
        name: p.name,
        cash,
        blocked,
        available: cash - blocked,
        inShares,
        shareDue,
      };
    });
  }

  async balances(ownerId: string) {
    const d = await this.everything(ownerId);
    const partners = this.positions(d);
    const sources = d.sources.map((s) => {
      let given = 0;
      let back = 0;
      let fees = 0;
      for (const e of d.entries) {
        if (e.sourceId !== s.id) continue;
        if (e.kind === 'fund') given += e.amountMinor;
        if (e.kind === 'repay' || e.kind === 'return') back += e.amountMinor;
        if (e.kind === 'cost') fees += e.amountMinor;
      }
      return {
        sourceId: s.id,
        name: s.name,
        kind: s.kind,
        given,
        back,
        fees,
        owed: s.repay ? Math.max(0, given - back) : 0,
      };
    });
    return { partners, sources };
  }

  // ------------------------------------------------------------------ rounds

  private async round(ownerId: string, id: string) {
    const [r] = await this.db
      .select()
      .from(ipoRounds)
      .where(and(eq(ipoRounds.id, id), eq(ipoRounds.ownerId, ownerId)));
    return r ?? null;
  }

  private async issue(id: string) {
    const [i] = await this.db.select().from(ipoIssues).where(eq(ipoIssues.id, id));
    return i ?? null;
  }

  async createRound(ownerId: string, b: NewRound) {
    const issue = await this.issue(b.issueId);
    if (!issue) throw notFound();
    if (!issue.priceMax || !issue.lotSize)
      throw badRequest('no_price', 'This IPO has no price or lot size yet.');
    const mine = (await this.partners(ownerId)).filter((p) => b.partnerIds.includes(p.id));
    if (mine.length !== b.partnerIds.length) throw notFound();
    let round = (
      await this.db
        .select()
        .from(ipoRounds)
        .where(and(eq(ipoRounds.ownerId, ownerId), eq(ipoRounds.issueId, issue.id)))
    )[0];
    round ??= (
      await this.db.insert(ipoRounds).values({ ownerId, issueId: issue.id, note: b.note }).returning()
    )[0]!;
    const lots = b.lots ?? minLots(b.category, issue.type, issue.priceMax, issue.lotSize);
    await this.db
      .insert(ipoApplications)
      .values(
        mine.map((p) => ({
          ownerId,
          roundId: round.id,
          partnerId: p.id,
          category: b.category,
          lots,
          amountMinor: P(lots * issue.lotSize! * issue.priceMax!),
        })),
      )
      .onConflictDoNothing();
    return this.roundView(ownerId, round.id);
  }

  async rounds(ownerId: string) {
    const d = await this.everything(ownerId);
    return d.rounds
      .map((r) => this.roundSummary(d, r))
      .sort((a, b) => (b.issue.openDate ?? '').localeCompare(a.issue.openDate ?? ''));
  }

  private roundSummary(d: Awaited<ReturnType<PoolService['everything']>>, r: (typeof d.rounds)[number]) {
    const issue = d.issues.find((i) => i.id === r.issueId)!;
    const apps = d.apps.filter((a) => a.roundId === r.id);
    let gain = 0;
    let shares = 0;
    for (const a of apps) {
      const p = d.partners.find((x) => x.id === a.partnerId)!;
      const o = outcome(a, issue, p);
      if (o.gain !== null) gain += o.gain;
      if (o.share) shares += o.share;
    }
    const costs = d.entries
      .filter((e) => e.roundId === r.id && e.kind === 'cost')
      .reduce((s, e) => s + e.amountMinor, 0);
    const count = (s: ApplicationStatus[]) =>
      apps.filter((a) => s.includes(a.status as ApplicationStatus)).length;
    return {
      id: r.id,
      note: r.note,
      issue: {
        id: issue.id,
        name: issue.name,
        status: issue.status,
        openDate: issue.openDate,
        closeDate: issue.closeDate,
        allotmentDate: issue.allotmentDate,
        listingDate: issue.listingDate,
        priceMax: issue.priceMax,
        lotSize: issue.lotSize,
        gmp: issue.gmp,
        listingPrice: issue.listingPrice,
      },
      accounts: apps.length,
      applied: count(['applied', 'mandate', 'allotted', 'not_allotted', 'sold', 'settled']),
      allotted: apps.filter((a) => (a.allottedLots ?? 0) > 0).length,
      gainMinor: gain,
      costsMinor: costs,
      sharesMinor: shares,
      netMinor: gain - costs - shares,
    };
  }

  /** One round: each application, what each partner holds, and the plan to fund the rest. */
  async roundView(ownerId: string, id: string) {
    const d = await this.everything(ownerId);
    const r = d.rounds.find((x) => x.id === id);
    if (!r) throw notFound();
    const issue = d.issues.find((i) => i.id === r.issueId)!;
    const pos = new Map(this.positions(d, id).map((p) => [p.partnerId, p]));
    const sources = d.sources.filter((s) => s.active);
    const cheapest = sources[0] ?? null;
    const apps = d.apps
      .filter((a) => a.roundId === id)
      .map((a) => {
        const p = d.partners.find((x) => x.id === a.partnerId)!;
        const o = outcome(a, issue, p);
        const holds = pos.get(p.id)!.available;
        const funded = d.entries
          .filter((e) => e.kind === 'fund' && e.roundId === id && e.partnerId === p.id)
          .reduce((s, e) => s + e.amountMinor, 0);
        const need = ['planned', 'funded'].includes(a.status) ? Math.max(0, a.amountMinor - holds) : 0;
        return {
          id: a.id,
          partner: { id: p.id, name: p.name, upi: p.upi, phone: p.phone, share: p.share },
          category: a.category,
          lots: a.lots,
          amountMinor: a.amountMinor,
          status: a.status,
          reportedBy: a.reportedBy,
          allottedLots: a.allottedLots,
          soldPrice: a.soldPrice,
          saleCostsMinor: a.saleCostsMinor,
          holdsMinor: holds,
          fundedMinor: funded,
          needMinor: need,
          suggestion:
            need > 0 && cheapest
              ? {
                  sourceId: cheapest.id,
                  source: cheapest.name,
                  feeMinor: Math.round((need * cheapest.feePct) / 100),
                }
              : null,
          gainMinor: o.gain,
          shareMinor: o.share,
          /** what they send back after a sale: the money of yours they held for it plus the gain, less their share */
          backMinor: o.gain === null ? null : a.amountMinor + o.gain - (o.share ?? 0),
        };
      });
    return {
      ...this.roundSummary(d, r),
      applications: apps,
      toSendMinor: apps.reduce((s, a) => s + a.needMinor, 0),
      feesIfCheapestMinor: apps.reduce((s, a) => s + (a.suggestion?.feeMinor ?? 0), 0),
    };
  }

  async updateApplication(
    ownerId: string,
    id: string,
    u: ApplicationUpdate,
    by: 'owner' | 'partner' = 'owner',
  ) {
    const [a] = await this.db
      .select()
      .from(ipoApplications)
      .where(and(eq(ipoApplications.id, id), eq(ipoApplications.ownerId, ownerId)));
    if (!a) throw notFound();
    const set: Partial<App> = { reportedBy: by };
    if (u.status) set.status = u.status;
    if (u.status === 'applied' && !a.appliedAt) set.appliedAt = new Date(this.now());
    if (u.allottedLots !== undefined) {
      set.allottedLots = u.allottedLots;
      if (!u.status) set.status = (u.allottedLots ?? 0) > 0 ? 'allotted' : 'not_allotted';
    }
    if (u.status === 'allotted' && u.allottedLots === undefined && !a.allottedLots) set.allottedLots = a.lots;
    if (u.status === 'not_allotted') set.allottedLots = 0;
    if (u.soldPrice !== undefined) {
      set.soldPrice = u.soldPrice;
      if (u.soldPrice !== null) {
        set.status = u.status ?? 'sold';
        set.soldAt = new Date(this.now());
        if (!a.allottedLots && set.allottedLots === undefined) set.allottedLots = a.lots;
      }
    }
    if (u.saleCosts !== undefined) set.saleCostsMinor = P(u.saleCosts);
    if (u.share !== undefined) set.shareMinor = u.share === null ? null : P(u.share);
    const [r] = await this.db.update(ipoApplications).set(set).where(eq(ipoApplications.id, id)).returning();
    return r!;
  }

  /**
   * After a sale: the partner keeps their share (written as `share`) and either sends the rest back (`return`) or
   * keeps it as float for the next IPO. The application is settled.
   */
  async settle(
    ownerId: string,
    id: string,
    b: { returned: number; method: string; sourceId?: string | null },
  ) {
    const d = await this.everything(ownerId);
    const a = d.apps.find((x) => x.id === id);
    if (!a) throw notFound();
    if (a.status !== 'sold') throw badRequest('not_sold', 'Enter the sale first.');
    const r = d.rounds.find((x) => x.id === a.roundId)!;
    const issue = d.issues.find((i) => i.id === r.issueId)!;
    const p = d.partners.find((x) => x.id === a.partnerId)!;
    const o = outcome(a, issue, p);
    if (o.share)
      await this.record(ownerId, {
        kind: 'share',
        amount: R(o.share),
        partnerId: p.id,
        roundId: r.id,
        applicationId: a.id,
        sourceId: null,
        method: 'kept',
        note: `${p.name}'s share`,
        direction: 'in',
      });
    if (b.returned > 0)
      await this.record(ownerId, {
        kind: 'return',
        amount: b.returned,
        partnerId: p.id,
        roundId: r.id,
        applicationId: a.id,
        sourceId: b.sourceId ?? null,
        method: b.method,
        note: '',
        direction: 'in',
      });
    await this.db
      .update(ipoApplications)
      .set({ status: 'settled', settledAt: new Date(this.now()), shareMinor: o.share })
      .where(eq(ipoApplications.id, a.id));
    return this.roundView(ownerId, r.id);
  }

  // ------------------------------------------------------------------ where the profit went

  async summary(ownerId: string) {
    const d = await this.everything(ownerId);
    const rounds = d.rounds.map((r) => this.roundSummary(d, r));
    const sum = (k: 'gainMinor' | 'costsMinor' | 'sharesMinor' | 'netMinor') =>
      rounds.reduce((s, r) => s + r[k], 0);
    const otherCosts = d.entries
      .filter((e) => e.kind === 'cost' && !e.roundId)
      .reduce((s, e) => s + e.amountMinor, 0);
    const pos = this.positions(d);
    const bal = await this.balances(ownerId);
    const fromMe = d.entries
      .filter((e) => e.kind === 'fund' && d.sources.find((s) => s.id === e.sourceId)?.kind === 'self')
      .reduce((s, e) => s + e.amountMinor, 0);
    const home = d.entries
      .filter((e) => e.kind === 'return' && !e.sourceId)
      .reduce((s, e) => s + e.amountMinor, 0);
    return {
      gainMinor: sum('gainMinor'),
      costsMinor: sum('costsMinor') + otherCosts,
      sharesMinor: sum('sharesMinor'),
      netMinor: sum('netMinor') - otherCosts,
      /** money of yours with partners right now (cash), and in shares not sold yet (at cost) */
      withPartnersMinor: pos.reduce((s, p) => s + p.cash, 0),
      inSharesMinor: pos.reduce((s, p) => s + p.inShares, 0),
      sharesDueMinor: pos.reduce((s, p) => s + p.shareDue, 0),
      owedMinor: bal.sources.reduce((s, x) => s + x.owed, 0),
      fromMeMinor: fromMe,
      backHomeMinor: home,
      rounds,
      partners: pos,
      sources: bal.sources,
    };
  }

  // ------------------------------------------------------------------ for the desk: what a new IPO would cost

  /** How many accounts can bid in a category, and the card cost of topping them up to `amount` (paise). */
  async readiness(ownerId: string, category: IpoCategory, amountMinor: number) {
    const d = await this.everything(ownerId);
    const eligible = d.partners.filter((p) => p.active && p.categories.includes(category));
    const pos = new Map(this.positions(d).map((p) => [p.partnerId, p]));
    const cheapest = d.sources.find((s) => s.active) ?? null;
    let fee = 0;
    for (const p of eligible) {
      const need = Math.max(0, amountMinor - pos.get(p.id)!.available);
      fee += cheapest ? (need * cheapest.feePct) / 100 : 0;
    }
    return { accounts: eligible.length, cardCostMinor: Math.round(fee) };
  }

  // ------------------------------------------------------------------ partner links (ADR-0013)

  private static hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async createLink(ownerId: string, partnerId: string) {
    if (!(await this.partner(ownerId, partnerId))) throw notFound();
    await this.db
      .update(ipoLinks)
      .set({ revokedAt: new Date(this.now()) })
      .where(
        and(eq(ipoLinks.partnerId, partnerId), eq(ipoLinks.ownerId, ownerId), isNull(ipoLinks.revokedAt)),
      );
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now() + LINK_DAYS * 86_400_000);
    await this.db
      .insert(ipoLinks)
      .values({ ownerId, partnerId, tokenHash: PoolService.hash(token), expiresAt });
    return { url: `${this.env.WEB_URL}/p/${token}`, expiresAt: expiresAt.toISOString() };
  }

  async revokeLinks(ownerId: string, partnerId: string) {
    await this.db
      .update(ipoLinks)
      .set({ revokedAt: new Date(this.now()) })
      .where(
        and(eq(ipoLinks.partnerId, partnerId), eq(ipoLinks.ownerId, ownerId), isNull(ipoLinks.revokedAt)),
      );
  }

  private async byToken(token: string) {
    if (!/^[\w-]{20,100}$/.test(token)) return null;
    const [l] = await this.db
      .select()
      .from(ipoLinks)
      .where(
        and(
          eq(ipoLinks.tokenHash, PoolService.hash(token)),
          isNull(ipoLinks.revokedAt),
          gt(ipoLinks.expiresAt, new Date(this.now())),
        ),
      );
    if (!l) return null;
    const p = await this.partner(l.ownerId, l.partnerId);
    return p ? { link: l, partner: p } : null;
  }

  /** What a partner sees: only their own open items and what they hold. */
  async partnerPage(token: string) {
    const hit = await this.byToken(token);
    if (!hit) return null;
    const { link, partner } = hit;
    await this.db
      .update(ipoLinks)
      .set({ lastUsedAt: new Date(this.now()) })
      .where(eq(ipoLinks.id, link.id));
    const d = await this.everything(link.ownerId);
    const [owner] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, link.ownerId));
    const pos = this.positions(d).find((p) => p.partnerId === partner.id)!;
    const items = d.apps
      .filter((a) => a.partnerId === partner.id && a.status !== 'settled')
      .map((a) => {
        const r = d.rounds.find((x) => x.id === a.roundId)!;
        const issue = d.issues.find((i) => i.id === r.issueId)!;
        const o = outcome(a, issue, partner);
        return {
          id: a.id,
          ipo: issue.name,
          closeDate: issue.closeDate,
          allotmentDate: issue.allotmentDate,
          listingDate: issue.listingDate,
          price: issue.priceMax,
          lots: a.lots,
          shares: a.lots * (issue.lotSize ?? 0),
          amount: R(a.amountMinor),
          category: a.category,
          status: a.status,
          allottedLots: a.allottedLots,
          soldPrice: a.soldPrice,
          gain: o.gain === null ? null : R(o.gain),
          yourShare: o.share === null ? null : R(o.share),
          sendBack: o.gain === null ? null : R(a.amountMinor + o.gain - (o.share ?? 0)),
        };
      });
    return {
      partner: partner.name,
      owner: (owner?.name ?? '').split(' ')[0] || 'your friend',
      holds: R(pos.cash),
      blocked: R(pos.blocked),
      inShares: R(pos.inShares),
      shareRule: partner.share,
      items,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  /** A partner says what they did; the owner gets a ping. */
  async partnerAct(token: string, appId: string, act: PartnerAction) {
    const hit = await this.byToken(token);
    if (!hit) return null;
    const { link, partner } = hit;
    const [a] = await this.db
      .select()
      .from(ipoApplications)
      .where(
        and(
          eq(ipoApplications.id, appId),
          eq(ipoApplications.partnerId, partner.id),
          eq(ipoApplications.ownerId, link.ownerId),
        ),
      );
    if (!a || a.status === 'settled') return null;
    const u: ApplicationUpdate =
      act.action === 'allotted'
        ? { status: 'allotted', allottedLots: act.lots ?? a.lots }
        : act.action === 'not_allotted'
          ? { status: 'not_allotted' }
          : act.action === 'sold'
            ? { soldPrice: act.price ?? null, ...(act.lots ? { allottedLots: act.lots } : {}) }
            : { status: act.action };
    if (act.action === 'sold' && !act.price) throw badRequest('price_needed', 'Enter the price you sold at.');
    await this.updateApplication(link.ownerId, a.id, u, 'partner');
    const r = await this.round(link.ownerId, a.roundId);
    const issue = r ? await this.issue(r.issueId) : null;
    const words = {
      applied: 'applied',
      mandate: 'accepted the UPI mandate',
      allotted: 'got an allotment 🎉',
      not_allotted: 'was not allotted',
      sold: `sold at ₹${act.price}`,
    }[act.action];
    await this.notify.send({
      userId: link.ownerId,
      module: 'ipo',
      kind: 'pool',
      title: `${partner.name} ${words}`,
      body: issue ? `${issue.name} · ${formatMoney(a.amountMinor)}` : '',
      url: r ? `/ipo/pool/rounds/${r.id}` : '/ipo',
      dedupeKey: `ipo:pool:${a.id}:${act.action}`,
    });
    return this.partnerPage(token);
  }
}
