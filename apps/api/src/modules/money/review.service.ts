import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { formatMoney, MONEY_IOU, MONEY_TRANSACTION } from '@orvyn/contracts';
import {
  cleanMerchant,
  merchantKey,
  myShare,
  readReply,
  type ReplyMeaning,
  type ReviewCategory,
  suggestCategories,
} from '@orvyn/money';
import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { AiBadAnswer, AiOff, AiPaused, AiService } from '../ai/ai.service';
import type { AuthContext } from '../auth/auth.decorators';
import type { StoredAction } from '../notify/notify.schema';
import { type NotifyAction, NotifyService } from '../notify/notify.service';
import { SERVER_DEVICE, serverOrigin, type SyncApplied, SyncService } from '../sync/sync.service';
import { moneyCategories, moneyIous, moneyMerchantRules, moneyTransactions } from './money.schema';

/** Payments older than this when they arrive (a phone catching up) wait under "New" instead of pinging. */
const ASK_WITHIN_MS = 3 * 86_400_000;
/** Answered the same way this many times → filed silently next time (or at once with "always"). */
const LEARN_AFTER = 2;

type Tx = typeof moneyTransactions.$inferSelect;
type Rule = typeof moneyMerchantRules.$inferSelect;

const keyOf = (txId: string) => `money:review:${txId}`;
const REF = 'money.transaction:';

/**
 * Smart review of captured payments (spec 0007 C1). A payment the phone read from a bank SMS or a UPI app arrives as
 * "new"; ORVYN either files it the way the person taught it (silently, with a note they can change) or asks: the
 * likely categories as buttons, "Not mine", and a reply box read by rules ("food", "split 3", "always food",
 * "ignore") — a cheap AI call only for a reply the rules can't read, constrained to the person's own categories.
 * Nothing is ever filed by the AI on its own: it only reads what the person typed.
 */
