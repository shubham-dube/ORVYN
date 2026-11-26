import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { hashSecret, randomToken } from '../../common/crypto';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { newId } from '../../db/ids';
import { devices, refreshTokens } from './auth.schema';

export interface AccessClaims {
  sub: string;
  did: string;
}

export type RefreshOutcome =
  | { kind: 'ok'; userId: string; deviceId: string; refreshToken: string }
  | { kind: 'invalid' }
  /** An already-rotated token was presented: someone else may hold this device's tokens. */
  | { kind: 'reuse'; userId: string; deviceId: string };

/** How long after a refresh a lost answer may be asked for again. */
const LOST_ANSWER_MS = 10 * 60_000;

@Injectable()
export class TokensService {
  private readonly key: Uint8Array;
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
  ) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  async signAccess(userId: string, deviceId: string): Promise<string> {
    return new SignJWT({ did: deviceId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer('orvyn')
      .setAudience('orvyn')
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_S}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'orvyn',
        audience: 'orvyn',
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.did !== 'string') return null;
      return { sub: payload.sub, did: payload.did };
    } catch {
      return null;
    }
  }

  async issueRefresh(userId: string, deviceId: string, db: Db = this.db, replaced = false): Promise<string> {
    const token = randomToken();
    await db.insert(refreshTokens).values({
      id: newId(),
      ownerId: userId,
      deviceId,
      tokenHash: hashSecret(this.env.TOKEN_PEPPER, token),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      replaced,
    });
    return token;
  }

  /**
   * Exchange a refresh token for a new one (rotation). Reuse of a rotated token revokes the whole device, with one
   * exception (spec 0023): the answer to a refresh got lost on the way, so the device asks again with the token it
   * still has. That is allowed once, within minutes, and only while the token it was given has never been used.
   */
  async rotate(token: string): Promise<RefreshOutcome> {
    const hash = hashSecret(this.env.TOKEN_PEPPER, token);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ rt: refreshTokens, revokedAt: devices.revokedAt })
        .from(refreshTokens)
        .innerJoin(devices, eq(devices.id, refreshTokens.deviceId))
        .where(eq(refreshTokens.tokenHash, hash))
        .for('update');
      if (!row) return { kind: 'invalid' } as const;
      const { rt } = row;
      if (row.revokedAt) return { kind: 'invalid' } as const;
      if (rt.rotatedAt) {
        const after = await tx
          .select()
          .from(refreshTokens)
          .where(
            and(
              eq(refreshTokens.deviceId, rt.deviceId),
              ne(refreshTokens.id, rt.id), // its own time, read back, has lost its microseconds
              gt(refreshTokens.createdAt, rt.createdAt),
            ),
          )
          .for('update');
        const lost = after.length === 1 ? after[0]! : null;
        if (
          lost &&
          !lost.rotatedAt &&
          !lost.replaced &&
          Date.now() - rt.rotatedAt.getTime() < LOST_ANSWER_MS &&
          rt.expiresAt.getTime() > Date.now()
        ) {
          await tx.update(refreshTokens).set({ rotatedAt: new Date() }).where(eq(refreshTokens.id, lost.id));
          const next = await this.issueRefresh(rt.ownerId, rt.deviceId, tx as unknown as Db, true);
          return { kind: 'ok', userId: rt.ownerId, deviceId: rt.deviceId, refreshToken: next } as const;
        }
        await tx
          .update(devices)
          .set({ revokedAt: new Date(), revokedReason: 'refresh_reuse' })
          .where(and(eq(devices.id, rt.deviceId), isNull(devices.revokedAt)));
        return { kind: 'reuse', userId: rt.ownerId, deviceId: rt.deviceId } as const;
      }
      if (rt.expiresAt.getTime() < Date.now()) return { kind: 'invalid' } as const;
      await tx.update(refreshTokens).set({ rotatedAt: new Date() }).where(eq(refreshTokens.id, rt.id));
      await tx.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, rt.deviceId));
      const next = await this.issueRefresh(rt.ownerId, rt.deviceId, tx as unknown as Db);
      return { kind: 'ok', userId: rt.ownerId, deviceId: rt.deviceId, refreshToken: next } as const;
    });
  }
}
