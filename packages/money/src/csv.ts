/**
 * Bank statement CSV (spec 0003): finds the date, description, amount (or debit/credit) and reference columns by their
 * headers (HDFC, ICICI, SBI, Axis and generic exports), so rows can be imported without duplicating what's already
 * there (see findDuplicate).
 */
export interface StatementRow {
  date: string; // YYYY-MM-DD
  description: string;
  amountMinor: number;
  direction: 'debit' | 'credit';
  refNo: string | null;
}

function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** dd/mm/yy(yy), dd-mm-yyyy, dd-Mon-yy, yyyy-mm-dd → YYYY-MM-DD (Indian day-first order). */
export function statementDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2}|[A-Za-z]{3})[/.-](\d{2,4})/.exec(t);
  if (!m) return null;
  const mo = /^\d+$/.test(m[2]!) ? Number(m[2]) : MONTHS[m[2]!.toLowerCase()];
  if (!mo || mo > 12) return null;
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(mo).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

const money = (s: string | undefined) => {
  const v = Number((s ?? '').replace(/[₹,\s]|INR|Rs\.?/gi, '').replace(/\(([^)]+)\)/, '-$1'));
  return Number.isFinite(v) ? v : 0;
};

export function parseStatement(csv: string): { rows: StatementRow[]; skipped: number } {
  const lines = csv
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const find = (h: string[], re: RegExp) => h.findIndex((x) => re.test(x));
  let head = -1;
  let cols = { date: -1, desc: -1, debit: -1, credit: -1, amount: -1, type: -1, ref: -1 };
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const h = cells(lines[i]!).map((x) => x.toLowerCase());
    const date = find(h, /^(txn |transaction |value )?date|^date$/);
    const desc = find(h, /narration|description|details|particulars|remarks/);
    if (date >= 0 && desc >= 0) {
      head = i;
      cols = {
        date,
        desc,
        debit: find(h, /withdrawal|debit|dr\b/),
        credit: find(h, /deposit|credit|cr\b/),
        amount: find(h, /^amount|txn amount|transaction amount/),
        type: find(h, /^(type|dr\/cr|cr\/dr)$/),
        ref: find(h, /ref|chq|cheque|utr/),
      };
      break;
    }
  }
  if (head < 0) return { rows: [], skipped: lines.length };
  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(head + 1)) {
    const c = cells(line);
    const date = statementDate(c[cols.date] ?? '');
    let debit = cols.debit >= 0 ? money(c[cols.debit]) : 0;
    let credit = cols.credit >= 0 ? money(c[cols.credit]) : 0;
    if (cols.amount >= 0 && !debit && !credit) {
      const a = money(c[cols.amount]);
      const type = (c[cols.type] ?? '').toLowerCase();
      // a type column says which; without one, negative amounts are money out
      if (/cr/.test(type)) credit = Math.abs(a);
      else if (/dr/.test(type) || a < 0) debit = Math.abs(a);
      else credit = a;
    }
    if (!date || (!debit && !credit)) {
      skipped++;
      continue;
    }
    const description = (c[cols.desc] ?? '').replace(/\s+/g, ' ').trim();
    // banks pad UPI references with zeros (0000432112345678): the reference is the last 12 digits
    const refCell = (cols.ref >= 0 ? (c[cols.ref] ?? '').trim() : '').replace(/^0+(?=\d{12}$)/, '');
    const ref = /^\d{10,16}$/.test(refCell) ? refCell : (/\b(\d{12})\b/.exec(description)?.[1] ?? null);
    rows.push({
      date,
      description,
      amountMinor: Math.round((debit || credit) * 100),
      direction: debit ? 'debit' : 'credit',
      refNo: ref,
    });
  }
  return { rows, skipped };
}

/** The payee in a statement narration ("UPI-SWIGGY-swiggy@icici-ICIC0001234-432112345678-UPI" → "SWIGGY"). */
export function narrationPayee(desc: string): string {
  const upi = /^UPI[-/]([^-/]+)[-/]/i.exec(desc);
  if (upi) return upi[1]!.trim();
  const pos = /^(?:POS|ECOM|VPS|VIN)[\s/-]+(?:\d+[\s/-]+)?(.+?)(?:[\s/-]+\d{2,}.*)?$/i.exec(desc);
  if (pos) return pos[1]!.trim();
  const neft = /^(?:NEFT|IMPS|RTGS)[\s/-]+(?:CR|DR)?[\s/-]*[A-Z0-9]*[\s/-]+(.+?)[\s/-]/i.exec(desc);
  if (neft) return neft[1]!.trim();
  return desc;
}
