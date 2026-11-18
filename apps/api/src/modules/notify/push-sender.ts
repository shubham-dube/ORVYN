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
  actions?: { id: string; label: string; open?: string }[];
}

export type SendOutcome = 'sent' | 'gone' | 'failed' | 'skipped';

export interface PushTargetRef {
  channel: 'webpush' | 'fcm';
  address: string;
  keys: { p256dh: string; auth: string } | null;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');
export interface PushSender {
  send(target: PushTargetRef, payload: PushPayload): Promise<SendOutcome>;
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

  async send(t: PushTargetRef, payload: PushPayload): Promise<SendOutcome> {
    return t.channel === 'webpush' ? this.webpush(t, payload) : this.fcmSend(t, payload);
  }

  private async webpush(t: PushTargetRef, payload: PushPayload): Promise<SendOutcome> {
    if (!this.env.VAPID_PUBLIC_KEY || !t.keys) return 'skipped';
    try {
      await webpush.sendNotification({ endpoint: t.address, keys: t.keys }, JSON.stringify(payload), {
        TTL: 24 * 3600,
        urgency: payload.priority === 'urgent' || payload.priority === 'high' ? 'high' : 'normal',
        topic: payload.id.replace(/-/g, '').slice(0, 32), // a later push for the same notification replaces it
      });
      return 'sent';
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      this.log.warn(`web push failed: ${status ?? String(e)}`);
      return 'failed';
    }
  }

  private async fcmSend(t: PushTargetRef, payload: PushPayload): Promise<SendOutcome> {
    if (!this.fcm) return 'skipped';
    const { token } = await this.fcm.client.getAccessToken();
    const data: Record<string, string> = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v ?? null)]),
    );
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.fcm.project}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: t.address, data, android: { priority: 'high' } } }),
    });
    if (res.ok) return 'sent';
    if (res.status === 404 || res.status === 400) {
      const text = await res.text();
      if (/UNREGISTERED|INVALID_ARGUMENT/.test(text)) return 'gone';
    }
    this.log.warn(`fcm failed: ${res.status}`);
    return 'failed';
  }
}
