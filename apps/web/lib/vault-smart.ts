import { parseTotp } from '@orvyn/vault-crypto';
import type { VaultKind, VaultPayload } from './vault-items';

/**
 * Vault helpers that run only on this device (spec 0015 A, D-0015-6): live one-time codes (RFC 6238) and "paste
 * anything" — recognising a card, a login, an API key, recovery codes or an otpauth link by their patterns. Nothing
 * here ever leaves the device or reaches the AI. The Android app has the same rules in lib/vault/smart.dart.
 */

export { base32, parseTotp, type Totp, totpCode, totpLeft } from '@orvyn/vault-crypto';

// ------------------------------------------------------------------ paste anything

export interface Guess {
  kind: VaultKind;
  title: string;
  fields: Record<string, string>;
  notes: string;
  /** what was recognised, in words ("Visa card ending 4242") */
  found: string;
}

export function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

export function cardBrand(n: string): string {
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^(60|65|81|82|508|353|356)/.test(n)) return 'RuPay';
  if (/^(36|30|38)/.test(n)) return 'Diners';
  return 'Card';
}

const KEYS: [RegExp, string][] = [
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/, 'OpenAI'],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/, 'Stripe'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'GitHub'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/, 'GitLab'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS'],
  [/\bxox[bpas]-[A-Za-z0-9-]{10,}/, 'Slack'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google'],
  [/\brzp_(?:live|test)_[A-Za-z0-9]{10,}/, 'Razorpay'],
];
const ANTHROPIC = /\bsk-ant-[A-Za-z0-9_-]{20,}/;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URLISH =
  /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|in|org|net|io|app|dev|co|ai|me|gov|edu|xyz)(?:\/[^\s]*)?/i;

