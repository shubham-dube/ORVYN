import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

/**
 * Just enough of Google OAuth + Calendar v3 for ORVYN's calendar sync tests: codes, refresh tokens, calendar
 * lists, events with sync tokens and paging, etags with If-Match, recurring instances, cancellations, channels.
 */
export interface FEvent {
  id: string;
  etag: string;
  status: 'confirmed' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string };
  seq: number;
}
interface FCal {
  id: string;
  summary: string;
  primary?: boolean;
  selected?: boolean;
  accessRole: string;
  events: Map<string, FEvent>;
}

export class FakeGoogleCalendar {
  server!: Server;
  url = '';
  seq = 0;
  accounts = new Map<string, FCal[]>(); // email → calendars
  revoked = new Set<string>(); // refresh tokens
  requests: { method: string; path: string; ifMatch?: string; body?: unknown }[] = [];
  watches = 0;
  private tokens = new Map<string, string>(); // access token → email
  private n = 0;

  addAccount(email: string, cals: Omit<FCal, 'events'>[]) {
    this.accounts.set(
      email,
      cals.map((c) => ({ ...c, events: new Map() })),
    );
  }

  cal(email: string, id: string): FCal {
    return this.accounts.get(email)!.find((c) => c.id === id)!;
  }

  /** A change made "on Google" (another app, the Google Calendar UI…). */
  put(email: string, calId: string, e: Partial<FEvent> & { id: string }): FEvent {
    const c = this.cal(email, calId);
    const prev = c.events.get(e.id);
    const ev: FEvent = {
      status: 'confirmed',
      ...prev,
      ...e,
      etag: `"${++this.seq}"`,
      seq: this.seq,
    } as FEvent;
    c.events.set(e.id, ev);
    return ev;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  close() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }

  env() {
    return {
      GOOGLE_WEB_CLIENT_ID: 'client-id',
      GOOGLE_WEB_CLIENT_SECRET: 'client-secret',
      GOOGLE_AUTH_URL: `${this.url}/auth`,
      GOOGLE_TOKEN_URL: `${this.url}/token`,
      GOOGLE_REVOKE_URL: `${this.url}/revoke`,
      GOOGLE_USERINFO_URL: `${this.url}/userinfo`,
      GOOGLE_CALENDAR_API: `${this.url}/calendar/v3`,
    };
  }

  private send(res: ServerResponse, status: number, body?: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  private async body(req: IncomingMessage): Promise<string> {
    let s = '';
    for await (const c of req) s += c;
    return s;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url!, this.url);
    const raw = await this.body(req);
    const json = (() => {
      try {
        return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    })();
    const ifMatch = req.headers['if-match'] as string | undefined;
    this.requests.push({ method: req.method!, path: u.pathname, ifMatch, body: json });

    if (u.pathname === '/token') {
      const f = new URLSearchParams(raw);
      if (f.get('client_secret') !== 'client-secret') return this.send(res, 401, { error: 'invalid_client' });
      if (f.get('grant_type') === 'authorization_code') {
        const email = f.get('code')!.replace(/^code-/, '');
        if (!f.get('code_verifier')) return this.send(res, 400, { error: 'invalid_request' });
        const at = `at-${email}-${++this.n}`;
        this.tokens.set(at, email);
        return this.send(res, 200, { access_token: at, refresh_token: `rt-${email}`, expires_in: 3600 });
      }
      const rt = f.get('refresh_token')!;
      if (this.revoked.has(rt)) return this.send(res, 400, { error: 'invalid_grant' });
      const at = `at-${rt.replace(/^rt-/, '')}-${++this.n}`;
      this.tokens.set(at, rt.replace(/^rt-/, ''));
      return this.send(res, 200, { access_token: at, expires_in: 3600 });
    }
    if (u.pathname === '/revoke') {
      this.revoked.add(new URLSearchParams(raw).get('token')!);
      return this.send(res, 200, {});
    }
    const email = this.tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!email) return this.send(res, 401, { error: 'unauthorized' });
    if (u.pathname === '/userinfo') return this.send(res, 200, { email, email_verified: true });

    const cals = this.accounts.get(email) ?? [];
    if (u.pathname === '/calendar/v3/users/me/calendarList') {
      return this.send(res, 200, {
        items: cals.map(({ events: _e, ...c }) => c),
      });
    }
    if (u.pathname === '/calendar/v3/channels/stop') return this.send(res, 204);

    const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(u.pathname);
    const cal = m ? cals.find((c) => c.id === decodeURIComponent(m[1]!)) : undefined;
    if (!m || !cal) return this.send(res, 404, {});
    const eventId = m[2] ? decodeURIComponent(m[2]) : undefined;

    if (eventId === 'watch') {
      this.watches++;
      return this.send(res, 200, {
        resourceId: `res-${this.watches}`,
        expiration: String(Date.now() + 7 * 864e5),
      });
    }

    if (req.method === 'GET' && !eventId) {
      const token = u.searchParams.get('syncToken');
      if (token === 'st-expired') return this.send(res, 410, {});
      const since = token ? Number(token.replace('st-', '')) : -1;
      const all = [...cal.events.values()]
        .filter((e) => (token ? e.seq > since : e.status !== 'cancelled' || !!e.recurringEventId))
        .sort((a, b) => a.seq - b.seq);
      const from = Number(u.searchParams.get('pageToken') ?? 0);
      const page = all.slice(from, from + 2); // small pages exercise paging
      const more = from + 2 < all.length;
      return this.send(res, 200, {
        items: page.map(({ seq: _s, ...e }) => e),
        ...(more ? { nextPageToken: String(from + 2) } : { nextSyncToken: `st-${this.seq}` }),
      });
    }

    if (req.method === 'POST' && !eventId) {
      const id = `g${++this.n}`;
      const e = this.put(email, cal.id, { ...(json as Partial<FEvent>), id });
      const { seq: _s, ...out } = e;
      return this.send(res, 200, out);
    }

    if (eventId && (req.method === 'PATCH' || req.method === 'DELETE')) {
      let current = cal.events.get(eventId);
      // an occurrence not yet changed exists implicitly as <series>_<start>
      const inst = /^(.+)_(\d{8}(?:T\d{6}Z)?)$/.exec(eventId);
      if (!current && inst && cal.events.has(inst[1]!)) {
        const v = inst[2]!;
        const original =
          v.length === 8
            ? { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` }
            : {
                dateTime: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}Z`,
              };
        current = this.put(email, cal.id, {
          id: eventId,
          recurringEventId: inst[1],
          originalStartTime: original,
        });
      }
      if (!current) return this.send(res, 404, {});
      if (ifMatch && ifMatch !== current.etag) return this.send(res, 412, {});
      if (req.method === 'DELETE') {
        this.put(email, cal.id, { id: eventId, status: 'cancelled' });
        return this.send(res, 204);
      }
      const e = this.put(email, cal.id, { ...(json as Partial<FEvent>), id: eventId });
      const { seq: _s, ...out } = e;
      return this.send(res, 200, out);
    }
    return this.send(res, 404, {});
  }
}
