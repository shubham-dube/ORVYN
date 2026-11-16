import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends through Resend; without a key (dev/test only) mail is kept in an in-memory outbox. */
@Injectable()
export class MailService {
  private readonly log = new Logger('mail');
  private readonly outbox: (Mail & { at: Date })[] = [];

  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(mail: Mail): Promise<void> {
    if (!this.env.RESEND_API_KEY) {
      if (this.env.NODE_ENV === 'production') throw new Error('mail is not configured');
      this.outbox.push({ ...mail, at: new Date() });
      if (this.outbox.length > 200) this.outbox.shift();
      this.log.log(`[dev outbox] to=${mail.to} subject="${mail.subject}"`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.env.MAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  /** Dev/test only (the controller is not registered in production). */
  latestTo(email: string): (Mail & { at: Date }) | undefined {
    return [...this.outbox].reverse().find((m) => m.to === email);
  }
}

/** A calm, branded email: one message, one code or link. */
export function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#eaf3fb;font-family:Geist,Segoe UI,Helvetica,Arial,sans-serif;color:#0f1b2a">
<div style="max-width:480px;margin:0 auto;padding:40px 24px">
<div style="font-size:13px;font-weight:600;letter-spacing:.16em;color:#1a56c4">ORVYN</div>
<div style="margin-top:16px;padding:28px;border-radius:20px;background:#ffffff;box-shadow:0 10px 30px rgba(30,41,90,.10)">
<h1 style="margin:0 0 12px;font-size:22px;letter-spacing:-.02em">${title}</h1>${bodyHtml}</div>
<p style="font-size:12px;color:#475569;margin-top:16px">If you didn't ask for this, you can ignore this email.</p>
</div></body></html>`;
}
