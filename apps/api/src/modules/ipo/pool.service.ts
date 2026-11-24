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
  POOL_MESSAGE_KINDS,
  POOL_PLACEHOLDERS,
  type PoolMessageKind,
  type PoolMessageRequest,
  type PoolStage,
  type PoolTemplates,
  POOL_STAGES,
  type RosterSet,
  type SourceFields,
  STAGE_OF,
} from '@orvyn/contracts';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
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
  ipoPoolSettings,
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
/** got a bid in */
const DID_APPLY: ApplicationStatus[] = ['applied', 'mandate', 'allotted', 'not_allotted', 'sold', 'settled'];
/** before any result: going back to one of these clears the allotment and the sale */
const BEFORE_RESULT: ApplicationStatus[] = [
  'to_ask',
  'asked',
  'planned',
  'funded',
  'applied',
  'mandate',
  'declined',
  'no_reply',
  'missed',
];
/** a partner's private page shows only what is theirs to act on */
const HIDDEN_FROM_PARTNER: ApplicationStatus[] = ['to_ask', 'declined', 'no_reply', 'missed', 'settled'];
type By = 'owner' | 'partner' | 'auto';
type Step = { status: string; at: string; by: By };

/** ORVYN's words for each moment (spec 0018 D); the owner can rewrite any of them. */
export const DEFAULT_TEMPLATES: Record<PoolMessageKind, string> = {
  ask: 'Hi {name}! {ipo} is open till {closes}. Will you apply this time? It’s {lots} lot(s), {amount}. GMP {gmp}. {missedLast}',
  apply:
    'Hi {name}, please apply to {ipo}: {lots} lot(s) ({amount}) before {closes}. Accept the UPI mandate after. Tap here when done: {link}',
  mandate:
    'Hi {name}, your {ipo} bid is in 👍 Please approve the UPI mandate in your UPI app ({upi}) before {closes}.',
  allotment: 'Hi {name}, the {ipo} allotment is out. Did you get it? Tell me here: {link}',
  settle: 'Hi {name}, {ipo} is sold 🎉 Please send back {back}. Thank you!',
};

