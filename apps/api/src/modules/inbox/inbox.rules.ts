import type { InboxAction, InboxCategory } from '@orvyn/contracts';

/**
 * The smart inbox's rules (spec 0017 B2): what to make of a mail without the AI — and the safety cuts that run before
 * anything is stored, with or without it.
 */

/** One-time codes never reach the database: "Your OTP is 482913" → "Your OTP is ••••••". */
export function cutCodes(text: string): string {
  return text
    .replace(
      /\b((?:otp|one[- ]time (?:password|code)|verification code|security code|passcode|code|pin)\b[^0-9]{0,30})(\d[\d\s-]{2,9}\d)\b/gi,
      (_m, a: string, code: string) => `${a}${'•'.repeat(Math.min(code.replace(/\D/g, '').length, 8))}`,
    )
    .replace(
      /\b(\d{4,8})\b(?=[^.]{0,40}\b(?:is your|is the|as your)\b[^.]{0,30}\b(?:otp|code|password)\b)/gi,
      (m) => '•'.repeat(m.length),
    );
}

/** "Asha Rao <asha@x.com>" → { name: "Asha Rao", email: "asha@x.com" } */
export function parseFrom(from: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { name: m[1]!.trim() || m[2]!.trim(), email: m[2]!.trim().toLowerCase() };
  const email = /[\w.+-]+@[\w.-]+\.\w+/.exec(from)?.[0]?.toLowerCase() ?? '';
  return { name: from.replace(/<.*>/, '').trim() || email, email };
}

export const isAutomated = (email: string, name = '') =>
  /(^|[._-])(no-?reply|do-?not-?reply|donotreply|notifications?|alerts?|updates?|news(letter)?|mailer|info|support|hello|team|marketing|offers?|billing|statements?|bounce)([._-]|@)/i.test(
    email,
  ) || /\b(team|alerts?|notifications?|newsletter)\b/i.test(name);

/** ₹1,234.50 / Rs. 1234 / INR 1,234 → paise */
export function amountIn(text: string): number | null {
  const m = /(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "due on 28 Nov", "due date: 28/11/2026", "by 28th November" → YYYY-MM-DD (this year or the next). */
export function dueIn(text: string, today: string): string | null {
  const y = Number(today.slice(0, 4));
  const pick = (d: number, m: number, yy?: number) => {
    if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) return null;
    let year = yy ? (yy < 100 ? 2000 + yy : yy) : y;
    let s = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!yy && s < today) {
      year++;
      s = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return s;
  };
  const near =
    /(?:due|pay by|payment date|before|by|last date)[^\n]{0,25}?(\d{1,2})(?:st|nd|rd|th)?[\s/-]+([a-z]{3,9}|\d{1,2})(?:[\s/,-]+(\d{2,4}))?/i.exec(
      text,
    );
  if (!near) return null;
  const d = Number(near[1]);
  const mm = /^\d+$/.test(near[2]!)
    ? Number(near[2])
    : MONTHS.indexOf(near[2]!.slice(0, 3).toLowerCase()) + 1;
  return pick(d, mm, near[3] ? Number(near[3]) : undefined);
}

export interface Triage {
  category: InboxCategory;
  score: number;
  summary: string;
  why: string;
  action: InboxAction;
  amountMinor: number | null;
  dueDate: string | null;
}

/** What the rules make of a mail (the AI does better; this is the floor). */
export function byRules(
  m: { fromName: string; fromEmail: string; subject: string; snippet: string },
  today: string,
): Triage {
  const text = `${m.subject}\n${m.snippet}`;
  const auto = isAutomated(m.fromEmail, m.fromName);
  const amountMinor = amountIn(text);
  const dueDate = dueIn(text, today);
  const has = (re: RegExp) => re.test(text);
  let category: InboxCategory = 'update';
  let score = 30;
  let action: InboxAction = 'none';
  let why = 'An update';
  if (
    has(
      /\b(otp|one[- ]time|verification code|sign[- ]?in|login|new device|password (reset|changed)|security alert)\b/i,
    )
  ) {
    category = 'security';
    score = 70;
    why = 'A security message';
  } else if (
    has(/\b(bill|statement|amount due|payment due|due date|invoice|premium due|emi|minimum due|pay by)\b/i)
  ) {
    category = 'bill';
    score = dueDate ? 80 : 65;
    action = 'pay';
    why = dueDate ? `A bill due ${dueDate}` : 'A bill';
  } else if (
    has(/\b(credited|debited|refund|salary|transaction|payment received|spent|withdrawn|transferred)\b/i)
  ) {
    category = 'money';
    score = 55;
    why = 'Money moved';
  } else if (
    has(/\b(shipped|out for delivery|delivered|dispatched|tracking|courier|order (placed|confirmed))\b/i)
  ) {
    category = 'delivery';
    score = 35;
    action = 'track';
    why = 'A delivery';
  } else if (
    has(/\b(pnr|boarding|e-?ticket|check-?in|flight|train|booking (id|confirmed)|itinerary|hotel)\b/i)
  ) {
    category = 'travel';
    score = 50;
    why = 'Travel';
  } else if (has(/\b(invitation|invited|meeting|webinar|calendar|rsvp|zoom|google meet)\b/i)) {
    category = 'event';
    score = 45;
    action = 'calendar';
    why = 'An invitation';
  } else if (has(/\b(unsubscribe|newsletter|digest|weekly|edition)\b/i)) {
    category = 'newsletter';
    score = 10;
    why = 'A newsletter';
  } else if (has(/\b(offer|sale|% off|discount|cashback|deal|coupon|limited time|exclusive)\b/i)) {
    category = 'promotion';
    score = 5;
    why = 'A promotion';
  } else if (has(/\b(liked|commented|followed|mentioned you|connection request|tagged)\b/i)) {
    category = 'social';
    score = 10;
    why = 'Social';
  } else if (!auto) {
    const asks = has(
      /\?|\b(please|could you|can you|let me know|kindly|waiting for|reply|confirm|review)\b/i,
    );
    category = asks ? 'needs_reply' : 'action';
    score = asks ? 75 : 55;
    action = asks ? 'reply' : 'task';
    why = asks ? `${m.fromName || m.fromEmail} is asking you something` : `From ${m.fromName || m.fromEmail}`;
  }
  const money = amountMinor ? ` ₹${(amountMinor / 100).toLocaleString('en-IN')}` : '';
  const summary =
    category === 'bill'
      ? `Bill${money}${dueDate ? `, due ${dueDate}` : ''}`
      : category === 'money' && money
        ? `${m.subject.slice(0, 80)}`
        : m.subject.slice(0, 120);
  return { category, score, summary, why, action, amountMinor, dueDate };
}
