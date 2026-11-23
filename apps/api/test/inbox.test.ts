import type { SessionResponse } from '@orvyn/contracts';
import { Hlc } from '@orvyn/contracts';
import { sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../src/db/db.module';
import { AiService } from '../src/modules/ai/ai.service';
import type { FakeModel } from '../src/modules/ai/fake.model';
import { BriefOutside } from '../src/modules/brief/brief.outside';
import { Mailbox, type MailboxConfig } from '../src/modules/connections/mailbox';
import { InboxService } from '../src/modules/inbox/inbox.service';
import { cutCodes, byRules } from '../src/modules/inbox/inbox.rules';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();

// two mailboxes (work on Zoho, personal on Outlook), faked behind the Mailbox seam
const boxes: Record<
  string,
  { id: string; from: string; subject: string; snippet: string; at: string; url: string | null }[]
> = {
  'work-pass-1': [
    {
      id: '1',
      from: 'Rahul Mehta <rahul@client.test>',
      subject: 'Contract draft for Friday',
      snippet: 'Can you send the signed copy by Friday? Let me know.',
      at: ago(2),
      url: null,
    },
    {
      id: '2',
      from: 'HDFC Bank <alerts@hdfcbank.test>',
      subject: 'Your credit card statement',
      snippet: 'Total amount due Rs. 18,230.00. Payment due date 28 Nov.',
      at: ago(5),
      url: null,
    },
    {
      id: '3',
      from: 'Zomato <offers@zomato.test>',
      subject: '50% off tonight!',
      snippet: 'Use code TREAT50. Limited time offer. Unsubscribe',
      at: ago(1),
      url: null,
    },
  ],
  'home-pass-1': [
    {
      id: 'a',
      from: 'Google <no-reply@accounts.google.test>',
      subject: 'Your verification code',
      snippet: 'Your OTP is 482913. Do not share it.',
      at: ago(1),
      url: null,
    },
    {
      id: 'b',
      from: 'Amazon <shipment-tracking@amazon.test>',
      subject: 'Your order has shipped',
      snippet: 'Out for delivery tomorrow. Track your package.',
      at: ago(3),
      url: null,
    },
    {
      id: 'c',
      from: 'Mom <mom@family.test>',
      subject: 'Dinner on Sunday',
      snippet: 'Will you come home for dinner on Sunday?',
      at: ago(6),
      url: null,
    },
  ],
};
class FakeMailbox extends Mailbox {
  async verify(_user: string, password: string, hosts: string[]) {
    if (!boxes[password]) throw new Error('AUTHENTICATIONFAILED');
    return hosts[0] ?? 'imap.test';
  }
  async unread(cfg: MailboxConfig) {
    const items = boxes[cfg.password];
    if (!items) throw new Error('AUTHENTICATIONFAILED');
    return { unread: items.length, items };
  }
}

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
let inbox: InboxService;
let fake: FakeModel;
const clock = new Hlc('dev');
const api = <T = any>(who: SessionResponse, method: string, path: string, body?: unknown) =>
  call<T>(h, method, path, { token: who.accessToken, body });

/** What the AI answers: by sender, like a good reader would. */
const triage = (text: string) => {
  const mails = JSON.parse(text) as { i: number; from: string; subject: string }[];
  return {
    items: mails.map((m) => {
      const f = m.from;
      if (f.includes('rahul'))
        return {
          i: m.i,
          category: 'needs_reply',
          score: 88,
          summary: 'Rahul wants the signed contract by Friday',
          why: 'A client is waiting',
          action: 'reply',
          amount: null,
          dueDate: null,
        };
      if (f.includes('hdfc'))
        return {
          i: m.i,
          category: 'bill',
          score: 84,
          summary: 'Your HDFC card bill: ₹18,230 due 28 Nov',
          why: 'Money due soon',
          action: 'pay',
          amount: 18230,
          dueDate: new Date(now + 2 * 86_400_000).toISOString().slice(0, 10),
        };
      if (f.includes('google'))
        // even if the model repeats a code, it never reaches the database
        return {
          i: m.i,
          category: 'security',
          score: 72,
          summary: 'Google sign-in code 482913',
          why: 'Security',
          action: 'none',
          amount: null,
          dueDate: null,
        };
      if (f.includes('amazon'))
        return {
          i: m.i,
          category: 'delivery',
          score: 35,
          summary: 'Your Amazon order arrives tomorrow',
          why: 'A delivery',
          action: 'track',
          amount: null,
          dueDate: null,
        };
      if (f.includes('mom'))
        return {
          i: m.i,
          category: 'needs_reply',
          score: 80,
          summary: 'Mom asks if you’ll come for Sunday dinner',
          why: 'Family',
          action: 'reply',
          amount: null,
          dueDate: null,
        };
      return {
        i: m.i,
        category: 'promotion',
        score: 4,
        summary: '50% off at Zomato tonight',
        why: 'A promotion',
        action: 'none',
        amount: null,
        dueDate: null,
      };
    }),
  };
};

beforeAll(async () => {
  h = await startApp([], {}, [{ provide: Mailbox, useValue: new FakeMailbox() }]);
  inbox = h.app.get(InboxService);
  fake = h.app.get(AiService).model as FakeModel;
  fake.handlers['mail.triage'] = triage;
  fake.handlers['mail.catchup'] = () => ({
    text: 'Rahul is waiting on the signed contract, and your HDFC bill of ₹18,230 is due soon.',
  });
  const out = h.app.get(BriefOutside);
  out.markets = async () => null;
  out.weather = async () => null;
  me = (await signIn(h, OWNER)).body;
  const inv = await api(me, 'POST', '/admin/invites', {
    email: 'friend@example.test',
    entitlements: ['today'],
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
  for (const [email, password] of [
    ['me@work.test', 'work-pass-1'],
    ['me@home.test', 'home-pass-1'],
  ])
    expect((await api(me, 'POST', '/connections/mail', { provider: 'zoho', email, password })).status).toBe(
      200,
    );
});
afterAll(() => h.close());

describe('the smart inbox (spec 0017 B)', () => {
  it('every mailbox, triaged: important first, updates, the rest; a catch-up; nobody else sees it (AC1)', async () => {
    const v = (await api(me, 'GET', '/inbox?fresh=1')).body;
    expect(v.important.map((i: any) => i.fromName)).toEqual(['Rahul Mehta', 'HDFC Bank', 'Mom', 'Google']);
    expect(v.important[1]).toMatchObject({
      category: 'bill',
      amountMinor: 1_823_000,
      summary: 'Your HDFC card bill: ₹18,230 due 28 Nov',
      account: 'me@work.test',
      by: 'ai',
    });
    expect(v.updates.map((i: any) => i.fromName)).toEqual(['Amazon']);
    expect(v.rest.map((i: any) => i.fromName)).toEqual(['Zomato']);
    expect(v.catchUp).toContain('Rahul');
    expect(v.boxes.map((b: any) => b.account).sort()).toEqual(['me@home.test', 'me@work.test']);
    expect((await api(friend, 'GET', '/inbox')).body.important).toEqual([]);
  });

  it('one-time codes never reach the database (AC2)', async () => {
    const rows = await h.app.get<Db>(DB).execute(sql`select subject, snippet, summary from inbox_items`);
    expect(JSON.stringify(rows)).not.toContain('482913');
    expect(cutCodes('Your OTP is 482913. Do not share it.')).toBe('Your OTP is ••••••. Do not share it.');
  });

  it('VIP always matters, Mute never does (D-0017-5)', async () => {
    let v = (await api(me, 'PUT', '/inbox/senders', { email: 'offers@zomato.test', rule: 'vip' })).body;
    expect(v.important[0]).toMatchObject({ fromName: 'Zomato', sender: 'vip', score: 90 });
    v = (await api(me, 'PUT', '/inbox/senders', { email: 'rahul@client.test', rule: 'mute' })).body;
    expect(v.important.some((i: any) => i.fromName === 'Rahul Mehta')).toBe(false);
    expect(v.rest.find((i: any) => i.fromName === 'Rahul Mehta')).toMatchObject({
      sender: 'mute',
      score: 10,
    });
    await api(me, 'PUT', '/inbox/senders', { email: 'offers@zomato.test', rule: null });
    await api(me, 'PUT', '/inbox/senders', { email: 'rahul@client.test', rule: null });
  });

  it('important new mail pings once, with Make a task and Done; Done clears it (AC4)', async () => {
    const n = ((await api(me, 'GET', '/notifications')).body.items as any[]).filter(
      (x) => x.module === 'inbox',
    );
    expect(n.map((x) => x.title).sort()).toEqual(
      [
        'Bill due ' + new Date(now + 2 * 86_400_000).toISOString().slice(0, 10) + ': HDFC Bank',
        'Mom: needs a reply',
        'Rahul Mehta: needs a reply',
        'Security: Google',
      ].sort(),
    );
    expect(n[0].actions.map((a: any) => a.id)).toEqual(['task', 'done']);
    await inbox.refresh(me.user.id); // nothing new: no second ping
    expect(
      ((await api(me, 'GET', '/notifications')).body.items as any[]).filter((x) => x.module === 'inbox'),
    ).toHaveLength(4);
    const mom = n.find((x) => x.title === 'Mom: needs a reply');
    await api(me, 'POST', `/notifications/${mom.id}/actions/done`, {});
    expect((await api(me, 'GET', '/inbox')).body.important.some((i: any) => i.fromName === 'Mom')).toBe(
      false,
    );
  });

  it('pin, remind me (a task tomorrow at 9), and mail read in the mailbox leaves the lists (AC3)', async () => {
    const v = (await api(me, 'GET', '/inbox')).body;
    const amazon = v.updates[0];
    await api(me, 'POST', `/inbox/items/${amazon.id}/act`, { action: 'pin' });
    const r = await api(me, 'POST', `/inbox/items/${v.important[0].id}/act`, { action: 'remind' });
    expect(r.body.taskId).toEqual(expect.any(String));
    const task = ((await api(me, 'GET', '/sync/pull?cursor=0')).body.changes as any[]).findLast(
      (c) => c.entityId === r.body.taskId,
    );
    expect(task.data).toMatchObject({
      title: 'Reply to Rahul Mehta: Contract draft for Friday',
      tags: ['mail'],
    });
    expect(new Date(task.data.dueAt).getUTCHours()).toBe(3); // 09:00 in Kolkata
    // Amazon's and HDFC's mails were read in the mailbox: HDFC leaves, the pinned Amazon one stays
    boxes['work-pass-1'] = boxes['work-pass-1']!.filter((m) => m.id !== '2');
    boxes['home-pass-1'] = boxes['home-pass-1']!.filter((m) => m.id !== 'b');
    const after = (await api(me, 'POST', '/inbox/refresh')).body;
    expect(after.important.some((i: any) => i.fromName === 'HDFC Bank')).toBe(false);
    expect(after.updates.map((i: any) => [i.fromName, i.pinned])).toEqual([['Amazon', true]]);
    // someone else can't touch my mail
    expect((await api(friend, 'POST', `/inbox/items/${amazon.id}/act`, { action: 'done' })).status).toBe(404);
  });

  it('without the AI the rules still sort sensibly (AC2)', () => {
    const today = '2026-11-24';
    expect(
      byRules(
        {
          fromName: 'Asha',
          fromEmail: 'asha@x.test',
          subject: 'Quick question',
          snippet: 'Could you review this?',
        },
        today,
      ),
    ).toMatchObject({ category: 'needs_reply', action: 'reply' });
    expect(
      byRules(
        {
          fromName: 'Airtel',
          fromEmail: 'billing@airtel.test',
          subject: 'Your bill',
          snippet: 'Amount due ₹599. Pay by 30 Nov.',
        },
        today,
      ),
    ).toMatchObject({ category: 'bill', amountMinor: 59_900, dueDate: '2026-11-30' });
    expect(
      byRules(
        {
          fromName: 'Shop',
          fromEmail: 'news@shop.test',
          subject: 'Big sale',
          snippet: '40% off. Unsubscribe',
        },
        today,
      ).category,
    ).toBe('newsletter');
    expect(
      byRules(
        {
          fromName: 'Delhivery',
          fromEmail: 'noreply@delhivery.test',
          subject: 'Shipped',
          snippet: 'Your order is out for delivery',
        },
        today,
      ).category,
    ).toBe('delivery');
  });

  it('when the AI is down, new mail is still triaged by the rules', async () => {
    fake.handlers['mail.triage'] = () => {
      throw new Error('down');
    };
    boxes['home-pass-1']!.push({
      id: 'd',
      from: 'Priya <priya@friend.test>',
      subject: 'Trip plan',
      snippet: 'Can you confirm the dates?',
      at: ago(0.5),
      url: null,
    });
    const v = (await api(me, 'POST', '/inbox/refresh')).body;
    expect(v.important.find((i: any) => i.fromName === 'Priya')).toMatchObject({
      category: 'needs_reply',
      by: 'rules',
    });
    fake.handlers['mail.triage'] = triage;
  });
});

describe('Home in one call (spec 0017 A, AC5)', () => {
  it('needs you, across modules, urgent first; only my modules', async () => {
    const push = (entity: string, fields: Record<string, unknown>) =>
      api(me, 'POST', '/sync/push', {
        mutations: [{ mutationId: v7(), entity, entityId: v7(), op: 'upsert', fields, hlc: clock.tick() }],
      });
    await push('today.task', { title: 'Old thing', dueDate: '2020-01-01' });
    const home = (await api(me, 'GET', '/home')).body;
    const kinds = home.needsYou.map((i: any) => i.kind);
    expect(kinds[0]).toBe('mail'); // the security alert: today
    expect(kinds).toContain('overdue');
    expect(kinds.indexOf('overdue')).toBeLessThan(kinds.lastIndexOf('mail') + 1);
    expect(home.inbox).toMatchObject({
      important: expect.any(Number),
      catchUp: expect.stringContaining('Rahul'),
    });
    expect(home.inbox.top).toHaveLength(3);
    const theirs = (await api(friend, 'GET', '/home')).body;
    expect(theirs.ipos).toEqual([]);
    expect(JSON.stringify(theirs)).not.toContain('Rahul');
  });
});
