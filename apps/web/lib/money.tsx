'use client';

import {
  type Account,
  type Budget,
  type Category,
  MONEY_ACCOUNT,
  MONEY_BUDGET,
  MONEY_CATEGORY,
  MONEY_RECURRING,
  MONEY_TRANSACTION,
  type Recurring,
  type Transaction,
  TransactionFields,
} from '@orvyn/contracts';
import { cleanMerchant, findDuplicate, narrationPayee, type StatementRow } from '@orvyn/money';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from './api';
import { useSync } from './sync';

interface MoneyCtx {
  ready: boolean;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  recurring: Recurring[];
  addTransaction(f: Partial<Transaction> & { amountMinor: number }): Promise<string>;
  updateTransaction(id: string, f: Partial<Transaction>): Promise<void>;
  removeTransaction(id: string): Promise<void>;
  saveCategory(id: string | null, f: Partial<Category>): Promise<string>;
  saveAccount(id: string | null, f: Partial<Account>): Promise<string>;
  saveBudget(id: string | null, f: Partial<Budget>): Promise<string>;
  removeBudget(id: string): Promise<void>;
  saveRecurring(id: string | null, f: Partial<Recurring>): Promise<string>;
  removeRecurring(id: string): Promise<void>;
  /** statement rows → new transactions (rows already recorded are skipped); returns how many were added */
  importStatement(
    rows: StatementRow[],
    accountId: string | null,
  ): Promise<{ added: number; skipped: number }>;
  categoryBySlug(slug: string | null): Category | undefined;
}

const Ctx = createContext<MoneyCtx | null>(null);

/** Money's data from the shared offline mirror; the starting categories are made once on first open. */
export function MoneyProvider({ children }: { children: ReactNode }) {
  const { client, version, write } = useSync();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [ready, setReady] = useState(false);
  const setupAsked = useRef(false);

  const reload = useCallback(async () => {
    const [a, c, t, b, r] = await Promise.all([
      client.list<Account>(MONEY_ACCOUNT),
      client.list<Category>(MONEY_CATEGORY),
      client.list<Transaction>(MONEY_TRANSACTION),
      client.list<Budget>(MONEY_BUDGET),
      client.list<Recurring>(MONEY_RECURRING),
    ]);
    setAccounts(a);
    setCategories([...c].sort((x, y) => (x.order ?? 0) - (y.order ?? 0)));
    setTransactions(
      t.map((x) => ({ ...TX_DEFAULTS, ...x })).sort((x, y) => y.occurredAt.localeCompare(x.occurredAt)),
    );
    setBudgets(b);
    setRecurring(r);
    setReady(true);
    if (!c.length && !setupAsked.current) {
      setupAsked.current = true;
      await api('/money/setup', { method: 'POST' }).catch(() => undefined);
      void client.sync().catch(() => undefined);
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload, version]);

  const value = useMemo<MoneyCtx>(() => {
    const bySlug = (slug: string | null) => (slug ? categories.find((c) => c.slug === slug) : undefined);
    return {
      ready,
      accounts,
      categories,
      transactions,
      budgets,
      recurring,
      categoryBySlug: bySlug,
      addTransaction: (f) => write((c) => c.upsert(MONEY_TRANSACTION, { source: 'manual', ...f })),
      updateTransaction: (id, f) => write(async (c) => void (await c.upsert(MONEY_TRANSACTION, f, id))),
      removeTransaction: (id) => write((c) => c.remove(MONEY_TRANSACTION, id)),
      saveCategory: (id, f) =>
        write(async (c) => (id ? (await c.upsert(MONEY_CATEGORY, f, id), id) : c.upsert(MONEY_CATEGORY, f))),
      saveAccount: (id, f) =>
        write(async (c) => (id ? (await c.upsert(MONEY_ACCOUNT, f, id), id) : c.upsert(MONEY_ACCOUNT, f))),
      saveBudget: (id, f) =>
        write(async (c) => (id ? (await c.upsert(MONEY_BUDGET, f, id), id) : c.upsert(MONEY_BUDGET, f))),
      removeBudget: (id) => write((c) => c.remove(MONEY_BUDGET, id)),
      saveRecurring: (id, f) =>
        write(async (c) =>
          id ? (await c.upsert(MONEY_RECURRING, f, id), id) : c.upsert(MONEY_RECURRING, f),
        ),
      removeRecurring: (id) => write((c) => c.remove(MONEY_RECURRING, id)),
      importStatement: async (rows, accountId) =>
        write(async (c) => {
          const seen = [...transactions];
          let added = 0;
          for (const r of rows) {
            const occurredAt = new Date(`${r.date}T12:00:00`).toISOString();
            const key = r.refNo
              ? `ref:${r.refNo}`
              : `stmt:${r.date}:${r.amountMinor}:${r.direction}:${r.description.slice(0, 40)}`;
            const candidate = {
              amountMinor: r.amountMinor,
              direction: r.direction,
              occurredAt,
              dedupeKey: key,
              source: 'statement',
            };
            if (findDuplicate(candidate, seen)) continue;
            const m = cleanMerchant(narrationPayee(r.description));
            const fields = {
              amountMinor: r.amountMinor,
              direction: r.direction,
              occurredAt,
              merchant: m.merchant,
              rawMerchant: r.description.slice(0, 160),
              categoryId:
                (r.direction === 'debit' || m.category === 'salary' ? bySlug(m.category)?.id : null) ?? null,
              accountId,
              source: 'statement' as const,
              dedupeKey: key,
              refNo: r.refNo,
              reviewed: false,
            };
            const id = await c.upsert(MONEY_TRANSACTION, fields);
            seen.push({ ...TX_DEFAULTS, ...fields, id } as Transaction);
            added++;
          }
          return { added, skipped: rows.length - added };
        }),
    };
  }, [ready, accounts, categories, transactions, budgets, recurring, write]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Defaults for fields a record written offline doesn't carry yet. */
const TX_DEFAULTS = TransactionFields.omit({ amountMinor: true, occurredAt: true }).parse({});

export function useMoney(): MoneyCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMoney outside MoneyProvider');
  return c;
}

export const useMoneyMaybe = () => useContext(Ctx);
