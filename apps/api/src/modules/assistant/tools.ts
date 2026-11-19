import { instantAt, wallIn } from '@orvyn/today-parse';
import { occurrences } from '@orvyn/today-plan';
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/db.module';
import type { AiTool } from '../ai/ai.service';
import { dropItems } from '../drop/drop.schema';
import { libraryDocs } from '../library/library.schema';
import { moneyCategories, moneyTransactions } from '../money/money.schema';
import { todayEvents, todayTasks } from '../today/today.schema';

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown, fallback: string) => (typeof v === 'string' && ymd.test(v) ? v : fallback);
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const like = (w: string) => `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const rupees = (minor: number) => Math.round(minor) / 100;

/**
 * The Assistant's read-only lookups (spec 0005, D25): what the person has in Today, Money, Library and Drop — only
 * their own, only modules they have. There is no Vault tool, by design (ADR-0004). Results are short and plain so
 * they are cheap to send; document text is summarised, never passed whole.
 */
export function assistantTools(
  db: Db,
  o: { ownerId: string; can: (k: string) => boolean; timeZone: string; now: Date },
): AiTool[] {
  const tz = o.timeZone;
  const w = wallIn(o.now, tz);
  const today = `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
  const startOf = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
    return instantAt(y, m, dd, 0, 0, tz);
  };
  const local = (d: Date) => {
    const x = wallIn(d, tz);
    return `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')} ${String(x.h).padStart(2, '0')}:${String(x.mi).padStart(2, '0')}`;
  };
  const tools: AiTool[] = [];

  if (o.can('today')) {
    tools.push({
      name: 'agenda',
      args: 'from: YYYY-MM-DD, to: YYYY-MM-DD (at most 31 days)',
      description: 'Events (repeats included) and tasks due between two days, inclusive, with their ids.',
      run: async (a) => {
        const from = day(a.from, today);
        let to = day(a.to, from);
        if (to < from) to = from;
        const start = startOf(from);
        const endDay = new Date(
          Math.min(startOf(to).getTime() + 86_400_000, start.getTime() + 31 * 86_400_000),
        );
        const events = await db
          .select()
          .from(todayEvents)
          .where(
            and(
              eq(todayEvents.ownerId, o.ownerId),
              isNull(todayEvents.deletedAt),
              eq(todayEvents.cancelled, false),
            ),
          );
        const out: { title: string; start: string; location?: string }[] = [];
        for (const e of events) {
          if (e.rrule && e.start) {
            try {
              for (const occ of occurrences(
                e.rrule,
                { at: e.start.toISOString(), timeZone: e.timeZone },
                start,
                endDay,
                e.exdates ?? [],
              )) {
                if (occ.at)
                  out.push({
                    title: e.title,
                    start: local(new Date(occ.at)),
                    location: e.location || undefined,
                  });
              }
            } catch {
              /* a rule that can't be read is left out */
            }
          } else if (e.start && e.start >= start && e.start < endDay) {
            out.push({ title: e.title, start: local(e.start), location: e.location || undefined });
          } else if (e.allDay && e.startDate && e.startDate >= from && e.startDate <= to) {
            out.push({ title: e.title, start: `${e.startDate} (all day)` });
          }
        }
        const tasks = await db
          .select({
            id: todayTasks.id,
            title: todayTasks.title,
            dueDate: todayTasks.dueDate,
            dueAt: todayTasks.dueAt,
            done: todayTasks.completedAt,
          })
          .from(todayTasks)
          .where(
            and(
              eq(todayTasks.ownerId, o.ownerId),
              isNull(todayTasks.deletedAt),
              or(
                and(gte(todayTasks.dueDate, from), lte(todayTasks.dueDate, to)),
                and(gte(todayTasks.dueAt, start), lt(todayTasks.dueAt, endDay)),
              ),
            ),
          )
          .limit(60);
        return {
          from,
          to,
          events: out.sort((x, y) => x.start.localeCompare(y.start)).slice(0, 60),
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            due: t.dueAt ? local(t.dueAt) : t.dueDate,
            done: !!t.done,
          })),
        };
      },
    });
    tools.push({
      name: 'find_tasks',
      args: 'words?: string, open?: boolean (default true)',
      description:
        'Tasks whose title or notes contain the words (all open tasks when no words), with ids and due dates.',
      run: async (a) => {
        const words = str(a.words).split(/\s+/).filter(Boolean).slice(0, 4);
        const open = a.open !== false;
        const rows = await db
          .select({
            id: todayTasks.id,
            title: todayTasks.title,
            dueDate: todayTasks.dueDate,
            dueAt: todayTasks.dueAt,
            priority: todayTasks.priority,
          })
          .from(todayTasks)
          .where(
            and(
              eq(todayTasks.ownerId, o.ownerId),
              isNull(todayTasks.deletedAt),
              open ? isNull(todayTasks.completedAt) : isNotNull(todayTasks.completedAt),
              ...words.map((w) => or(ilike(todayTasks.title, like(w)), ilike(todayTasks.notes, like(w)))),
            ),
          )
          .orderBy(desc(todayTasks.updatedAt))
          .limit(25);
        return rows.map((t) => ({
          id: t.id,
          title: t.title,
          due: t.dueAt ? local(t.dueAt) : t.dueDate,
          priority: t.priority,
        }));
      },
    });
  }

  if (o.can('money')) {
    const cats = async () =>
      db
        .select({ id: moneyCategories.id, name: moneyCategories.name })
        .from(moneyCategories)
        .where(and(eq(moneyCategories.ownerId, o.ownerId), isNull(moneyCategories.deletedAt)));
    tools.push({
      name: 'money_month',
      args: 'month: YYYY-MM (default this month)',
      description: 'What was spent and came in that month (transfers not counted), by category, in rupees.',
      run: async (a) => {
        const m = typeof a.month === 'string' && /^\d{4}-\d{2}$/.test(a.month) ? a.month : today.slice(0, 7);
        const [y, mo] = m.split('-').map(Number) as [number, number];
        const from = instantAt(y, mo, 1, 0, 0, tz);
        const to = instantAt(y, mo + 1, 1, 0, 0, tz);
        const rows = await db
          .select({
            categoryId: moneyTransactions.categoryId,
            direction: moneyTransactions.direction,
            total: sql<number>`sum(${moneyTransactions.amountMinor})`,
            n: sql<number>`count(*)`,
          })
          .from(moneyTransactions)
          .where(
            and(
              eq(moneyTransactions.ownerId, o.ownerId),
              isNull(moneyTransactions.deletedAt),
              eq(moneyTransactions.transfer, false),
              gte(moneyTransactions.occurredAt, from),
              lt(moneyTransactions.occurredAt, to),
            ),
          )
          .groupBy(moneyTransactions.categoryId, moneyTransactions.direction);
        const names = new Map((await cats()).map((c) => [c.id, c.name]));
        const spent = rows.filter((r) => r.direction === 'debit');
        return {
          month: m,
          spent: rupees(spent.reduce((s, r) => s + Number(r.total), 0)),
          cameIn: rupees(
            rows.filter((r) => r.direction === 'credit').reduce((s, r) => s + Number(r.total), 0),
          ),
          byCategory: spent
            .map((r) => ({
              category: names.get(r.categoryId ?? '') ?? 'Uncategorised',
              spent: rupees(Number(r.total)),
              payments: Number(r.n),
            }))
            .sort((x, y) => y.spent - x.spent),
        };
      },
    });
    tools.push({
      name: 'find_payments',
      args: 'words?: string, from?: YYYY-MM-DD, to?: YYYY-MM-DD',
      description:
        'Payments matching words in the merchant or note within dates (latest first, at most 25), in rupees.',
      run: async (a) => {
        const words = str(a.words).split(/\s+/).filter(Boolean).slice(0, 4);
        const from = typeof a.from === 'string' && ymd.test(a.from) ? startOf(a.from) : null;
        const to =
          typeof a.to === 'string' && ymd.test(a.to) ? new Date(startOf(a.to).getTime() + 86_400_000) : null;
        const rows = await db
          .select({
            amountMinor: moneyTransactions.amountMinor,
            direction: moneyTransactions.direction,
            merchant: moneyTransactions.merchant,
            note: moneyTransactions.note,
            occurredAt: moneyTransactions.occurredAt,
            category: moneyCategories.name,
          })
          .from(moneyTransactions)
          .leftJoin(moneyCategories, eq(moneyCategories.id, moneyTransactions.categoryId))
          .where(
            and(
              eq(moneyTransactions.ownerId, o.ownerId),
              isNull(moneyTransactions.deletedAt),
              ...(from ? [gte(moneyTransactions.occurredAt, from)] : []),
              ...(to ? [lt(moneyTransactions.occurredAt, to)] : []),
              ...words.map((w) =>
                or(
                  ilike(moneyTransactions.merchant, like(w)),
                  ilike(moneyTransactions.note, like(w)),
                  ilike(moneyCategories.name, like(w)),
                ),
              ),
            ),
          )
          .orderBy(desc(moneyTransactions.occurredAt))
          .limit(25);
        return rows.map((r) => ({
          amount: rupees(r.amountMinor),
          in: r.direction === 'credit',
          merchant: r.merchant,
          category: r.category ?? 'Uncategorised',
          when: local(r.occurredAt),
          note: r.note || undefined,
        }));
      },
    });
  }

  if (o.can('library')) {
    tools.push({
      name: 'find_documents',
      args: 'words: string',
      description:
        'Documents in the Library matching the words: title, category, summary, expiry and key dates.',
      run: async (a) => {
        const words = str(a.words).split(/\s+/).filter(Boolean).slice(0, 5);
        const rows = await db
          .select({
            title: libraryDocs.title,
            category: libraryDocs.category,
            summary: libraryDocs.summary,
            expiresOn: libraryDocs.expiresOn,
            keyDates: libraryDocs.keyDates,
          })
          .from(libraryDocs)
          .where(
            and(
              eq(libraryDocs.ownerId, o.ownerId),
              isNull(libraryDocs.deletedAt),
              ...words.map((w) =>
                or(
                  ilike(libraryDocs.title, like(w)),
                  ilike(libraryDocs.summary, like(w)),
                  ilike(libraryDocs.category, like(w)),
                  ilike(libraryDocs.text, like(w)),
                  sql`${libraryDocs.tags}::text ilike ${like(w)}`,
                ),
              ),
            ),
          )
          .orderBy(desc(libraryDocs.updatedAt))
          .limit(8);
        return rows.map((r) => ({ ...r, summary: r.summary.slice(0, 400) }));
      },
    });
  }

  if (o.can('drop')) {
    tools.push({
      name: 'drop_inbox',
      args: '',
      description: 'What is waiting in Drop to be decided (newest first, at most 15).',
      run: async () => {
        const rows = await db
          .select({
            kind: dropItems.kind,
            text: dropItems.text,
            url: dropItems.url,
            status: dropItems.status,
            createdAt: dropItems.createdAt,
          })
          .from(dropItems)
          .where(
            and(
              eq(dropItems.ownerId, o.ownerId),
              isNull(dropItems.deletedAt),
              or(
                eq(dropItems.status, 'new'),
                eq(dropItems.status, 'proposed'),
                eq(dropItems.status, 'failed'),
              ),
            ),
          )
          .orderBy(desc(dropItems.createdAt))
          .limit(15);
        return rows.map((r) => ({
          kind: r.kind,
          text: r.text.slice(0, 200),
          url: r.url,
          status: r.status,
          when: local(r.createdAt),
        }));
      },
    });
  }
  return tools;
}
