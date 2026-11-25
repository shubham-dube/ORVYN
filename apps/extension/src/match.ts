import type { FillAnswer, FillFact, FillField, FillProfile } from '@orvyn/contracts';

/** Which fact answers which field (spec 0020): rules first, then what was taught, then (elsewhere) AI. Pure. */

export const norm = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_\-*:/()?.,'"’]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const AUTOCOMPLETE: Record<string, string> = {
  'given-name': 'first_name',
  'additional-name': 'middle_name',
  'family-name': 'last_name',
  name: 'full_name',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  bday: 'date_of_birth',
  sex: 'gender',
  'street-address': 'address_line1',
  'address-line1': 'address_line1',
  'address-line2': 'address_line2',
  'address-level2': 'city',
  'address-level1': 'state',
  'postal-code': 'postal_code',
  country: 'country',
  'country-name': 'country',
  organization: 'current_company',
  'organization-title': 'current_title',
  url: 'website',
};

/** Whole-label patterns: a label that says more than the pattern is left for the AI. */
const RULES: [RegExp, string][] = [
  [/^(your )?(legal )?first( and middle)? name$|^given names?$|^firstname$|^fname$/, 'first_name'],
  [/^middle name$/, 'middle_name'],
  [/^(your )?(legal )?last name$|^surname$|^family name$|^lastname$|^lname$/, 'last_name'],
  [
    /^(your )?(full |legal |complete )*name$|^fullname$|^name of (the )?(applicant|candidate)$|^applicant name$/,
    'full_name',
  ],
  [/^(your |work |personal |primary )?e ?mail( address| id)?$/, 'email'],
  [/^(your )?(mobile|phone|contact|telephone|cell|whatsapp)( phone)?( number| no)?$|^tel$/, 'phone'],
  [/^(date of birth|dob|birth ?date|birthday)( dd mm yyyy| mm dd yyyy)?$/, 'date_of_birth'],
  [/^gender$|^sex$/, 'gender'],
  [/^nationality$|^citizenship$/, 'nationality'],
  [/^(street )?address( line)?( 1)?$|^address1$|^current address$/, 'address_line1'],
  [/^address( line)? 2$|^address2$/, 'address_line2'],
  [/^(current )?city$|^town$|^city town$/, 'city'],
  [/^state( province)?( region)?$|^province$/, 'state'],
  [/^(zip|postal|pin)( ?code)?$|^pincode$|^zipcode$|^zip postal code$/, 'postal_code'],
  [/^country( of residence)?$/, 'country'],
  [/^(your )?linked ?in( profile)?( url| link)?$/, 'linkedin'],
  [/^(your )?git ?hub( profile| username)?( url| link)?$/, 'github'],
  [/^(personal )?(website|portfolio)( url| link| site)?$|^portfolio website$/, 'website'],
  [/^(current |present |most recent )?(company|employer)( name)?$/, 'current_company'],
  [/^(current |present )(job )?(title|role|designation|position)$|^designation$/, 'current_title'],
  [/^(total )?(years of |work )*experience( in years)?$|^total experience$/, 'total_experience_years'],
  [/^(current|present) (ctc|salary|compensation)$/, 'current_salary'],
  [/^(expected|desired) (ctc|salary|compensation)$|^salary expectations?$/, 'expected_salary'],
  [/^notice period( in days)?$/, 'notice_period'],
  [/^(highest )?(degree|qualification)$/, 'highest_degree'],
  [/^(university|college|school|institute|institution)( name)?$/, 'university'],
  [/^(year of graduation|graduation year|passing year)$/, 'graduation_year'],
  [/^(gpa|cgpa)$/, 'gpa'],
];

const NEVER =
  /\b(password|passcode|otp|one time|verification code|captcha|cvv|cvc|card number|security code|pin number|search|coupon|promo|aadhaar|ssn|social security)\b/;

export interface Match {
  id: string;
  value: string;
  from: 'rule' | 'taught' | 'ai';
  /** the fact's key, or the question it was taught on */
  key: string;
}

