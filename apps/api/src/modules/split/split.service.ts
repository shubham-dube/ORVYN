import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type ExpenseInput,
  formatMoney,
  type NewSplitGroup,
  type SettlementInput,
  type SplitExpenseView,
  type SplitMemberInput,
  type SplitMemberView,
} from '@orvyn/contracts';
import { balances, settleUp, shares, SplitError } from '@orvyn/money';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { users } from '../auth/auth.schema';
import { ChatService } from '../chat/chat.service';
import { NotifyService } from '../notify/notify.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  splitActivity,
  splitExpenses,
  splitGroups,
  splitLinks,
  splitMembers,
  splitSettlements,
} from './split.schema';

const P = (rupees: number) => Math.round(rupees * 100);
const LINK_DAYS = 120;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * Split (spec 0011 part B, ADR-0015): shared groups with ORVYN people and guests, expenses with several payers and
 * any split, balances, the fewest transfers to settle, payments recorded, reminders and guest links.
 */
@Injectable()
export class SplitService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
    private readonly realtime: RealtimeService,
    private readonly chat: ChatService,
  ) {}

  private async nameOf(userId: string) {
    const [u] = await this.db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    return u?.name || u?.email.split('@')[0] || 'Someone';
  }

  private async members(groupId: string, all = false) {
    return this.db
      .select()
      .from(splitMembers)
      .where(and(eq(splitMembers.groupId, groupId), ...(all ? [] : [isNull(splitMembers.removedAt)])))
      .orderBy(splitMembers.createdAt);
  }

  /** You, as a member of the group — or 404 (rule 5). */
  private async me(userId: string, groupId: string) {
    const [m] = await this.db
      .select()
      .from(splitMembers)
      .where(
        and(
          eq(splitMembers.groupId, groupId),
          eq(splitMembers.userId, userId),
          isNull(splitMembers.removedAt),
        ),
      );
    if (!m) throw notFound();
    const [g] = await this.db.select().from(splitGroups).where(eq(splitGroups.id, groupId));
    return { me: m, group: g! };
  }

  private async log(groupId: string, actorId: string | null, text: string, chatLine = true) {
    await this.db.insert(splitActivity).values({ groupId, actorId, text });
    const [g] = await this.db.select().from(splitGroups).where(eq(splitGroups.id, groupId));
    if (chatLine && g?.conversationId && actorId)
      await this.chat.system(g.conversationId, actorId, `Split · ${text}`).catch(() => undefined);
    for (const m of await this.members(groupId))
      if (m.userId) await this.realtime.toUser(m.userId, { type: 'split.changed', groupId });
  }

  // ------------------------------------------------------------------ groups

  async create(userId: string, b: NewSplitGroup) {
    const others = [...new Set(b.memberIds)].filter((id) => id !== userId);
    for (const id of others) {
      const p = await this.access.principal(id);
      if (!p || p.disabled || !p.entitlements.has('split'))
        throw badRequest('not_on_split', 'Someone there doesn’t have Split — add them as a guest instead.');
    }
    const [g] = await this.db
      .insert(splitGroups)
      .values({ ownerId: userId, name: b.name, kind: b.kind })
      .returning();
    const people = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, [userId, ...others]));
    const name = (id: string) => {
      const u = people.find((p) => p.id === id);
      return u?.name || u?.email.split('@')[0] || 'Someone';
    };
    await this.db
      .insert(splitMembers)
      .values([
        ...[userId, ...others].map((id) => ({ groupId: g!.id, userId: id, name: name(id) })),
        ...b.guests.map((x) => ({ groupId: g!.id, name: x.name, phone: x.phone })),
      ]);
    if (b.withChat) {
      const withChat: string[] = [];
      for (const id of others)
        if ((await this.access.principal(id))?.entitlements.has('chat')) withChat.push(id);
      if (withChat.length && (await this.access.principal(userId))?.entitlements.has('chat')) {
        const c = await this.chat.create(
          userId,
          { kind: 'group', memberIds: withChat, title: b.name },
          { splitGroupId: g!.id },
        );
        await this.db.update(splitGroups).set({ conversationId: c.id }).where(eq(splitGroups.id, g!.id));
      }
    }
    await this.log(g!.id, userId, `${await this.nameOf(userId)} made “${b.name}”`, false);
    for (const id of others)
      await this.notify.send({
        userId: id,
        module: 'split',
        kind: 'split',
        title: `${await this.nameOf(userId)} added you to “${b.name}”`,
        body: 'Shared expenses, and who owes whom.',
        url: `/split/${g!.id}`,
      });
    return this.view(userId, g!.id);
  }

  async list(userId: string) {
    const mine = await this.db
      .select({ groupId: splitMembers.groupId })
      .from(splitMembers)
      .where(and(eq(splitMembers.userId, userId), isNull(splitMembers.removedAt)));
    const out = [];
    for (const { groupId } of mine) {
      const v = await this.view(userId, groupId);
      const me = v.members.find((m) => m.userId === userId)!;
      out.push({
        id: v.id,
        name: v.name,
        kind: v.kind,
        members: v.members.length,
        totalMinor: v.totalMinor,
        myBalance: me.balance,
        lastAt: v.expenses[0]?.createdAt ?? v.createdAt,
        archived: v.archived,
      });
    }
    return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  /** Everything about a group, computed from its expenses and payments. */
  async compute(groupId: string) {
    const [g] = await this.db.select().from(splitGroups).where(eq(splitGroups.id, groupId));
    if (!g) throw notFound();
    const members = await this.members(groupId, true);
    const expenses = await this.db
      .select()
      .from(splitExpenses)
      .where(and(eq(splitExpenses.groupId, groupId), isNull(splitExpenses.deletedAt)))
      .orderBy(desc(splitExpenses.date), desc(splitExpenses.createdAt));
    const settlements = await this.db
      .select()
      .from(splitSettlements)
      .where(and(eq(splitSettlements.groupId, groupId), isNull(splitSettlements.deletedAt)))
      .orderBy(desc(splitSettlements.date), desc(splitSettlements.createdAt));
    const net = balances(
      members.map((m) => m.id),
      expenses.map((e) => ({ paid: e.paid, owed: e.shares })),
      settlements.map((s) => ({ from: s.fromId, to: s.toId, amount: s.amountMinor })),
    );
    const paidBy = new Map<string, number>();
    const consumed = new Map<string, number>();
    const byCategory = new Map<string, number>();
    for (const e of expenses) {
      for (const p of e.paid) paidBy.set(p.memberId, (paidBy.get(p.memberId) ?? 0) + p.amount);
      for (const s of e.shares) consumed.set(s.memberId, (consumed.get(s.memberId) ?? 0) + s.amount);
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountMinor);
    }
    const view: SplitMemberView[] = members
      .filter((m) => !m.removedAt || (net.get(m.id) ?? 0) !== 0)
      .map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.name,
        phone: m.phone,
        upi: m.upi,
        guest: !m.userId,
        balance: net.get(m.id) ?? 0,
        paid: paidBy.get(m.id) ?? 0,
        consumed: consumed.get(m.id) ?? 0,
      }));
    const name = new Map(members.map((m) => [m.id, m.name]));
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      adminId: g.ownerId,
      conversationId: g.conversationId,
      archived: !!g.archivedAt,
      createdAt: g.createdAt.toISOString(),
      members: view,
      expenses: expenses.map((e): SplitExpenseView => ({
        id: e.id,
        title: e.title,
        amount: e.amountMinor,
        date: e.date,
        category: e.category,
        note: e.note,
        receiptFileId: e.receiptFileId,
        addedBy: e.addedBy,
        paid: e.paid,
        shares: e.shares,
        method: e.method,
        among: e.among,
        createdAt: e.createdAt.toISOString(),
      })),
      settlements: settlements.map((s) => ({
        id: s.id,
        fromId: s.fromId,
        toId: s.toId,
        amount: s.amountMinor,
        method: s.method,
        date: s.date,
        note: s.note,
      })),
      plan: settleUp(net).map((t) => ({
        ...t,
        fromName: name.get(t.from) ?? '',
        toName: name.get(t.to) ?? '',
        toUpi: members.find((m) => m.id === t.to)?.upi ?? '',
      })),
      totalMinor: expenses.reduce((s, e) => s + e.amountMinor, 0),
      byCategory: [...byCategory]
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
    };
  }

  async view(userId: string, groupId: string) {
    await this.me(userId, groupId);
    const v = await this.compute(groupId);
    const activity = await this.db
      .select()
      .from(splitActivity)
      .where(eq(splitActivity.groupId, groupId))
      .orderBy(desc(splitActivity.createdAt))
      .limit(30);
    return { ...v, activity: activity.map((a) => ({ text: a.text, at: a.createdAt.toISOString() })) };
  }

  async rename(userId: string, groupId: string, name: string) {
    const { group } = await this.me(userId, groupId);
    if (group.ownerId !== userId) throw forbidden('not_admin', 'Only who made the group can rename it.');
    await this.db.update(splitGroups).set({ name }).where(eq(splitGroups.id, groupId));
    await this.log(groupId, userId, `renamed to “${name}”`);
    return this.view(userId, groupId);
  }

  async archive(userId: string, groupId: string, archived: boolean) {
    await this.me(userId, groupId);
    await this.db
      .update(splitGroups)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(splitGroups.id, groupId));
    return { ok: true };
  }

  async addMember(userId: string, groupId: string, m: SplitMemberInput) {
    await this.me(userId, groupId);
    if (m.userId) {
      const p = await this.access.principal(m.userId);
      if (!p || !p.entitlements.has('split'))
        throw badRequest('not_on_split', 'They don’t have Split — add them as a guest.');
      const [dup] = await this.db
        .select()
        .from(splitMembers)
        .where(
          and(
            eq(splitMembers.groupId, groupId),
            eq(splitMembers.userId, m.userId),
            isNull(splitMembers.removedAt),
          ),
        );
      if (dup) return this.view(userId, groupId);
    }
    if (!m.userId && !m.name) throw badRequest('name_needed', 'Give the guest a name.');
    const name = m.userId ? await this.nameOf(m.userId) : m.name;
    await this.db
      .insert(splitMembers)
      .values({ groupId, userId: m.userId, name, phone: m.phone, upi: m.upi });
    await this.log(groupId, userId, `${await this.nameOf(userId)} added ${name}`);
    return this.view(userId, groupId);
  }

  async editMember(
    userId: string,
    groupId: string,
    memberId: string,
    f: { name?: string; phone?: string; upi?: string },
  ) {
    await this.me(userId, groupId);
    const [m] = await this.db
      .select()
      .from(splitMembers)
      .where(and(eq(splitMembers.id, memberId), eq(splitMembers.groupId, groupId)));
    if (!m) throw notFound();
    // an ORVYN person's name is their own; anyone can note a UPI ID or phone
    await this.db
      .update(splitMembers)
      .set({
        ...(m.userId ? {} : f.name ? { name: f.name } : {}),
        ...(f.phone !== undefined ? { phone: f.phone } : {}),
        ...(f.upi !== undefined ? { upi: f.upi } : {}),
      })
      .where(eq(splitMembers.id, memberId));
    return this.view(userId, groupId);
  }

  async removeMember(userId: string, groupId: string, memberId: string) {
    const { group } = await this.me(userId, groupId);
    const v = await this.compute(groupId);
    const m = v.members.find((x) => x.id === memberId);
    if (!m) throw notFound();
    if (group.ownerId !== userId && m.userId !== userId)
      throw forbidden('not_admin', 'Only who made the group can remove people.');
    if (m.balance !== 0) throw badRequest('not_settled', `${m.name} isn’t settled up yet.`);
    await this.db.update(splitMembers).set({ removedAt: new Date() }).where(eq(splitMembers.id, memberId));
    await this.log(groupId, userId, `${m.name} left the group`);
    return { ok: true };
  }

  // ------------------------------------------------------------------ expenses

  private async check(groupId: string, e: ExpenseInput) {
    const ids = new Set((await this.members(groupId)).map((m) => m.id));
    const used = [...e.paid.map((p) => p.memberId), ...e.split.among.map((a) => a.memberId)];
    if (used.some((id) => !ids.has(id))) throw badRequest('not_member', 'Someone there isn’t in the group.');
    const total = P(e.amount);
    const paid = e.paid.map((p) => ({ memberId: p.memberId, amount: P(p.amount) }));
    if (new Set(paid.map((p) => p.memberId)).size !== paid.length)
      throw badRequest('payer_twice', 'Someone paid twice in the list.');
    const sum = paid.reduce((s, p) => s + p.amount, 0);
    if (sum !== total)
      throw badRequest(
        'paid_mismatch',
        `Contributions add up to ${formatMoney(sum)}, not ${formatMoney(total)}.`,
      );
    try {
      const split = shares({
        total,
        method: e.split.method,
        among: e.split.among.map((a) => ({
          memberId: a.memberId,
          value: e.split.method === 'exact' ? P(a.value) : a.value,
        })),
      });
      return { total, paid, shares: [...split].map(([memberId, amount]) => ({ memberId, amount })) };
    } catch (err) {
      if (err instanceof SplitError) throw badRequest('bad_split', err.message);
      throw err;
    }
  }

  private async tellShares(
    actor: string,
    groupId: string,
    title: string,
    total: number,
    parts: { memberId: string; amount: number }[],
    verb: string,
  ) {
    const ms = await this.members(groupId);
    const [g] = await this.db.select().from(splitGroups).where(eq(splitGroups.id, groupId));
    const who = await this.nameOf(actor);
    for (const p of parts) {
      const m = ms.find((x) => x.id === p.memberId);
      if (!m?.userId || m.userId === actor) continue;
      await this.notify.send({
        userId: m.userId,
        module: 'split',
        kind: 'expense',
        title: `${who} ${verb} ${title} · ${formatMoney(total)}`,
        body: `${g!.name} · your share ${formatMoney(p.amount)}`,
        url: `/split/${groupId}`,
      });
    }
  }

  async addExpense(userId: string, groupId: string, e: ExpenseInput) {
    await this.me(userId, groupId);
    const c = await this.check(groupId, e);
    const [row] = await this.db
      .insert(splitExpenses)
      .values({
        groupId,
        addedBy: userId,
        title: e.title,
        amountMinor: c.total,
        date: e.date,
        category: e.category,
        note: e.note,
        receiptFileId: e.receiptFileId,
        paid: c.paid,
        method: e.split.method,
        among: e.split.among,
        shares: c.shares,
      })
      .returning();
    const ms = await this.members(groupId);
    const payers = c.paid.map((p) => ms.find((m) => m.id === p.memberId)?.name).join(' + ');
    await this.log(
      groupId,
      userId,
      `${await this.nameOf(userId)} added “${e.title}” ${formatMoney(c.total)} (paid by ${payers})`,
    );
    await this.tellShares(userId, groupId, e.title, c.total, c.shares, 'added');
    return { ...(await this.view(userId, groupId)), expenseId: row!.id };
  }

  private async expense(userId: string, groupId: string, id: string) {
    const { group } = await this.me(userId, groupId);
    const [x] = await this.db
      .select()
      .from(splitExpenses)
      .where(
        and(eq(splitExpenses.id, id), eq(splitExpenses.groupId, groupId), isNull(splitExpenses.deletedAt)),
      );
    if (!x) throw notFound();
    if (x.addedBy !== userId && group.ownerId !== userId)
      throw forbidden('not_yours', 'Only who added it, or who made the group, can change it.');
    return x;
  }

  async editExpense(userId: string, groupId: string, id: string, e: ExpenseInput) {
    await this.expense(userId, groupId, id);
    const c = await this.check(groupId, e);
    await this.db
      .update(splitExpenses)
      .set({
        title: e.title,
        amountMinor: c.total,
        date: e.date,
        category: e.category,
        note: e.note,
        receiptFileId: e.receiptFileId,
        paid: c.paid,
        method: e.split.method,
        among: e.split.among,
        shares: c.shares,
      })
      .where(eq(splitExpenses.id, id));
    await this.log(
      groupId,
      userId,
      `${await this.nameOf(userId)} changed “${e.title}” to ${formatMoney(c.total)}`,
    );
    await this.tellShares(userId, groupId, e.title, c.total, c.shares, 'changed');
    return this.view(userId, groupId);
  }

  async deleteExpense(userId: string, groupId: string, id: string) {
    const x = await this.expense(userId, groupId, id);
    await this.db.update(splitExpenses).set({ deletedAt: new Date() }).where(eq(splitExpenses.id, id));
    await this.log(
      groupId,
      userId,
      `${await this.nameOf(userId)} removed “${x.title}” ${formatMoney(x.amountMinor)}`,
    );
    return this.view(userId, groupId);
  }

  // ------------------------------------------------------------------ payments back

  async settle(userId: string, groupId: string, s: SettlementInput) {
    await this.me(userId, groupId);
    const ms = await this.members(groupId);
    const from = ms.find((m) => m.id === s.fromId);
    const to = ms.find((m) => m.id === s.toId);
    if (!from || !to || from.id === to.id) throw badRequest('bad_members', 'Pick who paid and who received.');
    await this.db.insert(splitSettlements).values({
      groupId,
      addedBy: userId,
      fromId: from.id,
      toId: to.id,
      amountMinor: P(s.amount),
      method: s.method,
      date: s.date,
      note: s.note,
    });
    await this.log(
      groupId,
      userId,
      `${from.name} paid ${to.name} ${formatMoney(P(s.amount))} by ${s.method}`,
    );
    for (const m of [from, to])
      if (m.userId && m.userId !== userId)
        await this.notify.send({
          userId: m.userId,
          module: 'split',
          kind: 'settlement',
          title: `${from.name} paid ${to.name} ${formatMoney(P(s.amount))}`,
          body: `Recorded in ${(await this.db.select().from(splitGroups).where(eq(splitGroups.id, groupId)))[0]!.name}`,
          url: `/split/${groupId}`,
        });
    return this.view(userId, groupId);
  }

  async unsettle(userId: string, groupId: string, id: string) {
    await this.me(userId, groupId);
    const [s] = await this.db
      .update(splitSettlements)
      .set({ deletedAt: new Date() })
      .where(and(eq(splitSettlements.id, id), eq(splitSettlements.groupId, groupId)))
      .returning();
    if (!s) throw notFound();
    await this.log(
      groupId,
      userId,
      `${await this.nameOf(userId)} removed a payment of ${formatMoney(s.amountMinor)}`,
    );
    return this.view(userId, groupId);
  }

  /** A nudge to someone who owes: a notification for ORVYN people, a WhatsApp message (with their link) for guests. */
  async remind(userId: string, groupId: string, memberId: string) {
    const { group } = await this.me(userId, groupId);
    const v = await this.compute(groupId);
    const m = v.members.find((x) => x.id === memberId);
    if (!m) throw notFound();
    if (m.balance >= 0) throw badRequest('owes_nothing', `${m.name} doesn’t owe anything.`);
    const plan = v.plan.filter((t) => t.from === memberId);
    const lines = plan
      .map((t) => `${formatMoney(t.amount)} to ${t.toName}${t.toUpi ? ` (UPI ${t.toUpi})` : ''}`)
      .join(', ');
    if (m.userId) {
      await this.notify.send({
        userId: m.userId,
        module: 'split',
        kind: 'reminder',
        title: `${group.name}: you owe ${formatMoney(-m.balance)}`,
        body: `Settle up: ${lines}`,
        url: `/split/${groupId}`,
        dedupeKey: `split:remind:${groupId}`,
      });
      return { sent: true };
    }
    const link = await this.createLink(userId, groupId, memberId);
    const text = `Hi ${m.name}, for “${group.name}” you owe ${formatMoney(-m.balance)}: ${lines}. Details: ${link.url}`;
    const phone = m.phone.replace(/\D/g, '');
    return {
      sent: false,
      whatsapp: `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`,
      text,
    };
  }

  /** Plain text for any chat. */
  async summary(userId: string, groupId: string) {
    const v = await this.view(userId, groupId);
    const lines = [
      `${v.name} — total ${formatMoney(v.totalMinor)}`,
      ...v.members.map((m) => `${m.name}: paid ${formatMoney(m.paid)}, share ${formatMoney(m.consumed)}`),
      '',
      v.plan.length ? 'To settle:' : 'Everyone is settled up. 🎉',
      ...v.plan.map(
        (t) => `• ${t.fromName} → ${t.toName}: ${formatMoney(t.amount)}${t.toUpi ? ` (UPI ${t.toUpi})` : ''}`,
      ),
    ];
    return { text: lines.join('\n') };
  }

  // ------------------------------------------------------------------ guest links (ADR-0015)

  async createLink(userId: string, groupId: string, memberId: string) {
    await this.me(userId, groupId);
    const [m] = await this.db
      .select()
      .from(splitMembers)
      .where(and(eq(splitMembers.id, memberId), eq(splitMembers.groupId, groupId)));
    if (!m) throw notFound();
    await this.db
      .update(splitLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(splitLinks.memberId, memberId), isNull(splitLinks.revokedAt)));
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000);
    await this.db.insert(splitLinks).values({ groupId, memberId, tokenHash: hash(token), expiresAt });
    return { url: `${this.env.WEB_URL}/s/${token}`, expiresAt: expiresAt.toISOString() };
  }

  async revokeLinks(userId: string, groupId: string, memberId: string) {
    await this.me(userId, groupId);
    await this.db
      .update(splitLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(splitLinks.groupId, groupId), eq(splitLinks.memberId, memberId), isNull(splitLinks.revokedAt)),
      );
    return { ok: true };
  }

  /** What a guest sees: the group, the expenses and the plan, with their own line first. */
  async guestPage(token: string) {
    if (!/^[\w-]{20,100}$/.test(token)) return null;
    const [l] = await this.db
      .select()
      .from(splitLinks)
      .where(
        and(
          eq(splitLinks.tokenHash, hash(token)),
          isNull(splitLinks.revokedAt),
          gt(splitLinks.expiresAt, new Date()),
        ),
      );
    if (!l) return null;
    const v = await this.compute(l.groupId);
    const me = v.members.find((m) => m.id === l.memberId);
    if (!me) return null;
    const name = new Map(v.members.map((m) => [m.id, m.name]));
    return {
      group: v.name,
      you: { name: me.name, balance: me.balance, paid: me.paid, consumed: me.consumed },
      yourPlan: v.plan.filter((t) => t.from === me.id || t.to === me.id),
      members: v.members.map((m) => ({ name: m.name, balance: m.balance })),
      expenses: v.expenses.slice(0, 100).map((e) => ({
        title: e.title,
        amount: e.amount,
        date: e.date,
        paidBy: e.paid.map((p) => name.get(p.memberId) ?? '').join(' + '),
        yourShare: e.shares.find((s) => s.memberId === me.id)?.amount ?? 0,
      })),
      totalMinor: v.totalMinor,
      expiresAt: l.expiresAt.toISOString(),
    };
  }
}