@Injectable()
export class ReviewService {
  private readonly log = new Logger('money.review');
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sync: SyncService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
    private readonly ai: AiService,
  ) {}

  // ------------------------------------------------------------------ a payment arrives (or changes)

  @OnEvent('sync.applied', { async: true, promisify: true })
  async onSync(e: SyncApplied): Promise<void> {
    if (e.entity !== MONEY_TRANSACTION || serverOrigin.getStore()) return;
    try {
      await this.consider(e.ownerId, e.entityId, e.op);
    } catch (err) {
      this.log.warn(`review failed: ${(err as Error).message}`);
    }
  }

  async consider(
    ownerId: string,
    txId: string,
    op: 'upsert' | 'delete' = 'upsert',
  ): Promise<'asked' | 'filed' | 'none'> {
    const t = await this.tx(ownerId, txId);
    // reviewed or removed anywhere: the question is answered
    if (op === 'delete' || !t || t.deletedAt || t.reviewed) {
      await this.notify.dismissByKey(ownerId, keyOf(txId));
      return 'none';
    }
    if (t.source === 'manual' || t.transfer) return 'none';
    if (this.now() - t.occurredAt.getTime() > ASK_WITHIN_MS) return 'none';
    if (await this.notify.hasKey(ownerId, keyOf(txId))) return 'none';
    // money in read from a message isn't income until the person says so (spec 0014)
    if (t.direction === 'credit' && t.counted) {
      await this.write(ownerId, t.id, { counted: false });
      t.counted = false;
    }

    const name = t.merchant || cleanMerchant(t.rawMerchant).merchant;
    const rule = name ? await this.rule(ownerId, merchantKey(name)) : null;
    if (rule && (rule.always || rule.hits >= LEARN_AFTER)) {
      await this.apply(ownerId, t, rule);
      return 'filed';
    }
    // no rule, but the person always filed this merchant the same way: do it for them (spec 0013)
    if (!rule && name && t.direction === 'debit') {
      const key = merchantKey(name);
      const past = (await this.history(ownerId)).filter((h) => h.merchantKey === key && h.categoryId);
      const counts = new Map<string, number>();
      for (const h of past) counts.set(h.categoryId!, (counts.get(h.categoryId!) ?? 0) + 1);
      const [best] = [...counts].sort((x, y) => y[1] - x[1]);
      if (best && past.length >= 3 && best[1] / past.length >= 0.8) {
        const cat = (await this.categories(ownerId)).find((c) => c.id === best[0]);
        if (cat) {
          await this.write(ownerId, t.id, { categoryId: cat.id, reviewed: true });
          await this.quiet(
            ownerId,
            t.id,
            `Filed ${formatMoney(t.amountMinor, t.currency)} at ${name}`,
            `As ${cat.name}, like your last ${best[1]} payments there.`,
            true,
          );
          return 'filed';
        }
      }
    }
    await this.ask(ownerId, t);
    return 'asked';
  }

  private async ask(ownerId: string, t: Tx, note?: string): Promise<void> {
    const cats = await this.categories(ownerId);
    const history = await this.history(ownerId);
    const name = t.merchant || cleanMerchant(t.rawMerchant).merchant;
    const guess = cleanMerchant(t.rawMerchant || t.merchant).category;
    let sugg = suggestCategories(
      { merchant: name, direction: t.direction, guessSlug: guess },
      cats,
      history,
      3,
    );
    // the phone's own guess goes first
    const phone = cats.find((c) => c.id === t.categoryId);
    if (phone) sugg = [phone, ...sugg.filter((c) => c.id !== phone.id)].slice(0, 3);
    const label = (c: ReviewCategory) => (c.name.length > 28 ? `${c.name.slice(0, 27)}…` : c.name);
    const credit = t.direction === 'credit';
    if (credit) {
      // money in waits for a yes (spec 0014): income, someone paying back, or not counted at all
      const owed = await this.repayingFor(ownerId, t);
      const left = (d: (typeof owed)[number]) => formatMoney(d.amountMinor - d.paidMinor, d.currency);
      await this.notify.send({
        userId: ownerId,
        module: 'money',
        kind: 'review',
        type: 'money.review',
        title: `${formatMoney(t.amountMinor, t.currency)} came in${name ? ` from ${name}` : ''}`,
        body:
          note ??
          (owed[0]
            ? `Is this ${owed[0].person} paying back? They owe you ${left(owed[0])}. Not counted as income until you say.`
            : 'Count it as income? It isn’t counted until you say — reply “salary”, “refund”, “not counted”…'),
        url: '/money',
        ref: `${REF}${t.id}`,
        dedupeKey: keyOf(t.id),
        actions: [
          ...owed.slice(0, 1).map((d) => ({ id: `repay.${d.id}`, label: `${d.person} paying back` })),
          ...sugg.slice(0, 1).map((c) => ({ id: `c.${c.id}`, label: label(c) })),
          { id: 'nocount', label: 'Don’t count it' },
          { id: 'reply', label: 'Reply', reply: { placeholder: 'salary · refund · not counted' } },
          ...sugg.slice(1).map((c) => ({ id: `c.${c.id}`, label: label(c) })),
          { id: 'transfer', label: 'My own transfer' },
        ],
      });
      return;
    }
    const actions: StoredAction[] = [
      ...sugg.slice(0, 1).map((c) => ({ id: `c.${c.id}`, label: label(c) })),
      { id: 'reply', label: 'Reply', reply: { placeholder: 'food · split 3 · always food · not mine' } },
      { id: 'ignore', label: 'Not mine' },
      ...sugg.slice(1).map((c) => ({ id: `c.${c.id}`, label: label(c) })),
      { id: 'transfer', label: 'My own transfer' },
    ];
    await this.notify.send({
      userId: ownerId,
      module: 'money',
      kind: 'review',
      type: 'money.review',
      title: `${formatMoney(t.amountMinor, t.currency)} ${credit ? 'from' : 'at'} ${name || 'someone'}`,
      body:
        note ??
        `What was it? Tap ${sugg[0] ? `“${sugg[0].name}”` : 'a category'} or reply — “food”, “split 3”, “always food”, “not mine”.`,
      url: '/money',
      ref: `${REF}${t.id}`,
      dedupeKey: keyOf(t.id),
      actions,
    });
  }

  /** File it the way a rule says, and leave a quiet note in the inbox (no buzz) with a way to change it. */
  private async apply(ownerId: string, t: Tx, rule: Rule): Promise<void> {
    const name = t.merchant || rule.merchant;
    const money = formatMoney(t.amountMinor, t.currency);
    if (rule.action === 'ignore') {
      await this.write(ownerId, t.id, null);
      await this.quiet(ownerId, t.id, `Skipped ${money} at ${name}`, 'You said these aren’t yours.', false);
      return;
    }
    if (rule.action === 'transfer') {
      await this.write(ownerId, t.id, { transfer: true, reviewed: true });
      await this.quiet(
        ownerId,
        t.id,
        `${money} ${name}: your own transfer`,
        'Not counted as spending.',
        true,
      );
      return;
    }
    const cat = (await this.categories(ownerId)).find((c) => c.id === rule.categoryId);
    if (!cat) return this.ask(ownerId, t); // the category was deleted since
    await this.write(ownerId, t.id, { categoryId: cat.id, reviewed: true, counted: true });
    await this.quiet(ownerId, t.id, `Filed ${money} at ${name}`, `As ${cat.name}, like before.`, true);
  }

  private quiet(ownerId: string, txId: string, title: string, body: string, change: boolean) {
    return this.notify.send({
      userId: ownerId,
      module: 'money',
      kind: 'filed',
      type: 'money.filed',
      title,
      body,
      url: '/money',
      ref: `${REF}${txId}`,
      dedupeKey: keyOf(txId),
      priority: 'low',
      via: { push: false },
      actions: change ? [{ id: 'change', label: 'Change', open: '/money' }] : [],
    });
  }

  // ------------------------------------------------------------------ the person answers, on any device

  @OnEvent('notify.action', { async: true, promisify: true })
  async onAction(e: NotifyAction): Promise<void> {
    if (!e.notification.ref?.startsWith(REF) || e.notification.module !== 'money') return;
    const t = await this.tx(e.ownerId, e.notification.ref.slice(REF.length));
    if (!t || t.deletedAt) return;
    const name = t.merchant || cleanMerchant(t.rawMerchant).merchant;
    const cats = await this.categories(e.ownerId);

    if (e.actionId === 'change') {
      await this.write(e.ownerId, t.id, { reviewed: false });
      return;
    }
    if (e.actionId === 'ignore') {
      await this.write(e.ownerId, t.id, null);
      await this.learn(e.ownerId, name, 'ignore', null, false);
      return;
    }
    if (e.actionId === 'transfer') {
      await this.write(e.ownerId, t.id, { transfer: true, reviewed: true });
      await this.learn(e.ownerId, name, 'transfer', null, false);
      return;
    }
    if (e.actionId.startsWith('c.')) {
      const cat = cats.find((c) => c.id === e.actionId.slice(2));
      if (!cat) return;
      await this.write(e.ownerId, t.id, { categoryId: cat.id, reviewed: true, counted: true });
      await this.learn(e.ownerId, name, 'category', cat.id, false);
      return;
    }
    if (e.actionId === 'nocount') {
      await this.write(e.ownerId, t.id, { counted: false, reviewed: true });
      return;
    }
    if (e.actionId.startsWith('repay.')) {
      await this.repaid(e.ownerId, t, e.actionId.slice(6));
      return;
    }
    if (e.actionId === 'reply' && e.text) await this.answer(e.ownerId, t, name, cats, e.text);
  }

  private async answer(
    ownerId: string,
    t: Tx,
    name: string,
    cats: ReviewCategory[],
    text: string,
  ): Promise<void> {
    let m: ReplyMeaning = readReply(text, cats);
    if (m.kind === 'unknown') m = await this.understand(ownerId, text, cats);
    const note = (extra: string) => [t.note, extra].filter(Boolean).join(' · ');

    switch (m.kind) {
      case 'ignore':
        await this.write(ownerId, t.id, null);
        await this.learn(ownerId, name, 'ignore', null, m.always);
        return;
      case 'transfer':
        await this.write(ownerId, t.id, { transfer: true, reviewed: true });
        await this.learn(ownerId, name, 'transfer', null, m.always);
        return;
      case 'category': {
        const fields: Record<string, unknown> = { categoryId: m.categoryId, reviewed: true, counted: true };
        const extra: string[] = [];
        if (m.ways) {
          fields.amountMinor = myShare(t.amountMinor, m.ways);
          extra.push(`Split ${m.ways} ways of ${formatMoney(t.amountMinor, t.currency)}`);
        }
        if (m.note) extra.push(m.note);
        if (extra.length) fields.note = note(extra.join(' · '));
        await this.write(ownerId, t.id, fields);
        // a split is about this payment, not the merchant: learn the category only
        await this.learn(ownerId, name, 'category', m.categoryId, m.always);
        return;
      }
      case 'split': {
        const share = myShare(t.amountMinor, m.ways);
        await this.write(ownerId, t.id, {
          amountMinor: share,
          note: note(
            [`Split ${m.ways} ways of ${formatMoney(t.amountMinor, t.currency)}`, m.note]
              .filter(Boolean)
              .join(' · '),
          ),
        });
        const fresh = await this.tx(ownerId, t.id);
        await this.notify.dismissByKey(ownerId, keyOf(t.id));
        if (fresh)
          await this.ask(ownerId, fresh, `Your share is ${formatMoney(share, t.currency)}. What was it?`);
        return;
      }
      default: {
        // couldn't read it: ask again, with the person's own category names as the hint
        await this.notify.dismissByKey(ownerId, keyOf(t.id));
        const names = cats
          .filter((c) => c.kind === (t.direction === 'credit' ? 'income' : 'expense'))
          .slice(0, 6)
          .map((c) => c.name)
          .join(', ');
        await this.ask(
          ownerId,
          t,
          `Didn’t catch “${text.slice(0, 40)}”. Reply with a category (${names}…) or “not mine”.`,
        );
      }
    }
  }

  /** A reply the rules couldn't read: the cheapest model picks one of the person's categories, or nothing. */
  private async understand(ownerId: string, text: string, cats: ReviewCategory[]): Promise<ReplyMeaning> {
    if (!cats.length) return { kind: 'unknown', text };
    try {
      const r = await this.ai.complete({
        ownerId,
        task: 'money.reply',
        maxTokens: 60,
        system:
          'A person described a payment in a few words. Pick the one category from the list that fits, or none. ' +
          `Categories: ${cats.map((c, i) => `${i + 1}=${c.name}`).join('; ')}. ` +
          'Answer {"pick": <number or 0>, "ignore": <true if they say it is not theirs>}.',
        data: [{ type: 'text', text: text.slice(0, 200) }],
        schema: z.object({ pick: z.number().int().min(0).max(cats.length), ignore: z.boolean().optional() }),
      });
      if (r.ignore) return { kind: 'ignore', always: false };
      const c = cats[r.pick - 1];
      return c
        ? { kind: 'category', categoryId: c.id, always: false, note: text.trim().slice(0, 120) }
        : { kind: 'unknown', text };
    } catch (e) {
      if (!(e instanceof AiOff || e instanceof AiPaused || e instanceof AiBadAnswer))
        this.log.warn((e as Error).message);
      return { kind: 'unknown', text };
    }
  }

  // ------------------------------------------------------------------ rules

  private async learn(
    ownerId: string,
    merchant: string,
    action: Rule['action'],
    categoryId: string | null,
    always: boolean,
  ): Promise<void> {
    const key = merchantKey(merchant);
    if (!key) return;
    const old = await this.rule(ownerId, key);
    const same = old && old.action === action && old.categoryId === categoryId;
    await this.db
      .insert(moneyMerchantRules)
      .values({ ownerId, merchantKey: key, merchant, action, categoryId, hits: 1, always })
      .onConflictDoUpdate({
        target: [moneyMerchantRules.ownerId, moneyMerchantRules.merchantKey],
        set: {
          merchant,
          action,
          categoryId,
          hits: same ? old.hits + 1 : 1,
          always: always || (same ? old.always : false),
          updatedAt: new Date(this.now()),
        },
      });
  }

  async rules(ownerId: string) {
    const rows = await this.db
      .select()
      .from(moneyMerchantRules)
      .where(and(eq(moneyMerchantRules.ownerId, ownerId), ne(moneyMerchantRules.action, 'ask')))
      .orderBy(desc(moneyMerchantRules.updatedAt));
    const cats = await this.categories(ownerId);
    return rows.map((r) => ({
      id: r.id,
      merchant: r.merchant,
      action: r.action,
      category: cats.find((c) => c.id === r.categoryId)?.name ?? null,
      hits: r.hits,
      always: r.always,
      active: r.always || r.hits >= LEARN_AFTER,
    }));
  }

  /** Forget what was learned: from now on ORVYN asks about this merchant again, even if history looks clear. */
  async removeRule(ownerId: string, id: string): Promise<boolean> {
    const r = await this.db
      .update(moneyMerchantRules)
      .set({ action: 'ask', categoryId: null, hits: 0, always: false, updatedAt: new Date(this.now()) })
      .where(and(eq(moneyMerchantRules.id, id), eq(moneyMerchantRules.ownerId, ownerId)))
      .returning({ id: moneyMerchantRules.id });
    return r.length > 0;
  }

  // ------------------------------------------------------------------ reads and writes (owner-scoped)

  private async tx(ownerId: string, id: string): Promise<Tx | null> {
    const [t] = await this.db
      .select()
      .from(moneyTransactions)
      .where(and(eq(moneyTransactions.id, id), eq(moneyTransactions.ownerId, ownerId)));
    return t ?? null;
  }

  private async rule(ownerId: string, key: string): Promise<Rule | null> {
    const [r] = await this.db
      .select()
      .from(moneyMerchantRules)
      .where(and(eq(moneyMerchantRules.ownerId, ownerId), eq(moneyMerchantRules.merchantKey, key)));
    return r ?? null;
  }

  private async categories(ownerId: string): Promise<ReviewCategory[]> {
    return this.db
      .select({
        id: moneyCategories.id,
        name: moneyCategories.name,
        slug: moneyCategories.slug,
        kind: moneyCategories.kind,
      })
      .from(moneyCategories)
      .where(
        and(
          eq(moneyCategories.ownerId, ownerId),
          isNull(moneyCategories.deletedAt),
          eq(moneyCategories.archived, false),
        ),
      )
      .orderBy(moneyCategories.order);
  }

  private async history(ownerId: string) {
    const rows = await this.db
      .select({ merchant: moneyTransactions.merchant, categoryId: moneyTransactions.categoryId })
      .from(moneyTransactions)
      .where(
        and(
          eq(moneyTransactions.ownerId, ownerId),
          isNull(moneyTransactions.deletedAt),
          eq(moneyTransactions.reviewed, true),
          isNotNull(moneyTransactions.categoryId),
        ),
      )
      .orderBy(desc(moneyTransactions.occurredAt))
      .limit(400);
    return rows.map((r) => ({ merchantKey: merchantKey(r.merchant), categoryId: r.categoryId }));
  }

  /** Writes go through the sync engine, so every device sees them; null deletes. */
  private async writeEntity(ownerId: string, entity: string, id: string, fields: Record<string, unknown>) {
    const p = await this.access.principal(ownerId);
    if (!p) return;
    await this.sync.pushAsServer(
      { userId: ownerId, deviceId: SERVER_DEVICE, role: p.role, entitlements: p.entitlements },
      [{ entity, entityId: id, op: 'upsert', fields }],
    );
  }

  /** Open debts someone owes the person whose name matches the sender of a payment that came in. */
  private async repayingFor(ownerId: string, t: Tx) {
    if (t.direction !== 'credit') return [];
    const who = merchantKey(t.merchant || cleanMerchant(t.rawMerchant).merchant);
    if (!who) return [];
    const open = await this.db
      .select()
      .from(moneyIous)
      .where(
        and(
          eq(moneyIous.ownerId, ownerId),
          isNull(moneyIous.deletedAt),
          isNull(moneyIous.settledAt),
          eq(moneyIous.direction, 'owed_to_me'),
        ),
      );
    const words = who.split(' ');
    return open.filter((d) => {
      const p = merchantKey(d.person);
      return !!p && (p === who || who.includes(p) || p.includes(who) || p.split(' ')[0] === words[0]);
    });
  }

  /** Money in that someone paid back: not income; the debt goes down (settled when paid in full). */
  private async repaid(ownerId: string, t: Tx, iouId: string) {
    const [d] = await this.db
      .select()
      .from(moneyIous)
      .where(and(eq(moneyIous.id, iouId), eq(moneyIous.ownerId, ownerId), isNull(moneyIous.deletedAt)));
    if (!d) return;
    const paid = Math.min(d.amountMinor, d.paidMinor + t.amountMinor);
    await this.write(ownerId, t.id, { counted: false, reviewed: true, iouId: d.id });
    await this.writeEntity(ownerId, MONEY_IOU, d.id, {
      paidMinor: paid,
      ...(paid >= d.amountMinor ? { settledAt: new Date(this.now()).toISOString() } : {}),
    });
  }

  private async write(ownerId: string, id: string, fields: Record<string, unknown> | null): Promise<void> {
    const p = await this.access.principal(ownerId);
    if (!p) return;
    const auth: AuthContext = {
      userId: ownerId,
      deviceId: SERVER_DEVICE,
      role: p.role,
      entitlements: p.entitlements,
    };
    await this.sync.pushAsServer(auth, [
      fields === null
        ? { entity: MONEY_TRANSACTION, entityId: id, op: 'delete', fields: {} }
        : { entity: MONEY_TRANSACTION, entityId: id, op: 'upsert', fields },
    ]);
    if (fields === null || fields.reviewed === true) await this.notify.dismissByKey(ownerId, keyOf(id));
  }
}