/** The facts as a map, with what follows from them (a full name from its parts, and back). */
export function factMap(facts: FillFact[]): Map<string, string> {
  const m = new Map(facts.filter((f) => f.value.trim()).map((f) => [f.key, f.value.trim()]));
  const parts = [m.get('first_name'), m.get('middle_name'), m.get('last_name')].filter(Boolean);
  if (!m.has('full_name') && parts.length >= 2) m.set('full_name', parts.join(' '));
  const full = m.get('full_name')?.split(/\s+/);
  if (full && full.length >= 2) {
    if (!m.has('first_name')) m.set('first_name', full[0]!);
    if (!m.has('last_name')) m.set('last_name', full.at(-1)!);
  }
  return m;
}

export function ruleKey(f: FillField): string | null {
  const label = norm(f.label);
  if (
    NEVER.test(label) ||
    NEVER.test(norm(f.name)) ||
    /^(cc-|current-password|new-password|one-time-code)/.test(f.autocomplete)
  )
    return null;
  const auto = f.autocomplete.split(/\s+/).at(-1) ?? '';
  // a section like "billing" or a referee's name is not me; the plain token is
  if (
    AUTOCOMPLETE[auto] &&
    !/\b(emergency|referee|reference|father|mother|spouse|guardian|nominee)\b/.test(label)
  )
    return AUTOCOMPLETE[auto]!;
  const hit = (s: string) => RULES.find(([re]) => re.test(s))?.[1] ?? null;
  if (label) return hit(label);
  return hit(norm(f.name));
}

const FILLER = new Set(
  'a an the of to in on for with is are was be do does did you your please if any this that at as or and have has will would can our we us'.split(
    ' ',
  ),
);
/** The same question, worded nearly the same: only small words may differ, never a name, a number or a "not". */
export function sameQuestion(a: string, b: string): boolean {
  const key = (s: string) => [...new Set(norm(s).split(' '))].filter((w) => w && !FILLER.has(w)).sort();
  if (norm(a) === norm(b)) return norm(a) !== '';
  const x = key(a);
  const y = key(b);
  return x.length >= 3 && x.join(' ') === y.join(' ');
}

export function taught(f: FillField, answers: FillAnswer[], host: string): FillAnswer | null {
  if (!f.label || NEVER.test(norm(f.label))) return null;
  const hits = answers.filter((a) => sameQuestion(a.q, f.label));
  return hits.find((a) => a.host === host) ?? hits.at(-1) ?? null;
}

const YES = /^(yes|true|y|i (do|am|have|agree).*)$/;
const NO = /^(no|false|n|i (do not|don t|am not|have not).*)$/;
const COUNTRY: Record<string, string[]> = {
  india: ['in', 'ind', 'republic of india', 'india 91', '91'],
  'united states': ['us', 'usa', 'united states of america'],
  'united kingdom': ['uk', 'gb', 'great britain'],
};

/** Which choice means this value; null when none clearly does. */
export function chooseOption(options: string[], value: string): string | null {
  const v = norm(value);
  if (!v) return null;
  const n = options.map((o) => ({ o, k: norm(o) }));
  const exact = n.find((x) => x.k === v);
  if (exact) return exact.o;
  for (const re of [YES, NO])
    if (re.test(v)) {
      const hits = n.filter((x) => re.test(x.k));
      return hits.length === 1 ? hits[0]!.o : null;
    }
  for (const [name, alt] of Object.entries(COUNTRY))
    if (name === v || alt.includes(v)) {
      const hit = n.find((x) => x.k === name || alt.includes(x.k) || x.k.startsWith(`${name} `));
      if (hit) return hit.o;
    }
  // a number inside a range: "4" → "3-5 years"
  const num = /^(\d+(?:\.\d+)?)/.exec(v);
  if (num) {
    const want = Number(num[1]);
    const hit = options.find((o) => {
      const r = /(\d+)\s*(?:-|–|to)\s*(\d+)/i.exec(o);
      if (r) return want >= Number(r[1]) && want <= Number(r[2]);
      const plus = /(\d+)\s*\+/.exec(o);
      return plus ? want >= Number(plus[1]) : false;
    });
    if (hit) return hit;
    return null;
  }
  const word = (a: string, b: string) => ` ${a} `.includes(` ${b} `);
  const inside = n.filter((x) => x.k && (word(x.k, v) || word(v, x.k)));
  return inside.length === 1 ? inside[0]!.o : null;
}

