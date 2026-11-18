import type { VAULT_KINDS } from '@orvyn/contracts';

/** What a Vault item holds (all of it lives inside the encrypted blob; the server never sees any of this). */
export type VaultKind = (typeof VAULT_KINDS)[number];

export interface VaultField {
  key: string;
  label: string;
  /** hidden until shown; copy clears itself */
  secret?: boolean;
  multiline?: boolean;
  /** offer the password generator */
  generate?: boolean;
  inputMode?: 'numeric' | 'text' | 'email' | 'url';
}

export const KIND_LABEL: Record<VaultKind, string> = {
  login: 'Login',
  card: 'Card',
  id: 'ID',
  apikey: 'API key',
  recovery: 'Recovery codes',
  note: 'Secure note',
};

export const FIELDS: Record<VaultKind, VaultField[]> = {
  login: [
    { key: 'username', label: 'Username or email', inputMode: 'email' },
    { key: 'password', label: 'Password', secret: true, generate: true },
    { key: 'url', label: 'Website', inputMode: 'url' },
    { key: 'totp', label: 'One-time code secret', secret: true },
  ],
  card: [
    { key: 'holder', label: 'Name on card' },
    { key: 'number', label: 'Card number', secret: true, inputMode: 'numeric' },
    { key: 'expiry', label: 'Expiry (MM/YY)' },
    { key: 'cvv', label: 'CVV', secret: true, inputMode: 'numeric' },
    { key: 'pin', label: 'PIN', secret: true, inputMode: 'numeric' },
  ],
  id: [
    { key: 'name', label: 'Name' },
    { key: 'number', label: 'Number', secret: true },
    { key: 'issued', label: 'Issued' },
    { key: 'expires', label: 'Expires' },
  ],
  apikey: [
    { key: 'service', label: 'Service' },
    { key: 'key', label: 'Key', secret: true },
    { key: 'url', label: 'Website', inputMode: 'url' },
  ],
  recovery: [
    { key: 'service', label: 'Service' },
    { key: 'codes', label: 'Codes', secret: true, multiline: true },
  ],
  note: [{ key: 'text', label: 'Note', secret: true, multiline: true }],
};

export interface VaultPayload {
  kind: VaultKind;
  title: string;
  fields: Record<string, string>;
  notes: string;
  /** small files, encrypted with the item (web) */
  attachments?: { name: string; mime: string; data: string }[];
  updatedAt: string;
}

/** Things worth showing in the list without opening the item. */
export function subtitle(p: VaultPayload): string {
  const f = p.fields;
  switch (p.kind) {
    case 'login':
      return f.username || f.url || '';
    case 'card':
      return f.number ? `•••• ${f.number.replace(/\D/g, '').slice(-4)}` : (f.holder ?? '');
    case 'id':
      return f.name ?? '';
    case 'apikey':
      return f.service ?? '';
    case 'recovery':
      return f.service ?? '';
    default:
      return '';
  }
}

// ---------------------------------------------------------------- CSV import (Chrome, Bitwarden, generic)

/** RFC 4180 rows (quotes, commas and newlines inside quotes). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

/** Logins from a password-manager export: Chrome/Edge (name,url,username,password,note) or Bitwarden (login_*). */
export function loginsFromCsv(text: string): { items: VaultPayload[]; skipped: number } {
  const [head, ...rows] = parseCsvRows(text);
  if (!head) return { items: [], skipped: 0 };
  const col = (names: string[]) => head.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const c = {
    name: col(['name', 'title']),
    url: col(['url', 'login_uri', 'website']),
    user: col(['username', 'login_username', 'login']),
    pass: col(['password', 'login_password']),
    note: col(['note', 'notes']),
    type: col(['type']),
  };
  const items: VaultPayload[] = [];
  let skipped = 0;
  const now = new Date().toISOString();
  for (const r of rows) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    if (c.type >= 0 && get(c.type) && get(c.type) !== 'login') {
      skipped++;
      continue;
    }
    const password = get(c.pass);
    const username = get(c.user);
    if (!password && !username) {
      skipped++;
      continue;
    }
    const url = get(c.url);
    items.push({
      kind: 'login',
      title: get(c.name) || url.replace(/^https?:\/\//, '').split('/')[0] || 'Login',
      fields: { username, password, url },
      notes: get(c.note),
      updatedAt: now,
    });
  }
  return { items, skipped };
}
