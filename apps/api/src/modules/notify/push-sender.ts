import { Inject, Injectable, Logger } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import webpush from 'web-push';
import { ENV, type Env } from '../../config/env';

export interface PushPayload {
  type: 'notify' | 'dismiss' | 'read';
  id: string;
  title?: string;
  body?: string;
  url?: string | null;
  module?: string;
  priority?: string;
  alarm?: boolean;
  actions?: { id: string; label: string; open?: string; reply?: { placeholder: string } }[];
  /** the task a reminder is about */
  task?: string;
}

const PUSH_BYTES = 3400;
const size = (p: PushPayload) => Buffer.byteLength(JSON.stringify(p));
/** Push services take 4 KB, and Hindi is three bytes a letter: a long body is cut, never the whole push lost. */
export function fit(p: PushPayload): PushPayload {
  let out = p;
  while (size(out) > PUSH_BYTES && (out.body?.length ?? 0) > 0)
    out = {
      ...out,
      body:
        [...out.body!].slice(0, Math.floor([...out.body!].length * 0.8) - 1).join('') +
        (out.body!.length > 8 ? '…' : ''),
      ...(out.body!.length <= 8 ? { body: '' } : {}),
    };
  if (size(out) > PUSH_BYTES) out = { ...out, actions: [] };
  return out;
}

export type SendOutcome = 'sent' | 'gone' | 'failed' | 'skipped';
/** What happened, with the push service's own words when it refused (shown in delivery checks). */
export type SendResult = SendOutcome | { outcome: SendOutcome; detail: string; again?: boolean };
/** down or busy: worth another try */
const passing = (status: number | undefined) => !status || status === 429 || status >= 500;
export const outcomeOf = (r: SendResult) =>
  typeof r === 'string' ? { outcome: r, detail: '', again: false } : { again: false, ...r };

export interface PushTargetRef {
  channel: 'webpush' | 'fcm';
  /** fcm: send to message.fid (current) or message.token (older phones, deprecated by Firebase) */
  format?: 'fid' | 'token';
  address: string;
  keys: { p256dh: string; auth: string } | null;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');
export interface PushSender {
  send(target: PushTargetRef, payload: PushPayload): Promise<SendResult>;
  /** which push services this server can use (missing keys = can't) */
  capabilities?(): { webpush: boolean; fcm: boolean };
}

/**
 * Real delivery: Web Push (VAPID) for browsers / installed PWAs (incl. iPhone home-screen apps) and FCM HTTP v1
 * data messages for Android (the app renders them, so actions and dismiss-everywhere work).
 */
@Injectable()
export class LivePushSender implements PushSender {
  private readonly log = new Logger('push');
  private fcm: { client: JWT; project: string } | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    }
    if (env.FCM_SERVICE_ACCOUNT_B64) {
      const sa = JSON.parse(Buffer.from(env.FCM_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')) as {
        client_email: string;
        private_key: string;
        project_id: string;
      };
      this.fcm = {
        project: sa.project_id,
        client: new JWT({
          email: sa.client_email,
          key: sa.private_key,
          scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        }),
      };
    }
  }

  capabilities() {
    return { webpush: !!(this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY), fcm: !!this.fcm };
  }

  async send(t: PushTargetRef, payload: PushPayload): Promise<SendResult> {
    const p = fit(payload);
    return t.channel === 'webpush' ? this.webpush(t, p) : this.fcmSend(t, p);
  }

  private async webpush(t: PushTargetRef, payload: PushPayload): Promise<SendResult> {
    if (!this.env.VAPID_PUBLIC_KEY)
      return { outcome: 'skipped', detail: 'VAPID keys are not set on the server' };
    if (!t.keys) return { outcome: 'skipped', detail: 'this browser sent no keys' };
    try {
      await webpush.sendNotification({ endpoint: t.address, keys: t.keys }, JSON.stringify(payload), {
        TTL: 24 * 3600,
        timeout: 15_000,
        // what is shown goes at once (a phone browser holds 'normal' while it dozes); clears and quiet ones can wait
        urgency: payload.type === 'notify' && payload.priority !== 'low' ? 'high' : 'normal',
        topic: payload.id.replace(/-/g, '').slice(0, 32), // a later push for the same notification replaces it
      });
      return 'sent';
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      const detail = `${err.statusCode ?? ''} ${(err.body ?? err.message ?? '').slice(0, 200)}`.trim();
      if (err.statusCode === 404 || err.statusCode === 410)
        return { outcome: 'gone', detail: 'this browser’s subscription expired' };
      this.log.warn(`web push failed: ${detail}`);
      return { outcome: 'failed', detail, again: passing(err.statusCode) };
    }
  }

  private async fcmSend(t: PushTargetRef, payload: PushPayload): Promise<SendResult> {
    if (!this.fcm) return { outcome: 'skipped', detail: 'FCM_SERVICE_ACCOUNT_B64 is not set on the server' };
    let token: string | null | undefined;
    try {
      ({ token } = await this.fcm.client.getAccessToken());
    } catch (e) {
      return {
        outcome: 'failed',
        detail: `Google sign-in for FCM failed: ${(e as Error).message.slice(0, 160)}`,
        again: true,
      };
    }
    const data: Record<string, string> = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v ?? null)]),
    );
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.fcm.project}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          ...(t.format === 'fid' ? { fid: t.address } : { token: t.address }),
          data,
          // high is for what is shown at once: Android slows down an app that uses it for silent clears
          android: { priority: payload.type === 'notify' ? 'high' : 'normal', ttl: '86400s' },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return 'sent';
    const text = await res.text().catch(() => '');
    // a 400 about the message itself says nothing about the phone
    if (
      /UNREGISTERED|SENDER_ID_MISMATCH/.test(text) ||
      res.status === 404 ||
      (res.status === 400 && /registration token|\bfid\b|installation/i.test(text))
    )
      return {
        outcome: 'gone',
        detail: 'this phone’s push token is no longer valid; open the app to renew it',
      };
    this.log.warn(`fcm failed: ${res.status} ${text.slice(0, 200)}`);
    return { outcome: 'failed', detail: `${res.status} ${text.slice(0, 200)}`, again: passing(res.status) };
  }
}