/** Shaped for the field: dates for date inputs, digits for numbers, a choice for choices. Null = cannot say. */
export function shape(f: FillField, value: string): string | null {
  if (f.options.length) return chooseOption(f.options, value);
  if (f.type === 'date') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value); // day first, as written in India
    return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
  }
  if (f.type === 'month') return /^\d{4}-\d{2}/.exec(value)?.[0] ?? null;
  if (f.type === 'number') return /-?\d[\d,]*(\.\d+)?/.exec(value)?.[0].replace(/,/g, '') ?? null;
  if (f.type === 'url' && !/^https?:/.test(value)) return `https://${value}`;
  return value;
}

/** What can be filled without the AI, and what is left to ask it about. */
export function plan(
  fields: FillField[],
  profile: FillProfile,
  host: string,
): { matches: Match[]; unknown: FillField[] } {
  const facts = factMap(profile.facts);
  const matches: Match[] = [];
  const unknown: FillField[] = [];
  for (const f of fields) {
    const t = taught(f, profile.answers, host);
    const key = t ? null : ruleKey(f);
    const raw = t ? t.a : key ? facts.get(key) : undefined;
    const value = raw === undefined ? null : shape(f, raw);
    if (value !== null && value !== '')
      matches.push({ id: f.id, value, from: t ? 'taught' : 'rule', key: t ? t.q : key! });
    else if (!t && !key && f.label && !NEVER.test(norm(f.label))) unknown.push(f);
  }
  return { matches, unknown };
}

/** The AI's choices turned into values, here on the device. */
export function applyMap(
  map: { id: string; key: string | null }[],
  fields: FillField[],
  profile: FillProfile,
): Match[] {
  const facts = factMap(profile.facts);
  const byId = new Map(fields.map((f) => [f.id, f]));
  return map.flatMap((m) => {
    const f = byId.get(m.id);
    const raw = m.key ? facts.get(m.key) : undefined;
    const value = f && raw !== undefined ? shape(f, raw) : null;
    return value ? [{ id: m.id, value, from: 'ai' as const, key: m.key! }] : [];
  });
}

// ------------------------------------------------------------------ which saved login belongs to this page

/** Places where anyone can have a subdomain: a login saved for one must not be offered on its neighbours. */
const SHARED =
  /^((co|com|org|net|gov|edu|ac|nic|firm|gen|ind)\.[a-z]{2}|github\.io|gitlab\.io|vercel\.app|netlify\.app|pages\.dev|workers\.dev|web\.app|firebaseapp\.com|herokuapp\.com|appspot\.com|blogspot\.com|wordpress\.com|myshopify\.com|azurewebsites\.net|cloudfront\.net|amazonaws\.com|onrender\.com|fly\.dev|railway\.app|replit\.app|glitch\.me|surge\.sh|ngrok\.io|ngrok-free\.app|trycloudflare\.com|cloudapp\.net|run\.app|notion\.site|webflow\.io|framer\.app|wixsite\.com|weebly\.com|substack\.com)$/;

/** May a login saved for `saved` be filled on `pageUrl`? (ADR-0017) */
export function loginFits(saved: string, pageUrl: string): boolean {
  let page: URL;
  let s: URL;
  try {
    page = new URL(pageUrl);
    s = new URL(/^[a-z]+:\/\//i.test(saved.trim()) ? saved.trim() : `https://${saved.trim()}`);
  } catch {
    return false;
  }
  const local = page.hostname === 'localhost' || page.hostname === '127.0.0.1';
  if (page.protocol !== 'https:' && !(local && page.protocol === 'http:')) return false;
  const a = s.hostname.replace(/^www\./, '');
  const b = page.hostname.replace(/^www\./, '');
  if (!a.includes('.') && !local) return false;
  if (local && s.port !== page.port) return false;
  if (a === b) return true;
  return !SHARED.test(a) && !/^[\d.]+$/.test(a) && b.endsWith(`.${a}`);
}
