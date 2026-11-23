/**
 * What's in my hand (spec 0014): the money that is really yours right now, from accounts, card dues, loans and
 * who owes whom — and how sure each part is. Pure; the same rules run in the browser, on the server and (ported)
 * on the phone.
 *
 * - An account's balance is what you last told ORVYN (`balanceMinor` at `balanceAt`); every payment on it after
 *   that moves it: money in raises a bank balance and lowers a card's dues; money out does the opposite. A transfer
 *   (`toAccountId`) leaves one account and arrives in the other — paying a card's bill from the bank lowers both.
 * - Cards and loans hold what you owe on them. A card's limit minus its dues is still available (not yours).
 * - Debts: money owed to you counts when you marked it sure; what you owe always counts against you.
 */

export interface HandAccount {
  id: string;
  name: string;
  kind: 'bank' | 'card' | 'upi' | 'wallet' | 'cash' | 'loan' | string;
  balanceMinor: number | null;
  balanceAt: string | null;
  creditLimitMinor: number | null;
  archived?: boolean;
}

export interface HandTx {
  amountMinor: number;
  direction: 'debit' | 'credit' | string;
  occurredAt: string;
  accountId: string | null;
  toAccountId?: string | null;
}

export interface HandIou {
  direction: 'owed_to_me' | 'i_owe' | string;
  amountMinor: number;
  paidMinor: number;
  sure: boolean;
  settledAt: string | null;
}

export const OWED_KINDS = ['card', 'loan'];

export interface AccountNow {
  id: string;
  name: string;
  kind: string;
  /** what's in it (bank, cash …) or what's owed on it (card, loan); null = never told */
  nowMinor: number | null;
  /** payments since the balance was set */
  movedMinor: number;
  /** a card: limit − dues */
  availableMinor: number | null;
  owed: boolean;
}

export interface Hand {
  accounts: AccountNow[];
  /** money in bank, cash, wallets and UPI */
  cashMinor: number;
  /** dues on cards and loans */
  duesMinor: number;
  /** still owed to you: sure, and maybe */
  owedToMeSureMinor: number;
  owedToMeMaybeMinor: number;
  /** you owe others (borrowed, or holding their money) */
  iOweMinor: number;
  /** what is yours now: cash − dues − what you owe + what will surely come */
  inHandMinor: number;
  /** without counting what will come (the hard floor) */
  inHandTodayMinor: number;
  /** credit still available on cards (not yours, but spendable) */
  cardAvailableMinor: number;
  /** accounts that have never been given a balance */
  unknown: string[];
}

/** The balance of every account now: its last known balance moved by everything after it. */
export function accountsNow(accounts: HandAccount[], txs: HandTx[]): AccountNow[] {
  return accounts
    .filter((a) => !a.archived)
    .map((a) => {
      const owed = OWED_KINDS.includes(a.kind);
      if (a.balanceMinor === null) {
        return {
          id: a.id,
          name: a.name,
          kind: a.kind,
          nowMinor: null,
          movedMinor: 0,
          availableMinor: null,
          owed,
        };
      }
      const since = a.balanceAt ? Date.parse(a.balanceAt) : 0;
      let moved = 0; // as money in the account: + in, − out
      for (const t of txs) {
        if (Date.parse(t.occurredAt) <= since) continue;
        if (t.accountId === a.id) moved += t.direction === 'credit' ? t.amountMinor : -t.amountMinor;
        // a transfer arrives here: money in (for a card: a payment towards it)
        if (t.toAccountId === a.id && t.direction !== 'credit') moved += t.amountMinor;
      }
      // a card's dues go up when money goes out of it
      const now = owed ? a.balanceMinor - moved : a.balanceMinor + moved;
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        nowMinor: now,
        movedMinor: moved,
        availableMinor:
          a.kind === 'card' && a.creditLimitMinor !== null ? Math.max(0, a.creditLimitMinor - now) : null,
        owed,
      };
    });
}

export function hand(accounts: HandAccount[], txs: HandTx[], ious: HandIou[]): Hand {
  const now = accountsNow(accounts, txs);
  let cash = 0;
  let dues = 0;
  let available = 0;
  for (const a of now) {
    if (a.nowMinor === null) continue;
    if (a.owed) dues += a.nowMinor;
    else cash += a.nowMinor;
    available += a.availableMinor ?? 0;
  }
  let sure = 0;
  let maybe = 0;
  let iOwe = 0;
  for (const d of ious) {
    if (d.settledAt) continue;
    const left = Math.max(0, d.amountMinor - d.paidMinor);
    if (d.direction === 'i_owe') iOwe += left;
    else if (d.sure) sure += left;
    else maybe += left;
  }
  return {
    accounts: now,
    cashMinor: cash,
    duesMinor: dues,
    owedToMeSureMinor: sure,
    owedToMeMaybeMinor: maybe,
    iOweMinor: iOwe,
    inHandTodayMinor: cash - dues - iOwe,
    inHandMinor: cash - dues - iOwe + sure,
    cardAvailableMinor: available,
    unknown: now.filter((a) => a.nowMinor === null).map((a) => a.name),
  };
}

/** Net per person across their open debts: + they owe you, − you owe them. Biggest first. */
export function peopleBalances(ious: (HandIou & { person: string; dueDate?: string | null })[]) {
  const by = new Map<string, { person: string; netMinor: number; open: number; nextDue: string | null }>();
  for (const d of ious) {
    if (d.settledAt) continue;
    const key = d.person.trim().toLowerCase();
    const left = Math.max(0, d.amountMinor - d.paidMinor);
    const p = by.get(key) ?? { person: d.person.trim(), netMinor: 0, open: 0, nextDue: null };
    p.netMinor += d.direction === 'i_owe' ? -left : left;
    p.open++;
    if (d.dueDate && (!p.nextDue || d.dueDate < p.nextDue)) p.nextDue = d.dueDate;
    by.set(key, p);
  }
  return [...by.values()].sort((a, b) => Math.abs(b.netMinor) - Math.abs(a.netMinor));
}
