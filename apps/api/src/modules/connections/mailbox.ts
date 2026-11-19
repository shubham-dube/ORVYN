import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';

export interface MailboxConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface MailItem {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  at: string | null;
  url: string | null;
}

/** Ready-made settings for common providers (IMAP over TLS, port 993); `custom` takes a host. */
export const MAIL_PROVIDERS: Record<
  string,
  { name: string; hosts: string[]; webmail: string | null; help: string }
> = {
  zoho: {
    name: 'Zoho Mail',
    // India accounts live on .in; others on .com — both are tried, in this order
    hosts: ['imap.zoho.in', 'imap.zoho.com'],
    webmail: 'https://mail.zoho.in',
    help: 'Zoho Mail → Settings → Mail Accounts → IMAP Access: on. Then accounts.zoho.in → Security → App Passwords → generate one for ORVYN.',
  },
  outlook: {
    name: 'Outlook / Hotmail',
    hosts: ['outlook.office365.com'],
    webmail: 'https://outlook.live.com/mail',
    help: 'Microsoft account → Security → Advanced security options → App passwords (needs two-step verification).',
  },
  yahoo: {
    name: 'Yahoo Mail',
    hosts: ['imap.mail.yahoo.com'],
    webmail: 'https://mail.yahoo.com',
    help: 'Yahoo → Account security → Generate app password.',
  },
  icloud: {
    name: 'iCloud Mail',
    hosts: ['imap.mail.me.com'],
    webmail: 'https://www.icloud.com/mail',
    help: 'appleid.apple.com → Sign-In and Security → App-Specific Passwords.',
  },
  custom: {
    name: 'Other (IMAP)',
    hosts: [],
    webmail: null,
    help: 'Your provider’s IMAP host (port 993, TLS) and an app password.',
  },
};

/** Reads a mailbox; replaced in tests. */
export abstract class Mailbox {
  /** Checks the login; resolves with the host that worked. */
  abstract verify(user: string, password: string, hosts: string[]): Promise<string>;
  /** Unread mail in the inbox from the last 7 days, newest first. Read-only: nothing is marked or moved. */
  abstract unread(cfg: MailboxConfig, max: number): Promise<{ unread: number; items: MailItem[] }>;
}

@Injectable()
export class ImapMailbox extends Mailbox {
  private readonly log = new Logger('mailbox');

  private client(cfg: MailboxConfig) {
    return new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: true,
      auth: { user: cfg.user, pass: cfg.password },
      logger: false,
      socketTimeout: 20_000,
      greetingTimeout: 10_000,
    });
  }

  async verify(user: string, password: string, hosts: string[]): Promise<string> {
    let last: unknown = null;
    for (const host of hosts) {
      const c = this.client({ host, port: 993, user, password });
      try {
        await c.connect();
        await c.logout();
        return host;
      } catch (e) {
        last = e;
        c.close();
      }
    }
    throw last ?? new Error('no host');
  }

  async unread(cfg: MailboxConfig, max: number) {
    const c = this.client(cfg);
    await c.connect();
    const lock = await c.getMailboxLock('INBOX', { readOnly: true });
    try {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const uids = ((await c.search({ seen: false, since }, { uid: true })) || []) as number[];
      const pick = uids.slice(-max).reverse();
      const items: MailItem[] = [];
      if (pick.length) {
        for await (const m of c.fetch(
          pick.join(','),
          { uid: true, envelope: true, internalDate: true },
          { uid: true },
        )) {
          const f = m.envelope?.from?.[0];
          items.push({
            id: String(m.uid),
            from: f ? (f.name ? `${f.name} <${f.address ?? ''}>` : (f.address ?? '')) : '',
            subject: m.envelope?.subject || '(no subject)',
            snippet: '',
            at: m.internalDate ? new Date(m.internalDate).toISOString() : null,
            url: null,
          });
        }
      }
      items.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
      return { unread: uids.length, items };
    } finally {
      lock.release();
      await c.logout().catch((e: Error) => this.log.warn(e.message));
    }
  }
}
