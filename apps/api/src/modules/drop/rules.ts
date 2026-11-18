import { DEFAULT_CATEGORIES, type DropProposal } from '@orvyn/contracts';
import { occurredAtFor, parseSpend } from '@orvyn/money';
import { parseTask } from '@orvyn/today-parse';

/** Words that say "this is money", so "call mom at 6" is never read as ₹6. */
const MONEY_CUE =
  /₹|\brs\.?\s*\d|\brupees?\b|\binr\b|\bspent\b|\bpaid\b|\bgot\b.*\d|\breceived\b|\bcredited\b|\bdebited\b/i;
/** A to-do starts with what to do: "pay rent on the 1st" is a task, not a payment already made. */
const TODO_VERB =
  /^(pay|call|buy|book|send|renew|submit|email|mail|remind|meet|visit|pick up|drop|collect|fix|clean|cancel|order|check|ask|tell|text|message|apply|file|finish|start|plan|schedule|get)\b/i;
const EVENT_CUE =
  /\b(meeting|meet|appointment|interview|call with|lunch with|dinner with|party|wedding|class|session)\b/i;

/**
 * Drop's first reader (spec 0007 C3): short typed text that ORVYN's own parsers understand needs no AI. An expense
 * when it clearly talks money; a task (or an event for a meeting at a time) when it names a day or a time. Anything
 * else — photos, files, links, long or unclear text — goes to the model. Null means "ask the model".
 */
export function readByRules(
  text: string,
  o: {
    now: Date;
    timeZone: string;
    kinds: string[];
    categories: { name: string; slug: string | null }[];
  },
): DropProposal | null {
  const t = text.trim();
  if (!t || t.length > 140 || t.includes('\n')) return null;
  const why = 'Read by ORVYN’s own rules — no AI needed.';

  if (o.kinds.includes('expense') && !TODO_VERB.test(t)) {
    const s = parseSpend(t, { now: o.now, timeZone: o.timeZone });
    if (s && s.amountMinor >= 100 && (MONEY_CUE.test(t) || s.category || s.merchant)) {
      const cat = o.categories.find((c) => c.slug && c.slug === s.category);
      return {
        kind: 'expense',
        amount: s.amountMinor / 100,
        currency: 'INR',
        direction: s.direction === 'credit' ? 'credit' : 'debit',
        merchant: s.merchant,
        category: cat?.name ?? DEFAULT_CATEGORIES.find((c) => c.slug === s.category)?.name ?? 'Other',
        occurredAt: occurredAtFor({ date: s.date, time: s.time }, o.now, o.timeZone).toISOString(),
        note: s.note,
        why,
      };
    }
  }

  if (o.kinds.includes('task')) {
    const p = parseTask(t, { now: o.now, timeZone: o.timeZone });
    const title = p.title.trim();
    if (title && (p.dueAt || p.dueDate)) {
      if (o.kinds.includes('event') && p.dueAt && EVENT_CUE.test(t)) {
        const start = new Date(p.dueAt);
        return {
          kind: 'event',
          title,
          start: start.toISOString(),
          end: new Date(start.getTime() + (p.durationMin ?? 60) * 60_000).toISOString(),
          location: '',
          notes: '',
          why,
        };
      }
      return {
        kind: 'task',
        title,
        dueDate: p.dueAt ? null : p.dueDate,
        dueAt: p.dueAt,
        durationMin: p.durationMin,
        priority: p.priority,
        notes: '',
        why,
      };
    }
  }
  return null;
}
