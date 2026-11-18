import { parseTask } from '@orvyn/today-parse';
import type { Model, ModelReply, Part } from './ai.service';

/**
 * A deterministic stand-in for the model (AI_PROVIDER=fake): used by tests, the browser e2e and offline development.
 * It answers each task with simple rules so the whole pipeline can be exercised without a network or a key.
 * Tests can replace any task's answer with `handlers`.
 */
export class FakeModel implements Model {
  handlers: Record<string, (text: string, parts: Part[]) => unknown> = {};
  /** what each call "costs", so the daily cap can be tested */
  costPerCall = 0.002;
  calls: { task: string; model: string; text: string }[] = [];

  async chat(o: { model: string; system: string; parts: Part[]; task: string }): Promise<ModelReply> {
    const text = o.parts
      .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .replace(/<\/?data>/g, '')
      .trim();
    this.calls.push({ task: o.task, model: o.model, text });
    const h = this.handlers[o.task];
    const answer = h
      ? h(text, o.parts)
      : o.task === 'drop.understand'
        ? understand(text, o.parts)
        : o.task === 'library.read'
          ? libraryRead(text, o.parts)
          : { ok: true };
    return {
      text: typeof answer === 'string' ? answer : JSON.stringify(answer),
      inputTokens: Math.ceil(text.length / 4),
      outputTokens: 60,
      costUsd: this.costPerCall,
    };
  }
}

/** Reads a document with simple rules: a title, a category by words, an expiry date and an amount if it says so. */
function libraryRead(text: string, parts: Part[]): unknown {
  const fileName =
    parts
      .map((p) =>
        p.type === 'text'
          ? /^File: (.+?) \(/.exec(p.text)?.[1]
          : p.type === 'image' || p.type === 'file'
            ? p.name
            : undefined,
      )
      .find(Boolean) ?? '';
  const body = text.replace(/^File: .*$/m, '').trim();
  const first = body.split('\n').find((l) => l.trim()) ?? '';
  const all = `${fileName} ${body}`;
  const cat = /pan|aadhaar|passport|driving licen[cs]e|voter/i.test(all)
    ? 'Identity'
    : /insurance|policy|premium/i.test(all)
      ? 'Insurance'
      : /rent|agreement|lease|property/i.test(all)
        ? 'Property'
        : /warranty/i.test(all)
          ? 'Warranty'
          : /invoice|receipt|bill/i.test(all)
            ? 'Receipts'
            : /tax|itr|form 16/i.test(all)
              ? 'Tax'
              : 'Other';
  const expiry =
    /(?:expir\w*|valid (?:till|until|upto)|renewal)[^0-9]{0,20}(\d{4}-\d{2}-\d{2})/i.exec(all)?.[1] ?? null;
  const amount =
    /(?:premium|amount due|due|total)[^0-9₹]{0,20}(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(all)?.[1];
  const title =
    (first || fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ')).slice(0, 80) || 'Document';
  const words = [...new Set(all.toLowerCase().match(/[a-z]{4,}/g) ?? [])].slice(0, 4);
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    category: cat,
    tags: [cat.toLowerCase(), ...words].slice(0, 6),
    summary: body.slice(0, 160) || `A ${cat.toLowerCase()} document`,
    keyDates: expiry ? [{ label: 'Expires', date: expiry }] : [],
    expiresOn: expiry,
    amounts: amount
      ? [{ label: 'Amount due', amount: Number(amount.replace(/,/g, '')), currency: 'INR' }]
      : [],
    text: body.slice(0, 2000),
  };
}

const MONEY =
  /(?:spent|paid|pay|gave|bought|₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:rs|rupees|₹)/i;

function understand(text: string, parts: Part[]): unknown {
  const image = parts.find((p) => p.type === 'image');
  const now = new Date();
  if (image) {
    const name = (image.type === 'image' && image.name) || '';
    if (/receipt|bill|invoice/i.test(name) || /receipt|bill/i.test(text)) {
      return {
        kind: 'expense',
        amount: 499,
        currency: 'INR',
        direction: 'debit',
        merchant: 'Cafe Aroma',
        category: 'Food & dining',
        occurredAt: null,
        note: 'From a receipt photo',
        why: 'A receipt with a total of ₹499',
      };
    }
    return { kind: 'note', title: 'Photo', text: text || '', why: 'A photo without a receipt in it' };
  }
  const money = MONEY.exec(text);
  if (money) {
    const amount = Number((money[1] ?? money[2] ?? '0').replace(/,/g, ''));
    const at = /\b(?:on|at|for)\s+([A-Za-z][\w&' ]{1,30})/i.exec(text.replace(MONEY, ''));
    const merchant = at?.[1]?.trim() ?? '';
    const food = /lunch|dinner|breakfast|food|swiggy|zomato|coffee|tea/i.test(text);
    return {
      kind: 'expense',
      amount,
      currency: 'INR',
      direction: /received|got|refund/i.test(text) ? 'credit' : 'debit',
      merchant: merchant.charAt(0).toUpperCase() + merchant.slice(1),
      category: food ? 'Food & dining' : /uber|ola|auto|metro|cab/i.test(text) ? 'Transport' : 'Other',
      occurredAt: null,
      note: '',
      why: `Mentions spending ₹${amount}`,
    };
  }
  const url = /https?:\/\/\S+/.exec(text);
  if (url) return { kind: 'note', title: 'Link to read', text, why: 'A link' };
  const p = parseTask(text, { now, timeZone: 'Asia/Kolkata' });
  if (p.dueAt && /meet|meeting|call with|appointment|dinner with|lunch with|interview/i.test(text)) {
    const start = new Date(p.dueAt);
    const end = new Date(start.getTime() + (p.durationMin ?? 60) * 60_000);
    return {
      kind: 'event',
      title: p.title,
      start: start.toISOString(),
      end: end.toISOString(),
      location: '',
      notes: '',
      why: 'A meeting at a set time',
    };
  }
  if (p.dueAt || p.dueDate || /^(call|buy|pay|email|send|book|fix|renew|submit|get)\b/i.test(text)) {
    return {
      kind: 'task',
      title: p.title,
      dueDate: p.dueAt ? null : p.dueDate,
      dueAt: p.dueAt,
      durationMin: p.durationMin,
      priority: p.priority,
      notes: '',
      why: p.dueAt || p.dueDate ? 'Something to do by a time' : 'Something to do',
    };
  }
  return {
    kind: 'note',
    title: text.split('\n')[0]!.slice(0, 80) || 'Note',
    text,
    why: 'Something to remember',
  };
}
