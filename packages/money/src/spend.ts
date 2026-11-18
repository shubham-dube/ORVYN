import { findDate, findTime, todayIn, ymdString } from './dates';
import { cleanMerchant } from './merchants';

/**
 * A typed or spoken entry: "spent 240 on lunch at swiggy", "uber 180", "got 500 from rahul", "1.2k groceries".
 * Rules only; anything less clear goes through Drop (AI proposal + confirm).
 */
export interface SpendEntry {
  amountMinor: number;
  direction: 'debit' | 'credit';
  merchant: string;
  category: string | null;
  note: string;
  /** the day it happened ("yesterday", "on 12 nov") as YYYY-MM-DD, or null = today */
  date: string | null;
  /** HH:MM when said ("at 3pm"), else null */
  time: string | null;
}

const HINTS: [RegExp, string][] = [
  [/\b(lunch|dinner|breakfast|snacks?|coffee|tea|chai|food|restaurant|cafe)\b/i, 'food'],
  [/\b(groceries|grocery|vegetables|veggies|milk|fruits?)\b/i, 'groceries'],
  [/\b(cab|auto|taxi|metro|bus|train ticket|parking|toll)\b/i, 'transport'],
  [/\b(petrol|diesel|fuel)\b/i, 'fuel'],
  [/\b(rent)\b/i, 'rent'],
  [/\b(medicine|doctor|hospital|pharmacy|clinic)\b/i, 'health'],
  [/\b(movie|movies|concert|game)\b/i, 'entertainment'],
  [/\b(recharge|electricity|wifi|internet|bill)\b/i, 'bills'],
  [/\b(clothes|shoes|shopping)\b/i, 'shopping'],
  [/\b(gift|donation)\b/i, 'gifts'],
  [/\b(flight|hotel|trip)\b/i, 'travel'],
];

export function parseSpend(text: string, o: { now?: Date; timeZone?: string } = {}): SpendEntry | null {
  let t = text.trim();
  // the date and time first, so their numbers aren't mistaken for the amount
  const today = todayIn(o.timeZone ?? 'Asia/Kolkata', o.now ?? new Date());
  const day = findDate(t, today);
  if (day) t = `${t.slice(0, day.span[0])} ${t.slice(day.span[1])}`.replace(/\s{2,}/g, ' ').trim();
  const clock = findTime(t);
  if (clock) t = `${t.slice(0, clock.span[0])} ${t.slice(clock.span[1])}`.replace(/\s{2,}/g, ' ').trim();
  const m = /(?:₹|rs\.?\s*|inr\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(k|thousand)?\b/i.exec(t);
  if (!m) return null;
  let amount = Number(m[1]!.replace(/,/g, ''));
  if (m[2]) amount *= 1000;
  if (!(amount > 0)) return null;
  const credit = /\b(got|received|refund|salary|earned|returned)\b/i.test(t);
  const rest = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length))
    .replace(/\b(spent|paid|pay|gave|bought|for|on|got|received|from|to|rs|inr|rupees|bucks)\b/gi, ' ')
    .replace(/[₹]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const at = /\b(?:at|on|from|to)\s+([a-z][\w&' .-]{1,40})$/i.exec(t.replace(m[0], ''));
  const who = (at?.[1] ?? '').trim();
  const known = cleanMerchant(who || rest);
  const hint = HINTS.find(([re]) => re.test(t))?.[1] ?? null;
  return {
    amountMinor: Math.round(amount * 100),
    direction: credit ? 'credit' : 'debit',
    merchant: known.category ? known.merchant : who ? known.merchant : '',
    category: credit
      ? /\bsalary\b/i.test(t)
        ? 'salary'
        : /\brefund\b/i.test(t)
          ? 'refunds'
          : null
      : (known.category ?? hint),
    note:
      known.category || who
        ? rest
            .replace(new RegExp(who, 'i'), '')
            .replace(/\bat\b/i, '')
            .trim()
        : rest,
    date: day ? ymdString(day.date) : null,
    time: clock?.time ?? null,
  };
}
