import { Inject, Injectable } from '@nestjs/common';
import { type DeviceInfo, type LinkStartResponse } from '@orvyn/contracts';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import { badRequest, forbidden, tooMany, unauthorized } from '../../common/errors';
import { RateLimiter, REDIS } from '../../common/redis.module';
import { type ClientInfo } from '../../common/request';
import { ENV, type Env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { AuthService, type IssuedSession } from './auth.service';

const CODE_TTL_S = 120;
type LinkClient = LinkStartResponse['client'];

interface Pending {
  userId: string;
  challenge: string;
  client: LinkClient;
  redirectUri: string;
}

const sha256b64url = (s: string) => createHash('sha256').update(s).digest('base64url');

/**
 * Desktop/extension linking with PKCE. Codes are random, single-use, 2-minute, stored only as a hash, and bound to
 * the app's challenge, redirect and client type — a stolen code is useless without the app's verifier.
 */
@Injectable()
export class LinkService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Which kind of app a redirect belongs to, or null if it isn't one we trust. */
  classify(redirectUri: string): LinkClient | null {
    let u: URL;
    try {
      u = new URL(redirectUri);
    } catch {
      return null;
    }
    if (u.username || u.password || u.hash) return null;
    // desktop: loopback only (RFC 8252 §7.3), any port
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === '[::1]')) return 'desktop';
    // extension: chrome.identity redirect for an allowlisted extension id
    const m = /^([a-p]{32})\.chromiumapp\.org$/.exec(u.hostname);
    if (u.protocol === 'https:' && m && this.env.EXTENSION_IDS.includes(m[1]!)) return 'extension';
    return null;
  }

  async start(
    userId: string,
    challenge: string,
    redirectUri: string,
    state: string,
    client: ClientInfo,
  ): Promise<LinkStartResponse> {
    const kind = this.classify(redirectUri);
    if (!kind) throw badRequest('redirect_not_allowed', 'This app is not allowed to connect.');
    if (!(await this.limiter.hit(`link:start:${userId}`, 10, 600))) throw tooMany();
    const code = randomBytes(32).toString('base64url');
    const pending: Pending = { userId, challenge, client: kind, redirectUri };
    await this.redis.set(`link:${sha256b64url(code)}`, JSON.stringify(pending), 'EX', CODE_TTL_S);
    await this.audit.record('auth.link_approved', { actorId: userId, client, meta: { client: kind } });
    const to = new URL(redirectUri);
    to.searchParams.set('code', code);
    to.searchParams.set('state', state);
    return { redirect: to.toString(), client: kind };
  }

  async redeem(
    code: string,
    verifier: string,
    device: DeviceInfo,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    if (!(await this.limiter.hit(`link:redeem:${client.ip}`, 20, 600))) throw tooMany();
    // single use: the code is gone after the first attempt, right or wrong
    const raw = await this.redis.getdel(`link:${sha256b64url(code)}`);
    if (!raw) throw unauthorized('link_invalid');
    const p = JSON.parse(raw) as Pending;
    const expected = Buffer.from(p.challenge);
    const actual = Buffer.from(sha256b64url(verifier));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw unauthorized('link_invalid');
    const platformOk =
      p.client === 'extension'
        ? device.platform === 'extension'
        : ['windows', 'macos', 'linux'].includes(device.platform);
    if (!platformOk) throw forbidden('link_wrong_client', 'This code was issued for a different app.');
    return this.auth.signInLinked(p.userId, device, client);
  }
}
