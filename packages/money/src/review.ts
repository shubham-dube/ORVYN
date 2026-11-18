import { HINTS } from './spend';

/**
 * Smart review of a captured payment (spec 0007 C1). The person answers a notification in their own words;
 * these rules read the answer without any AI. Only an answer they can't read goes further.
 */

export interface ReviewCategory {
  id: string;
  name: string;
  slug: string | null;
  kind: 'expense' | 'income' | string;
}

export type ReplyMeaning =
  | { kind: 'category'; categoryId: string; always: boolean; note: string; ways?: number }
  | { kind: 'ignore'; always: boolean }
  | { kind: 'transfer'; always: boolean }
  | { kind: 'split'; ways: number; note: string }
  | { kind: 'unknown'; text: string };

const IGNORE = /^(ignore|skip|no|nope|not mine|not me|delete|remove|wrong|spam|dismiss|none)\b/i;
const TRANSFER = /\b(transfer|self|own account|my account|to myself|moved|savings)\b/i;
const ALWAYS = /\b(always|every ?time|all ?ways)\b/i;
const SPLIT = /\bsplit\b(?:\s*(?:in|into|with|between|by))?\s*(\d{1,2})\b(?:\s*(?:ways?|people|persons?))?/i;
const SPLIT_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, half: 2 };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The category a word or phrase names: its name, a word of its name, its slug, or a keyword for its slug. */
export function matchCategory(text: string, cats: ReviewCategory[]): ReviewCategory | null {
  const t = norm(text);
  if (!t) return null;
  const words = t.split(' ');
  // 1. the whole name or slug
  for (const c of cats) if (norm(c.name) === t || (c.slug && c.slug === t)) return c;
  // 2. a name that starts with what was typed ("food" → "Food & dining", "bill" → "Bills & utilities")
  for (const c of cats) {
    const n = norm(c.name);
    if (t.length >= 3 && (n.startsWith(t) || n.split(' ').some((w) => w.length >= 3 && w.startsWith(t))))
      return c;
  }
  // 3. any typed word that is a word of a name or a slug
  for (const w of words) {
    if (w.length < 3 || ['and', 'the', 'for', 'was', 'with'].includes(w)) continue;
    for (const c of cats) {
      if (c.slug === w) return c;
      if (
        norm(c.name)
          .split(' ')
          .some((n) => n.length >= 3 && (n === w || n.startsWith(w) || w.startsWith(n)))
      )
        return c;
    }
  }
  // 4. keywords ("dinner" → food, "petrol" → fuel)
  for (const [re, slug] of HINTS) if (re.test(t)) return cats.find((c) => c.slug === slug) ?? null;
  return null;
}

/** "food", "always swiggy food", "split 3 dinner", "ignore", "transfer", "food - with Raj" → what to do. */
export function readReply(raw: string, cats: ReviewCategory[]): ReplyMeaning {
  const text = raw.trim().slice(0, 200);
  if (!text) return { kind: 'unknown', text };
  const always = ALWAYS.test(text);
  const bare = text.replace(ALWAYS, ' ').trim();
  if (IGNORE.test(bare)) return { kind: 'ignore', always };
  // a note after a dash or "note:" is kept as written
  const noteMatch = /\s(?:-|–|—|:|note:?)\s*(.+)$/i.exec(bare);
  const note = noteMatch ? noteMatch[1]!.trim() : '';
  let head = noteMatch ? bare.slice(0, noteMatch.index).trim() : bare;

  let ways: number | undefined;
  const split = SPLIT.exec(head);
  if (split) {
    ways = Number(split[1]);
    head = head.replace(split[0], ' ').trim();
  } else {
    const w = /\bsplit\s+(?:in\s+)?(two|three|four|five|half)\b/i.exec(head);
    if (w) {
      ways = SPLIT_WORDS[w[1]!.toLowerCase()];
      head = head.replace(w[0], ' ').trim();
    }
  }
  if (ways !== undefined && (ways < 2 || ways > 20)) ways = undefined;

  if (!ways && TRANSFER.test(head) && !matchCategory(head, cats)) return { kind: 'transfer', always };
  const cat = head ? matchCategory(head, cats) : null;
  if (cat) return { kind: 'category', categoryId: cat.id, always, note, ...(ways ? { ways } : {}) };
  if (ways) return { kind: 'split', ways, note: [head, note].filter(Boolean).join(' - ') };
  return { kind: 'unknown', text };
}

/** The share that is mine when a payment is split `ways` ways, in paise (my share takes the odd paise). */
export const myShare = (amountMinor: number, ways: number) =>
  amountMinor - Math.floor(amountMinor / ways) * (ways - 1);

/** A stable key for "the same merchant": case, punctuation and trailing ids don't matter. */
export const merchantKey = (merchant: string) =>
  norm(merchant)
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export interface PastChoice {
  merchantKey: string;
  categoryId: string | null;
}

/**
 * The likely categories for a payment, best first: what this merchant was filed as before (most often first), the
 * category its name suggests, then the person's most used categories. At most `n`, expense categories for money out.
 */
export function suggestCategories(
  tx: { merchant: string; direction: 'debit' | 'credit' | string; guessSlug?: string | null },
  cats: ReviewCategory[],
  history: PastChoice[],
  n = 3,
): ReviewCategory[] {
  const want = tx.direction === 'credit' ? 'income' : 'expense';
  const usable = cats.filter((c) => c.kind === want);
  const key = merchantKey(tx.merchant);
  const out: ReviewCategory[] = [];
  const add = (c: ReviewCategory | null | undefined) => {
    if (c && !out.some((o) => o.id === c.id) && usable.some((u) => u.id === c.id)) out.push(c);
  };
  const count = (list: PastChoice[]) => {
    const m = new Map<string, number>();
    for (const h of list) if (h.categoryId) m.set(h.categoryId, (m.get(h.categoryId) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([id]) => usable.find((c) => c.id === id));
  };
  if (key) for (const c of count(history.filter((h) => h.merchantKey === key))) add(c);
  if (tx.guessSlug) add(usable.find((c) => c.slug === tx.guessSlug));
  add(matchCategory(tx.merchant, usable));
  for (const c of count(history)) add(c);
  for (const slug of want === 'income'
    ? ['salary', 'refunds']
    : ['food', 'groceries', 'shopping', 'transport'])
    add(usable.find((c) => c.slug === slug));
  return out.slice(0, n);
}
