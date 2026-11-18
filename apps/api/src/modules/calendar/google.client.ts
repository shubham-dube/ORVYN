import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

export const CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  // also what creates Meet links and sends invitations (spec 0007 C2)
  'https://www.googleapis.com/auth/calendar.events',
];
/** Asked only when the person adds Gmail to an account. Read-only. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** Google's representation, only the fields ORVYN reads or writes. */
export interface GEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}
export interface GEvent {
  id: string;
  etag?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start?: GEventTime;
  end?: GEventTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GEventTime;
}
export interface GCalendar {
  id: string;
  summary: string;
  summaryOverride?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  timeZone?: string;
}

/** The refresh token was revoked or expired: the person must reconnect that account. */
export class ReconnectNeeded extends Error {}
/** The sync token is too old (HTTP 410): sync that calendar fully again. */
export class SyncTokenGone extends Error {}
/** The event changed on Google since we last saw it (HTTP 412 on If-Match). */
export class EtagMismatch extends Error {}
export class GoogleHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A thin, typed HTTP client for Google OAuth + Calendar v3. Base URLs come from the environment (tests: a fake). */
@Injectable()
export class GoogleCalendarClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get configured(): boolean {
    return !!(this.env.GOOGLE_WEB_CLIENT_ID && this.env.GOOGLE_WEB_CLIENT_SECRET);
  }

  get redirectUri(): string {
    return `${this.env.API_URL}/calendar/google/callback`;
  }

  authUrl(state: string, challenge: string, loginHint?: string, extraScopes: string[] = []): string {
    const u = new URL(this.env.GOOGLE_AUTH_URL);
    u.search = new URLSearchParams({
      client_id: this.env.GOOGLE_WEB_CLIENT_ID,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: [...CALENDAR_SCOPES, ...extraScopes].join(' '),
      access_type: 'offline',
      // always ask, so Google returns a refresh token even for an account connected before
      prompt: 'consent select_account',
      include_granted_scopes: 'true',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(loginHint ? { login_hint: loginHint } : {}),
    }).toString();
    return u.toString();
  }

  private async token(body: Record<string, string>) {
    const r = await fetch(this.env.GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.GOOGLE_WEB_CLIENT_ID,
        client_secret: this.env.GOOGLE_WEB_CLIENT_SECRET,
        ...body,
      }),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
      if (j.error === 'invalid_grant') throw new ReconnectNeeded('google refused the grant');
      throw new GoogleHttpError(r.status, `token: ${String(j.error ?? r.status)}`);
    }
    return j as { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
  }

  exchange(code: string, verifier: string) {
    return this.token({
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
    });
  }

  refresh(refreshToken: string) {
    return this.token({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  }

  async revoke(token: string): Promise<void> {
    await fetch(this.env.GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }).catch(() => undefined);
  }

  private async call<T>(
    at: string,
    method: string,
    path: string,
    o: { query?: Record<string, string | undefined>; body?: unknown; ifMatch?: string } = {},
  ): Promise<T> {
    const u = new URL(path.startsWith('http') ? path : `${this.env.GOOGLE_CALENDAR_API}${path}`);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) u.searchParams.set(k, v);
    const r = await fetch(u, {
      method,
      headers: {
        authorization: `Bearer ${at}`,
        ...(o.body ? { 'content-type': 'application/json' } : {}),
        ...(o.ifMatch ? { 'if-match': o.ifMatch } : {}),
      },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    if (r.status === 410) throw new SyncTokenGone('sync token gone');
    if (r.status === 412) throw new EtagMismatch('etag mismatch');
    if (r.status === 401) throw new GoogleHttpError(401, 'unauthorized');
    if (!r.ok) throw new GoogleHttpError(r.status, `${method} ${u.pathname}: ${r.status}`);
    return (r.status === 204 ? undefined : await r.json()) as T;
  }

  async email(at: string): Promise<string> {
    const j = await this.call<{ email?: string }>(at, 'GET', this.env.GOOGLE_USERINFO_URL);
    if (!j.email) throw new GoogleHttpError(400, 'no email on the Google account');
    return j.email.toLowerCase();
  }

  async calendars(at: string): Promise<GCalendar[]> {
    const out: GCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const j = await this.call<{ items?: GCalendar[]; nextPageToken?: string }>(
        at,
        'GET',
        '/users/me/calendarList',
        {
          query: { pageToken, minAccessRole: 'reader' },
        },
      );
      out.push(...(j.items ?? []));
      pageToken = j.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** One page of changes: with a sync token (incremental) or from timeMin (first/full sync). */
  events(at: string, calendarId: string, q: { syncToken?: string; pageToken?: string; timeMin?: string }) {
    return this.call<{ items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
      at,
      'GET',
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        query: {
          syncToken: q.syncToken,
          pageToken: q.pageToken,
          timeMin: q.syncToken ? undefined : q.timeMin,
          showDeleted: 'true',
          singleEvents: 'false',
          maxResults: '250',
        },
      },
    );
  }

  insert(at: string, calendarId: string, e: Partial<GEvent>) {
    return this.call<GEvent>(at, 'POST', `/calendars/${encodeURIComponent(calendarId)}/events`, { body: e });
  }

  /**
   * A meeting: the event with a Google Meet link and the attendees; Google emails the invitations (sendUpdates=all).
   */
  meeting(
    at: string,
    calendarId: string,
    e: Partial<GEvent> & { attendees: { email: string }[]; meet: boolean; requestId: string },
  ) {
    const { meet, requestId, ...event } = e;
    return this.call<GEvent & { hangoutLink?: string; htmlLink?: string }>(
      at,
      'POST',
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        query: { conferenceDataVersion: meet ? '1' : undefined, sendUpdates: 'all' },
        body: {
          ...event,
          ...(meet
            ? {
                conferenceData: {
                  createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
                },
              }
            : {}),
        },
      },
    );
  }

  /** Unread mail in the primary inbox from the last week: sender, subject, a snippet (read-only). */
  async inbox(at: string, max = 10) {
    const base = this.env.GOOGLE_GMAIL_API;
    const list = await this.call<{ messages?: { id: string }[]; resultSizeEstimate?: number }>(
      at,
      'GET',
      `${base}/users/me/messages`,
      { query: { q: 'is:unread category:primary newer_than:7d', maxResults: String(max) } },
    );
    const items = await Promise.all(
      (list.messages ?? []).map((m) =>
        this.call<{
          id: string;
          threadId: string;
          snippet?: string;
          internalDate?: string;
          payload?: { headers?: { name: string; value: string }[] };
        }>(
          at,
          'GET',
          `${base}/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        ),
      ),
    );
    const header = (r: (typeof items)[number], n: string) =>
      r.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? '';
    return {
      unread: list.resultSizeEstimate ?? items.length,
      items: items.map((r) => ({
        id: r.id,
        from: header(r, 'From'),
        subject: header(r, 'Subject') || '(no subject)',
        snippet: (r.snippet ?? '').slice(0, 200),
        at: r.internalDate ? new Date(Number(r.internalDate)).toISOString() : null,
        url: `https://mail.google.com/mail/u/0/#inbox/${r.threadId}`,
      })),
    };
  }

  patch(at: string, calendarId: string, eventId: string, e: Partial<GEvent>, etag?: string | null) {
    return this.call<GEvent>(
      at,
      'PATCH',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { body: e, ifMatch: etag ?? undefined },
    );
  }

  async remove(at: string, calendarId: string, eventId: string, etag?: string | null): Promise<void> {
    try {
      await this.call<void>(
        at,
        'DELETE',
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { ifMatch: etag ?? undefined },
      );
    } catch (e) {
      if (e instanceof SyncTokenGone || (e instanceof GoogleHttpError && e.status === 404)) return; // already gone
      throw e;
    }
  }

  watch(at: string, calendarId: string, ch: { id: string; token: string; address: string }) {
    return this.call<{ resourceId: string; expiration?: string }>(
      at,
      'POST',
      `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      { body: { id: ch.id, type: 'web_hook', address: ch.address, token: ch.token } },
    );
  }

  async stop(at: string, channelId: string, resourceId: string): Promise<void> {
    await this.call<void>(at, 'POST', '/channels/stop', { body: { id: channelId, resourceId } }).catch(
      () => undefined,
    );
  }
}