/** "netflix.com" → "Netflix"; "https://accounts.google.com/x" → "Google". */
export function siteName(url: string): string {
  const host = url
    .replace(/^https?:\/\//i, '')
    .split(/[/?#]/)[0]!
    .toLowerCase();
  const parts = host
    .split('.')
    .filter((p) => !['www', 'accounts', 'login', 'app', 'my', 'secure', 'auth'].includes(p));
  const main =
    parts.length > 2 && ['co', 'com', 'gov', 'org', 'net'].includes(parts[parts.length - 2]!)
      ? parts[parts.length - 3]!
      : (parts[parts.length - 2] ?? parts[0]!);
  return main ? main[0]!.toUpperCase() + main.slice(1) : '';
}

const label = (text: string, names: string) =>
  new RegExp(`(?:^|\\n|\\s)(?:${names})\\s*[:=-]\\s*(\\S[^\\n]*)`, 'i').exec(text)?.[1]?.trim();

/** Understands what was pasted, on this device only. */
export function guess(input: string): Guess | null {
  const text = input.trim();
  if (!text) return null;

  // a one-time code link
  if (/otpauth:\/\/totp\//i.test(text)) {
    const link = /otpauth:\/\/totp\/\S+/i.exec(text)![0];
    const t = parseTotp(link);
    if (t)
      return {
        kind: 'login',
        title: t.issuer ?? 'Login',
        fields: { totp: link, ...(t.account ? { username: t.account } : {}) },
        notes: '',
        found: `One-time codes${t.issuer ? ` for ${t.issuer}` : ''}`,
      };
  }

  // a card: a number that passes Luhn
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (!luhn(digits)) continue;
    const rest = text.replace(m[0], ' ');
    const exp = /\b(0[1-9]|1[0-2])\s*\/\s*(\d{4}|\d{2})\b/.exec(rest);
    const afterExp = exp ? rest.replace(exp[0], ' ') : rest;
    const cvv =
      /(?:cvv|cvc|cvv2|security code)\W{0,3}(\d{3,4})\b/i.exec(afterExp)?.[1] ??
      /(?:^|\s)(\d{3,4})(?:\s|$)/.exec(afterExp)?.[1];
    const pin = /\bpin\W{0,3}(\d{4,6})\b/i.exec(afterExp)?.[1];
    const holder = afterExp
      .split(/\n|,/)
      .map((l) => l.replace(/(?:name|card ?holder)\s*[:=-]?/i, '').trim())
      .find(
        (l) => /^[A-Za-z][A-Za-z .']{2,40}$/.test(l) && l.includes(' ') && !/cvv|cvc|exp|valid|pin/i.test(l),
      );
    const brand = cardBrand(digits);
    const bank =
      /\b(HDFC|ICICI|SBI|Axis|Kotak|IDFC|Yes Bank|AU|IndusInd|RBL|HSBC|Citi|Amex|OneCard|Federal)\b/i.exec(
        text,
      )?.[1];
    return {
      kind: 'card',
      title: [bank, brand].filter(Boolean).join(' '),
      fields: {
        number: digits.replace(/(\d{4})(?=\d)/g, '$1 '),
        ...(exp ? { expiry: `${exp[1]}/${exp[2]!.slice(-2)}` } : {}),
        ...(cvv && cvv !== pin ? { cvv } : {}),
        ...(pin ? { pin } : {}),
        ...(holder ? { holder: holder.toUpperCase() } : {}),
      },
      notes: '',
      found: `${brand} card ending ${digits.slice(-4)}`,
    };
  }

  // an API key
  const ant = ANTHROPIC.exec(text);
  for (const [re, service] of ant ? ([[ANTHROPIC, 'Anthropic']] as [RegExp, string][]) : KEYS) {
    const k = re.exec(text);
    if (!k) continue;
    const url = URLISH.exec(text.replace(k[0], ' '))?.[0];
    return {
      kind: 'apikey',
      title: `${service} key`,
      fields: { service, key: k[0], ...(url ? { url } : {}) },
      notes: '',
      found: `${service} API key`,
    };
  }

  // recovery codes: five or more code-shaped lines (or words)
  const tokens = text
    .split(/[\n,;]+|\s{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
  const codeLike = tokens.filter(
    (t) => /^(?:\d+[.)]\s*)?[A-Za-z0-9]{4,10}(?:[- ][A-Za-z0-9]{4,10}){0,3}$/.test(t) && /\d/.test(t),
  );
  if (codeLike.length >= 5 && codeLike.length >= tokens.length - 2) {
    const service = tokens
      .find((t) => !codeLike.includes(t) && /[A-Za-z]{3,}/.test(t))
      ?.replace(/recovery|backup|codes?|[:]/gi, '')
      .trim();
    return {
      kind: 'recovery',
      title: service ? `${service} recovery codes` : 'Recovery codes',
      fields: {
        codes: codeLike.map((c) => c.replace(/^\d+[.)]\s*/, '')).join('\n'),
        ...(service ? { service } : {}),
      },
      notes: '',
      found: `${codeLike.length} recovery codes`,
    };
  }

  // a login: an email or a labelled username, and a password
  const email = EMAIL.exec(text)?.[0];
  const user = label(text, 'username|user|login|id|user id|email') ?? email;
  const labelledPass = label(text, 'password|pass|pwd|pw|passcode');
  const url = URLISH.exec(text.replace(email ?? '\0', ' '))?.[0];
  if (user || labelledPass) {
    let password = labelledPass;
    let title = url ? siteName(url) : '';
    if (!password || !title) {
      const left = text
        .replace(
          /(?:username|user|login|password|pass|pwd|pw|passcode|email|site|website|url)\s*[:=-]/gi,
          ' ',
        )
        .split(/\s+/)
        .filter((w) => w && w !== user && w !== email && w !== url && w !== labelledPass);
      if (!title && left.length > 1 && /^[A-Za-z][A-Za-z0-9 .&-]{1,30}$/.test(left[0]!))
        title = left.shift()!;
      if (!password && left.length) password = left[left.length - 1];
    }
    if (!title && email) title = siteName(email.split('@')[1]!) || 'Login';
    title = title ? title[0]!.toUpperCase() + title.slice(1) : 'Login';
    return {
      kind: 'login',
      title,
      fields: {
        ...(user ? { username: user } : {}),
        ...(password ? { password } : {}),
        ...(url ? { url: /^https?:/.test(url) ? url : `https://${url}` } : {}),
      },
      notes: '',
      found: password ? `Login for ${title}` : `Account for ${title}`,
    };
  }

  // anything else: a secure note
  const first = text.split('\n')[0]!.slice(0, 40);
  return { kind: 'note', title: first, fields: { text }, notes: '', found: 'A secure note' };
}

/** How strong a password looks (0–4), and in words. */
export function strength(p: string): { score: number; label: string } {
  if (!p) return { score: 0, label: '' };
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^A-Za-z0-9]/.test(p)) pool += 32;
  const bits = p.length * Math.log2(Math.max(pool, 1));
  const common = /^(password|123456|qwerty|letmein|welcome|admin|iloveyou)/i.test(p);
  const score = common ? 0 : bits < 36 ? 1 : bits < 60 ? 2 : bits < 90 ? 3 : 4;
  return { score, label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score]! };
}

/** The main secret of an item, for one-tap copy (the list, Ctrl/⌘-K). */
export function primary(p: VaultPayload): { label: string; value: string } | null {
  const f = p.fields;
  const pick = (k: string, label: string) => (f[k] ? { label, value: f[k] } : null);
  switch (p.kind) {
    case 'login':
      return pick('password', 'Password');
    case 'card':
      return f.number ? { label: 'Card number', value: f.number.replace(/\s/g, '') } : null;
    case 'apikey':
      return pick('key', 'Key');
    case 'recovery':
      return pick('codes', 'Codes');
    case 'id':
      return pick('number', 'Number');
    default:
      return pick('text', 'Note');
  }
}
