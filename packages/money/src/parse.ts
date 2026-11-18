import { cleanMerchant } from './merchants';

/**
 * Reading bank SMS and UPI/card app notifications (spec 0003 AC1, ADR-0012). Rules only — no AI — so amounts come
 * straight from the bank's message. The Dart reader in apps/mobile/lib/money/parse.dart implements the same rules
 * and is tested against the same fixtures (fixtures/messages.json).
 */
export interface MessageIn {
  /** a bank SMS (seen through the SMS app's notification) or a payment app's own notification */
  source: 'sms' | 'notification';
  /** for notifications: which app */
  app?: 'gpay' | 'phonepe' | 'paytm' | null;
  title?: string | null;
  text: string;
}

export interface ParsedMessage {
  amountMinor: number;
  direction: 'debit' | 'credit';
  rawMerchant: string;
  merchant: string;
  /** DEFAULT_CATEGORIES slug or null */
  category: string | null;
  last4: string | null;
  refNo: string | null;
  institution: string | null;
  accountKind: 'bank' | 'card' | 'upi';
}

const IGNORE = [
  /\bOTP\b|one[- ]time password|verification code|\bis your (?:code|password)\b/i,
  /\bdeclined\b|\bhas failed\b|\bfailed\b|\bunsuccessful\b|\bwill be reversed\b/i,
  /\brequested\b|\bcollect request\b|\bpayment request\b/i,
  /^available balance|\bavl\.? bal(?:ance)? .*\bis\b/i,
  /\bget up to\b|\bcashback offer\b|\bt&c apply\b|\bwon\b.*\bcashback\b|\bscratch\b/i,
  /\bstatement\b.*\b(?:total|minimum) due\b|\bis due on\b|\bdue by\b/i,
  /\bkyc\b/i,
];

const INSTITUTIONS: [RegExp, string][] = [
  [/\bhdfc\b/i, 'HDFC'],
  [/\bicici\b/i, 'ICICI'],
  [/\bsbi\b|state bank/i, 'SBI'],
  [/\baxis\b/i, 'Axis'],
  [/\bkotak\b/i, 'Kotak'],
  [/\bamex\b|american express/i, 'Amex'],
  [/\bidfc\b/i, 'IDFC'],
  [/\byes bank\b/i, 'Yes Bank'],
  [/\bindusind\b/i, 'IndusInd'],
  [/\bau (?:small finance )?bank\b/i, 'AU'],
  [/\brbl\b/i, 'RBL'],
  [/\bfederal\b/i, 'Federal'],
  [/\bbob\b|bank of baroda/i, 'Bank of Baroda'],
  [/\bpnb\b|punjab national/i, 'PNB'],
  [/\bcanara\b/i, 'Canara'],
  [/\bunion bank\b/i, 'Union Bank'],
];
const APP_NAMES = { gpay: 'GPay', phonepe: 'PhonePe', paytm: 'Paytm' } as const;

const toMinor = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100);
const AMT = String.raw`([\d,]+(?:\.\d{1,2})?)`;
const CUR = String.raw`(?:rs\.?|inr|₹)\s*`;

function amountOf(t: string): number | null {
  const m =
    new RegExp(`${CUR}${AMT}`, 'i').exec(t) ??
    new RegExp(String.raw`(?:debited|credited) by\s*(?:rs\.?|inr)?\s*${AMT}`, 'i').exec(t);
  if (!m) return null;
  const v = toMinor(m[1]!);
  return v > 0 ? v : null;
}

function directionOf(t: string): 'debit' | 'credit' | null {
  if (
    /\brefund\b|\breversal\b|\bcashback (?:of|credited)\b|\bpaid you\b|\breceived\b|\bdeposited\b|\bpayment of .* (?:has been )?received\b/i.test(
      t,
    )
  )
    return 'credit';
  if (
    /\bdebited\b|\bspent\b|\bpaid\b|\bsent\b|\bwithdrawn\b|\bpurchase\b|\btransferred to\b|\btrf to\b|\bused for\b/i.test(
      t,
    )
  )
    return 'debit';
  if (/\bcredited\b/i.test(t)) return 'credit';
  return null;
}

function last4Of(t: string): string | null {
  const m =
    /(?:a\/?c|acct|account|card)(?:\s*no\.?)?(?:\s*(?:ending|end))?[\s:]*(?:x+|\*+|\s)*\s*(\d{3,6})\b/i.exec(
      t,
    ) ??
    /\bending\s*(?:in\s*)?(\d{3,6})\b/i.exec(t) ??
    /\b(?:x{2,}|\*{2,})\s*(\d{3,6})\b/i.exec(t);
  return m?.[1] ?? null;
}

