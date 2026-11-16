import { Inject, Injectable } from '@nestjs/common';
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { randomToken } from '../../common/crypto';
import { badRequest, notFound, unauthorized } from '../../common/errors';
import { REDIS } from '../../common/redis.module';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { passkeys, users } from './auth.schema';

const CHALLENGE_TTL_S = 300;

/** WebAuthn passkeys (usernameless sign-in) with @simplewebauthn/server. Challenges live in Redis. */
@Injectable()
export class PasskeysService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private get origins(): string[] {
    return this.env.WEBAUTHN_ORIGINS.length ? this.env.WEBAUTHN_ORIGINS : [this.env.WEB_URL];
  }

  async registrationOptions(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw unauthorized();
    const existing = await this.db.select().from(passkeys).where(eq(passkeys.ownerId, userId));
    const options = await generateRegistrationOptions({
      rpName: this.env.WEBAUTHN_RP_NAME,
      rpID: this.env.WEBAUTHN_RP_ID,
      userID: new TextEncoder().encode(u.id),
      userName: u.email,
      userDisplayName: u.name || u.email,
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({
        id: p.id,
        transports: p.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await this.redis.set(`wa:reg:${userId}`, options.challenge, 'EX', CHALLENGE_TTL_S);
    return options;
  }

  async register(userId: string, response: RegistrationResponseJSON, name: string): Promise<{ id: string }> {
    const challenge = await this.redis.getdel(`wa:reg:${userId}`);
    if (!challenge) throw badRequest('challenge_expired', 'That took too long. Please try again.');
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origins,
      expectedRPID: this.env.WEBAUTHN_RP_ID,
      requireUserVerification: false,
    }).catch(() => null);
    if (!v?.verified || !v.registrationInfo)
      throw badRequest('passkey_invalid', 'Could not add that passkey.');
    const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
    await this.db.insert(passkeys).values({
      id: credential.id,
      ownerId: userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: name.slice(0, 60) || 'Passkey',
    });
    return { id: credential.id };
  }

  async authenticationOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.env.WEBAUTHN_RP_ID,
      userVerification: 'preferred',
    });
    const challengeId = randomToken(16);
    await this.redis.set(`wa:auth:${challengeId}`, options.challenge, 'EX', CHALLENGE_TTL_S);
    return { challengeId, options };
  }

  /** Returns the user's email so the shared sign-in path can issue the session. */
  async authenticate(challengeId: string, response: AuthenticationResponseJSON): Promise<string> {
    const challenge = await this.redis.getdel(`wa:auth:${challengeId}`);
    if (!challenge) throw badRequest('challenge_expired', 'That took too long. Please try again.');
    const [row] = await this.db
      .select({ pk: passkeys, email: users.email })
      .from(passkeys)
      .innerJoin(users, eq(users.id, passkeys.ownerId))
      .where(eq(passkeys.id, response.id));
    if (!row) throw unauthorized('passkey_unknown', 'That passkey is not registered with ORVYN.');
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origins,
      expectedRPID: this.env.WEBAUTHN_RP_ID,
      credential: {
        id: row.pk.id,
        publicKey: new Uint8Array(row.pk.publicKey),
        counter: row.pk.counter,
        transports: row.pk.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: false,
    }).catch(() => null);
    if (!v?.verified) throw unauthorized('passkey_invalid', 'Passkey sign-in failed.');
    await this.db
      .update(passkeys)
      .set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(passkeys.id, row.pk.id));
    return row.email;
  }

  async list(userId: string) {
    const rows = await this.db.select().from(passkeys).where(eq(passkeys.ownerId, userId));
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      backedUp: p.backedUp,
      createdAt: p.createdAt.toISOString(),
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async remove(userId: string, id: string): Promise<void> {
    const r = await this.db
      .delete(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.ownerId, userId)))
      .returning({ id: passkeys.id });
    if (!r.length) throw notFound();
  }
}
