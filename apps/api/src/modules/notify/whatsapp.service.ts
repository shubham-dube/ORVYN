import { createHmac, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { badRequest, tooMany } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { contactChannels } from './notify.schema';

/** +91 98765 43210 / 09876543210 / 98765-43210 → +919876543210 (E.164); anything not a plausible number → null. */
export function toE164(raw: string, defaultCountry = '91'): string | null {
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (!d.startsWith('+')) {
    d = d.replace(/^0+/, '');
    if (d.length === 10) d = `+${defaultCountry}${d}`;
    else if (d.length >= 11 && d.length <= 14) d = `+${d}`;
    else return null;
  }
  return /^\+[1-9]\d{9,14}$/.test(d) ? d : null;
}

export const maskNumber = (e164: string) => `${e164.slice(0, 3)} ••••• ••${e164.slice(-3)}`;

/**
 * WhatsApp reminders through Meta's Cloud API (D23). A number is used only after the person confirms it with a code
 * sent to it; messages go out as the approved template (one text variable), which works outside the 24-hour window.
 */
@Injectable()
export class WhatsAppService {
  private readonly log = new Logger('whatsapp');
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get available(): boolean {
    return !!(this.env.WHATSAPP_TOKEN && this.env.WHATSAPP_PHONE_ID);
  }

  private hash(ownerId: string, code: string) {
    return createHmac('sha256', this.env.TOKEN_PEPPER).update(`wa:${ownerId}:${code}`).digest('base64url');
  }

  /** The raw send: a template message with the text as its one variable. Throws on failure. */
  async sendText(to: string, text: string): Promise<void> {
    if (!this.available) throw new Error('whatsapp is not configured');
    const clean = text.replace(/\s*\n\s*/g, ' · ').slice(0, 900); // template variables can't hold line breaks
    const r = await fetch(`${this.env.WHATSAPP_API}/${this.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'template',
        template: {
          name: this.env.WHATSAPP_TEMPLATE,
          language: { code: this.env.WHATSAPP_LANG },
          components: [{ type: 'body', parameters: [{ type: 'text', text: clean }] }],
        },
      }),
    });
    if (!r.ok) throw new Error(`whatsapp ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }

  async status(ownerId: string) {
    const [c] = await this.db.select().from(contactChannels).where(eq(contactChannels.ownerId, ownerId));
    return {
      available: this.available,
      masked: c?.whatsapp ? maskNumber(c.whatsapp) : null,
      verified: !!c?.whatsappVerifiedAt,
    };
  }

  /** The confirmed number, or null (reminders to an unconfirmed number are never sent). */
  async verifiedNumber(ownerId: string): Promise<string | null> {
    const [c] = await this.db.select().from(contactChannels).where(eq(contactChannels.ownerId, ownerId));
    return c?.whatsapp && c.whatsappVerifiedAt ? c.whatsapp : null;
  }

  /** Save a number and send it a 6-digit code; it counts once the code comes back. */
  async start(ownerId: string, raw: string): Promise<void> {
    if (!this.available) throw badRequest('whatsapp_off', 'WhatsApp isn’t set up on this server yet.');
    const number = toE164(raw);
    if (!number)
      throw badRequest('bad_number', 'That doesn’t look like a phone number. Include the country code.');
    const [existing] = await this.db
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.ownerId, ownerId));
    if (existing?.verifyExpiresAt && existing.verifyExpiresAt.getTime() - 9 * 60_000 > Date.now())
      throw tooMany('Please wait a minute before asking for another code.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.sendText(number, `Your ORVYN confirmation code is ${code}. It works for 10 minutes.`);
    const values = {
      whatsapp: number,
      whatsappVerifiedAt: null,
      verifyHash: this.hash(ownerId, code),
      verifyExpiresAt: new Date(Date.now() + 10 * 60_000),
      verifyAttempts: 0,
    };
    await this.db
      .insert(contactChannels)
      .values({ ownerId, ...values })
      .onConflictDoUpdate({ target: contactChannels.ownerId, set: values });
  }

  async confirm(ownerId: string, code: string): Promise<boolean> {
    const [c] = await this.db.select().from(contactChannels).where(eq(contactChannels.ownerId, ownerId));
    if (!c?.verifyHash || !c.verifyExpiresAt || c.verifyExpiresAt.getTime() < Date.now()) return false;
    if (c.verifyAttempts >= 5) throw tooMany('Too many wrong codes. Ask for a new one.');
    if (this.hash(ownerId, code.trim()) !== c.verifyHash) {
      await this.db
        .update(contactChannels)
        .set({ verifyAttempts: c.verifyAttempts + 1 })
        .where(and(eq(contactChannels.ownerId, ownerId)));
      return false;
    }
    await this.db
      .update(contactChannels)
      .set({ whatsappVerifiedAt: new Date(), verifyHash: null, verifyExpiresAt: null, verifyAttempts: 0 })
      .where(eq(contactChannels.ownerId, ownerId));
    return true;
  }

  async remove(ownerId: string): Promise<void> {
    await this.db
      .update(contactChannels)
      .set({ whatsapp: null, whatsappVerifiedAt: null, verifyHash: null, verifyExpiresAt: null })
      .where(eq(contactChannels.ownerId, ownerId));
  }

  /** Sends to the confirmed number; returns false (quietly) when there isn't one or WhatsApp is off. */
  async notify(ownerId: string, text: string): Promise<boolean> {
    if (!this.available) return false;
    const to = await this.verifiedNumber(ownerId);
    if (!to) return false;
    try {
      await this.sendText(to, text);
      return true;
    } catch (e) {
      this.log.warn(`send failed: ${(e as Error).message}`);
      throw e; // the queue retries
    }
  }
}