/** "5 pm, Wed 26 Nov" */
function closesAt(date: string | null) {
  if (!date) return 'it closes';
  const d = new Date(`${date}T00:00:00Z`);
  return `5 pm, ${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
}

/** wa.me wants the number with its country code and digits only; a 10-digit number is Indian. */
export function whatsappUrl(phone: string, text: string) {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '');
  const to = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export function render(template: string, v: Record<string, string>) {
  return template
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k]! : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

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
      // money sent means a yes: whoever was still being asked moves to "money sent"
      await this.db
        .update(ipoApplications)
        .set({
          status: 'funded',
          history: sql`${ipoApplications.history} || ${JSON.stringify([this.step('funded', 'owner')])}::jsonb`,
        })
        .where(
          and(
            eq(ipoApplications.ownerId, ownerId),
            eq(ipoApplications.roundId, e.roundId),
            eq(ipoApplications.partnerId, e.partnerId),
            inArray(ipoApplications.status, ['to_ask', 'asked', 'planned']),
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
    if (mine.length)
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
            status: b.status,
            history: [this.step(b.status, 'owner')],
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
      accounts: apps.filter((a) =>
        ['will_apply', 'applied', 'mandate'].includes(STAGE_OF[a.status as ApplicationStatus]),
      ).length,
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
          stage: STAGE_OF[a.status as ApplicationStatus] ?? 'not_asked',
          history: a.history,
          canUndo: a.history.length > 1 && a.status !== 'settled',
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
    const records = this.records(d, id);
    const inRound = new Map(apps.map((a) => [a.partner.id, a]));
    const roster = d.partners
      .filter((p) => p.active || inRound.has(p.id))
      .map((p) => {
        const a = inRound.get(p.id);
        return {
          partner: {
            id: p.id,
            name: p.name,
            phone: p.phone,
            upi: p.upi,
            relation: p.relation,
            categories: p.categories,
          },
          applicationId: a?.id ?? null,
          status: a?.status ?? null,
          stage: a ? a.stage : null,
          record: records.get(p.id)!,
        };
      });
    return {
      ...this.roundSummary(d, r),
      applications: apps,
      roster,
      board: this.board(
        d.apps.filter((a) => a.roundId === id),
        d.partners,
      ),
      closed: !!r.closedAt,
      closesAt: issue.closeDate ? closesAt(issue.closeDate) : null,
      toSendMinor: apps.reduce((s, a) => s + a.needMinor, 0),
      feesIfCheapestMinor: apps.reduce((s, a) => s + (a.suggestion?.feeMinor ?? 0), 0),
    };
  }

  private step(status: string, by: By): Step {
    return { status, at: new Date(this.now()).toISOString(), by };
  }

  /** Counts by stage and the names behind the ones that matter at the close (spec 0018 C). */
  private board(apps: App[], partners: Partner[]) {
    const name = (a: App) => partners.find((p) => p.id === a.partnerId)?.name ?? '';
    const names = (s: ApplicationStatus[]) =>
      apps
        .filter((a) => s.includes(a.status as ApplicationStatus))
        .map(name)
        .sort((x, y) => x.localeCompare(y));
    const stages = Object.fromEntries(POOL_STAGES.map((k) => [k, 0])) as Record<PoolStage, number>;
    for (const a of apps) stages[STAGE_OF[a.status as ApplicationStatus] ?? 'not_asked']++;
    return {
      stages,
      applied: stages.applied + stages.mandate,
      mandates: stages.mandate,
      notYet: names(['to_ask', 'asked', 'planned', 'funded']),
      mandatePending: names(['applied']),
      missed: names(['missed']),
      noReply: names(['no_reply']),
      declined: names(['declined']),
    };
  }

  /** Each partner's track record from the other rounds that have closed (spec 0018 B). */
  private records(d: Awaited<ReturnType<PoolService['everything']>>, exceptRound?: string) {
    const closeOf = (roundId: string) => {
      const r = d.rounds.find((x) => x.id === roundId);
      return d.issues.find((i) => i.id === r?.issueId);
    };
    const created = (roundId: string) => d.rounds.find((r) => r.id === roundId)?.createdAt.getTime() ?? 0;
    const past = d.apps
      .filter((a) => a.roundId !== exceptRound && d.rounds.find((r) => r.id === a.roundId)?.closedAt)
      .sort(
        (a, b) =>
          (closeOf(a.roundId)?.closeDate ?? '').localeCompare(closeOf(b.roundId)?.closeDate ?? '') ||
          created(a.roundId) - created(b.roundId),
      );
    return new Map(
      d.partners.map((p) => {
        const mine = past.filter(
          (a) => a.partnerId === p.id && a.status !== 'to_ask' && a.status !== 'declined',
        );
        const applied = mine.filter((a) => DID_APPLY.includes(a.status as ApplicationStatus)).length;
        const missedApps = mine.filter((a) => a.status === 'missed' || a.status === 'no_reply');
        const last = mine.at(-1);
        const lastMissed = missedApps.at(-1);
        return [
          p.id,
          {
            applied,
            of: mine.length,
            missed: missedApps.length,
            lastMissed: lastMissed ? (closeOf(lastMissed.roundId)?.name ?? null) : null,
            /** the most recent round they were in, they missed */
            missedLast: !!last && (last.status === 'missed' || last.status === 'no_reply'),
          },
        ] as const;
      }),
    );
  }

  // ------------------------------------------------------------------ the roster (spec 0018 A)

  /** Add people to the round, or move them (one or many): any status, forward or back. */
  async setRoster(ownerId: string, roundId: string, b: RosterSet) {
    const r = await this.round(ownerId, roundId);
    if (!r) throw notFound();
    const issue = (await this.issue(r.issueId))!;
    const partners = (await this.partners(ownerId)).filter((p) => b.partnerIds.includes(p.id));
    if (partners.length !== new Set(b.partnerIds).size) throw notFound();
    const apps = await this.db
      .select()
      .from(ipoApplications)
      .where(and(eq(ipoApplications.ownerId, ownerId), eq(ipoApplications.roundId, roundId)));
    for (const p of partners) {
      const a = apps.find((x) => x.partnerId === p.id);
      const category = b.category ?? a?.category ?? (p.categories.includes('retail') ? 'retail' : 'snii');
      const lots =
        b.lots ??
        (a && !b.category ? a.lots : minLots(category, issue.type, issue.priceMax ?? 0, issue.lotSize ?? 1));
      const amountMinor = P(lots * (issue.lotSize ?? 0) * (issue.priceMax ?? 0));
      if (!a) {
        await this.db
          .insert(ipoApplications)
          .values({
            ownerId,
            roundId,
            partnerId: p.id,
            category,
            lots,
            amountMinor,
            status: b.status,
            history: [this.step(b.status, 'owner')],
            ...(b.status === 'applied' ? { appliedAt: new Date(this.now()) } : {}),
          })
          .onConflictDoNothing();
        continue;
      }
      if (a.status === 'settled' || a.status === 'sold')
        throw badRequest(
          'settled',
          `${p.name}’s ${a.status === 'sold' ? 'sale' : 'settlement'} is recorded already.`,
        );
      if (b.lots || b.category)
        await this.db
          .update(ipoApplications)
          .set({ lots, category, amountMinor })
          .where(eq(ipoApplications.id, a.id));
      if (a.status !== b.status) await this.updateApplication(ownerId, a.id, { status: b.status });
    }
    return this.roundView(ownerId, roundId);
  }

  /** Out of the round — only while nothing about them is in the ledger (D-0018-5). */
  async removeFromRound(ownerId: string, roundId: string, partnerId: string) {
    const [a] = await this.db
      .select()
      .from(ipoApplications)
      .where(
        and(
          eq(ipoApplications.ownerId, ownerId),
          eq(ipoApplications.roundId, roundId),
          eq(ipoApplications.partnerId, partnerId),
        ),
      );
    if (!a) throw notFound();
    const [money] = await this.db
      .select({ id: ipoLedger.id })
      .from(ipoLedger)
      .where(
        and(
          eq(ipoLedger.ownerId, ownerId),
          or(
            eq(ipoLedger.applicationId, a.id),
            and(eq(ipoLedger.roundId, roundId), eq(ipoLedger.partnerId, partnerId)),
          ),
        ),
      )
      .limit(1);
    if (money)
      throw badRequest('has_money', 'Money is recorded for them in this round — remove those entries first.');
    await this.db.delete(ipoApplications).where(eq(ipoApplications.id, a.id));
    return this.roundView(ownerId, roundId);
  }

  /** Back to the status before the last change. */
  async undo(ownerId: string, id: string) {
    const [a] = await this.db
      .select()
      .from(ipoApplications)
      .where(and(eq(ipoApplications.id, id), eq(ipoApplications.ownerId, ownerId)));
    if (!a) throw notFound();
    if (a.status === 'settled') throw badRequest('settled', 'A settled one stays settled.');
    if (a.history.length < 2) throw badRequest('nothing_to_undo', 'Nothing to undo.');
    const prev = a.history[a.history.length - 2]!.status as ApplicationStatus;
    await this.db
      .update(ipoApplications)
      .set({
        status: prev,
        history: a.history.slice(0, -1),
        reportedBy: 'owner',
        ...(BEFORE_RESULT.includes(prev) ? { allottedLots: null, soldPrice: null, soldAt: null } : {}),
        ...(DID_APPLY.includes(prev) ? {} : { appliedAt: null }),
      })
      .where(eq(ipoApplications.id, a.id));
    return this.roundView(ownerId, a.roundId);
  }

  // ------------------------------------------------------------------ messages in my words (spec 0018 D)

  async templates(ownerId: string) {
    const [row] = await this.db.select().from(ipoPoolSettings).where(eq(ipoPoolSettings.ownerId, ownerId));
    const mine = row?.templates ?? {};
    return {
      templates: Object.fromEntries(
        POOL_MESSAGE_KINDS.map((k) => [k, mine[k] || DEFAULT_TEMPLATES[k]]),
      ) as Record<PoolMessageKind, string>,
      custom: POOL_MESSAGE_KINDS.filter((k) => !!mine[k]),
      defaults: DEFAULT_TEMPLATES,
      placeholders: POOL_PLACEHOLDERS,
    };
  }

  /** A blank or null one goes back to ORVYN's words. */
  async saveTemplates(ownerId: string, t: PoolTemplates) {
    const [row] = await this.db.select().from(ipoPoolSettings).where(eq(ipoPoolSettings.ownerId, ownerId));
    const next: Record<string, string> = { ...(row?.templates ?? {}) };
    for (const k of POOL_MESSAGE_KINDS) {
      if (!(k in t)) continue;
      const v = t[k]?.trim();
      if (v && v !== DEFAULT_TEMPLATES[k]) next[k] = v;
      else delete next[k];
    }
    await this.db
      .insert(ipoPoolSettings)
      .values({ ownerId, templates: next })
      .onConflictDoUpdate({
        target: ipoPoolSettings.ownerId,
        set: { templates: next, updatedAt: new Date() },
      });
    return this.templates(ownerId);
  }

  /**
   * The message for each person, rendered here so the web and the phone send the same words, with its wa.me link.
   * Asking moves "to ask" to "asked" (and puts someone not in the round yet into it).
   */
  async messages(ownerId: string, roundId: string, b: PoolMessageRequest) {
    const view = await this.roundView(ownerId, roundId);
    const { templates } = await this.templates(ownerId);
    const template = templates[b.kind];
    const issue = (await this.issue(view.issue.id))!;
    const out: { partnerId: string; name: string; phone: string; text: string; url: string }[] = [];
    const toAsk: string[] = [];
    for (const pid of [...new Set(b.partnerIds)]) {
      const row = view.roster.find((x) => x.partner.id === pid);
      if (!row) throw notFound();
      const a = view.applications.find((x) => x.partner.id === pid);
      const lots = a?.lots ?? minLots('retail', issue.type, issue.priceMax ?? 0, issue.lotSize ?? 1);
      const link = template.includes('{link}') ? (await this.createLink(ownerId, pid)).url : '';
      const text = render(template, {
        name: row.partner.name.split(' ')[0] ?? row.partner.name,
        ipo: issue.name,
        lots: String(lots),
        amount: formatMoney(a?.amountMinor ?? P(lots * (issue.lotSize ?? 0) * (issue.priceMax ?? 0))),
        closes: closesAt(issue.closeDate),
        link,
        upi: row.partner.upi || 'your UPI app',
        gmp:
          issue.gmp !== null && issue.priceMax
            ? `₹${issue.gmp} (${Math.round((issue.gmp / issue.priceMax) * 100)}%)`
            : 'not out yet',
        back: a?.backMinor != null ? formatMoney(a.backMinor) : '',
        missedLast:
          row.record.missedLast && row.record.lastMissed
            ? `Last time ${row.record.lastMissed} slipped by, so a quick yes or no helps 🙂`
            : '',
      });
      out.push({
        partnerId: pid,
        name: row.partner.name,
        phone: row.partner.phone,
        text,
        url: whatsappUrl(row.partner.phone, text),
      });
      if (b.kind === 'ask' && (!a || a.status === 'to_ask')) toAsk.push(pid);
    }
    if (toAsk.length) await this.setRoster(ownerId, roundId, { partnerIds: toAsk, status: 'asked' });
    return out;
  }

  // ------------------------------------------------------------------ the close (spec 0018 C)

  /**
   * Bidding closes at 5 pm on the close day: whoever said yes and didn't apply missed it, whoever was asked and never
   * answered gave no reply, and the owner gets one summary. Rounds long past close quietly (no late pings).
   */
  async closeDue(today: string, hhmm: string): Promise<number> {
    const due = await this.db
      .select({ round: ipoRounds, issue: ipoIssues })
      .from(ipoRounds)
      .innerJoin(ipoIssues, eq(ipoIssues.id, ipoRounds.issueId))
      .where(
        and(
          isNull(ipoRounds.closedAt),
          hhmm >= '17:00' ? lte(ipoIssues.closeDate, today) : sql`${ipoIssues.closeDate} < ${today}`,
        ),
      );
    const stale = new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
    let n = 0;
    for (const { round, issue } of due) {
      const at = new Date(this.now());
      await this.db.update(ipoRounds).set({ closedAt: at }).where(eq(ipoRounds.id, round.id));
      if ((issue.closeDate ?? '') < stale) continue;
      for (const [from, to] of [
        [['planned', 'funded'], 'missed'],
        [['asked'], 'no_reply'],
      ] as const)
        await this.db
          .update(ipoApplications)
          .set({
            status: to,
            history: sql`${ipoApplications.history} || ${JSON.stringify([this.step(to, 'auto')])}::jsonb`,
          })
          .where(and(eq(ipoApplications.roundId, round.id), inArray(ipoApplications.status, [...from])));
      const apps = await this.db.select().from(ipoApplications).where(eq(ipoApplications.roundId, round.id));
      if (!apps.some((a) => a.status !== 'to_ask')) continue;
      const partners = await this.partners(round.ownerId);
      const b = this.board(apps, partners);
      const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
      const lost = [...b.missed, ...b.noReply];
      await this.notify.send({
        userId: round.ownerId,
        module: 'ipo',
        kind: 'pool',
        type: 'ipo.closed',
        title: `${issue.name} closed: ${b.applied} applied · ${plural(b.mandates, 'mandate')}${lost.length ? ` · ${lost.length} missed` : ''}`,
        body:
          [
            b.missed.length ? `Missed: ${b.missed.join(', ')}.` : '',
            b.noReply.length ? `No reply: ${b.noReply.join(', ')}.` : '',
            b.mandatePending.length ? `Mandate pending: ${b.mandatePending.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join(' ') || 'Everyone who said yes got their bid in. 🎉',
        url: `/ipo/pool/rounds/${round.id}`,
        dedupeKey: `ipo:pool:closed:${round.id}`,
      });
      n++;
    }
    return n;
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
    if (a.status === 'settled' && u.status && u.status !== 'settled')
      throw badRequest('settled', 'A settled one stays settled.');
    const set: Partial<App> = { reportedBy: by };
    if (u.status) set.status = u.status;
    if (
      u.status &&
      BEFORE_RESULT.includes(u.status) &&
      !BEFORE_RESULT.includes(a.status as ApplicationStatus)
    ) {
      set.allottedLots = null;
      set.soldPrice = null;
      set.soldAt = null;
    }
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
    if (set.status && set.status !== a.status) set.history = [...a.history, this.step(set.status, by)];
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
      .set({
        status: 'settled',
        settledAt: new Date(this.now()),
        shareMinor: o.share,
        history: [...a.history, this.step('settled', 'owner')],
      })
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
      .filter(
        (a) => a.partnerId === partner.id && !HIDDEN_FROM_PARTNER.includes(a.status as ApplicationStatus),
      )
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
      type: 'ipo.partner',
      title: `${partner.name} ${words}`,
      body: issue ? `${issue.name} · ${formatMoney(a.amountMinor)}` : '',
      url: r ? `/ipo/pool/rounds/${r.id}` : '/ipo',
      dedupeKey: `ipo:pool:${a.id}:${act.action}`,
    });
    return this.partnerPage(token);
  }
}
