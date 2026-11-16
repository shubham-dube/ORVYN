import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
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

  async issueRefresh(userId: string, deviceId: string, db: Db = this.db): Promise<string> {
    const token = randomToken();
    await db.insert(refreshTokens).values({
      id: newId(),
      ownerId: userId,
      deviceId,
      tokenHash: hashSecret(this.env.TOKEN_PEPPER, token),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    });
    return token;
  }

  /** Exchange a refresh token for a new one (rotation). Reuse of a rotated token revokes the whole device. */
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