function refOf(t: string): string | null {
  const m =
    /UPI\/P2[AM]\/(\d{9,16})/i.exec(t) ??
    /(?:upi(?:\s*ref(?:\s*no)?)?|ref(?:\s*no)?|refno|rrn|utr)[\s:.#-]*(\d{10,16})\b/i.exec(t);
  return m?.[1] ?? null;
}

/** Who was paid (or paid you), as the message says it. */
function payeeOf(t: string, direction: 'debit' | 'credit'): string {
  const tries: RegExp[] = [
    /UPI\/P2[AM]\/\d+\/(.+?)(?:\s+Not you\b|\s+Avl\b|$)/i, // Axis
    /\bto VPA\s+([\w.-]+@[\w]+)/i,
    /\bby A\/c linked to VPA\s+([\w.-]+@[\w]+)/i,
    /\bNEFT Cr-[A-Z0-9]+-([^-]+?)-/i,
    /\bRefund of .*?\bfrom\s+(.+?)\s+credited\b/i,
    /;\s*([^;.]+?)\s+credited\b/i, // ICICI debit
    /\btrf to\s+(.+?)\s+Ref/i, // SBI UPI
    /\bTransferred to\s+(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?)?\s*(.+?)\.\s/i,
    /\bat\s+(ATM WDL .+?)\.(?:\s|$)/i,
    /\bTo\s+(.+?)\s+On\s+\d/, // HDFC "Sent … To SWIGGY On 17/11/26"
    /\d{2}:\d{2}:\d{2}\s+(.+?)\s+Avl\s+Lmt\b/i, // Axis card
    /\b(?:at|At)\s+(.+?)\s+(?:on|On)\s+\d/, // card spends
    /\bon\s+\d{1,2}-[A-Za-z]{3}-\d{2}\s+on\s+([^.]+)\./i, // ICICI card
    /\bat\s+([A-Z0-9][A-Z0-9 &.'*-]+?)(?:\s+on\b|\.|$)/,
    /^(.+?)\s+paid you\b/i, // GPay received
    /\b(?:paid|sent)\s+(?:rs\.?|inr|₹)?\s*[\d,.]+\s+to\s+(.+?)(?:\s+successfully)?\.?$/i,
    /\b(?:paid|sent)\b.*?\bto\s+(.+?)(?:\s+successfully)?\.?$/i,
    /\b(?:received|credited)\b.*?\bfrom\s+(.+?)(?:\.\s|\.$|\s+UPI\b|$)/i,
    /\bfrom\s+([A-Z][A-Za-z .]+?)\.\s/,
  ];
  for (const re of tries) {
    const m = re.exec(t);
    const v = m?.[1]?.trim().replace(/\s*[.,;]+$/, '');
    if (v && !/^\s*$/.test(v) && !/^(?:your|a\/c|acct)\b/i.test(v)) return v;
  }
  void direction;
  return '';
}

/** A transaction from one message, or null when the message isn't one (OTPs, offers, declines, reminders…). */
export function parseMessage(m: MessageIn): ParsedMessage | null {
  const t = `${m.text}`.replace(/\s+/g, ' ').trim();
  if (!t || IGNORE.some((re) => re.test(t)) || IGNORE.some((re) => re.test(m.title ?? ''))) return null;
  const amountMinor = amountOf(t);
  const direction = directionOf(t);
  if (!amountMinor || !direction) return null;
  const app = m.source === 'notification' ? (m.app ?? null) : null;
  const isCard = !app && /\bcard\b/i.test(t);
  const institution = app ? APP_NAMES[app] : (INSTITUTIONS.find(([re]) => re.test(t))?.[1] ?? null);
  const rawMerchant = payeeOf(t, direction);
  let { merchant, category } = cleanMerchant(rawMerchant);
  if (/\brefund\b/i.test(t)) category = 'refunds';
  else if (direction === 'credit' && /\bsalary\b/i.test(t)) category = 'salary';
  if (!rawMerchant && /\bcredit card\b/i.test(t) && /\bpayment of\b/i.test(t)) merchant = 'Card bill payment';
  if (direction === 'credit' && category && !['refunds', 'salary'].includes(category)) category = null;
  return {
    amountMinor,
    direction,
    rawMerchant,
    merchant,
    category,
    last4: app ? null : last4Of(t),
    refNo: refOf(t),
    institution,
    accountKind: app ? 'upi' : isCard ? 'card' : 'bank',
  };
}

/**
 * The key two sightings of one payment share (bank SMS + UPI app, a re-read, a statement row): the UPI/RRN reference
 * when there is one; otherwise none — `findDuplicate` then matches by amount and time.
 */
export const dedupeKeyOf = (p: { refNo: string | null }) => (p.refNo ? `ref:${p.refNo}` : null);

export interface Sighting {
  id?: string;
  amountMinor: number;
  direction: 'debit' | 'credit';
  occurredAt: string;
  dedupeKey: string | null;
  source: string;
  merchant?: string;
}

/**
 * The transaction this new sighting is a second copy of, if any: same key; or same amount and direction within 10
 * minutes from a different kind of source (bank SMS vs app notification, SMS vs statement on the same day).
 */
export function findDuplicate<T extends Sighting>(candidate: Sighting, existing: T[]): T | null {
  if (candidate.dedupeKey) {
    const same = existing.find((e) => e.dedupeKey === candidate.dedupeKey);
    if (same) return same;
  }
  const at = Date.parse(candidate.occurredAt);
  const window = candidate.source === 'statement' ? 36 * 3_600_000 : 10 * 60_000;
  return (
    existing.find(
      (e) =>
        e.amountMinor === candidate.amountMinor &&
        e.direction === candidate.direction &&
        e.source !== candidate.source &&
        Math.abs(Date.parse(e.occurredAt) - at) <= window &&
        // two sightings with different references are two payments
        !(candidate.dedupeKey && e.dedupeKey && candidate.dedupeKey !== e.dedupeKey),
    ) ?? null
  );
}
