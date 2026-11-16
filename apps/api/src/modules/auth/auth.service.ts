import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type DeviceInfo, type Me } from '@orvyn/contracts';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { hashSecret, randomCode, safeEqual } from '../../common/crypto';
import { AppError, forbidden, notFound, tooMany, unauthorized } from '../../common/errors';
import { RateLimiter } from '../../common/redis.module';
import { type ClientInfo } from '../../common/request';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { newId } from '../../db/ids';
import { entitlements, invites } from '../access/access.schema';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { layout, MailService } from '../mail/mail.service';
import { devices, emailCodes, passkeys, users } from './auth.schema';
import { TokensService } from './tokens.service';

export interface Identity {
  email: string;
  name?: string;
  avatarUrl?: string | null;
  method: 'email' | 'google' | 'passkey';
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  deviceId: string;
  platform: string;
  user: Me;
}

const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokensService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly limiter: RateLimiter,
    private readonly events: EventEmitter2,
  ) {}

  // ------------------------------------------------------------------ email code
  /** Always answers the same way, so it can't be used to find out who has an account. */
  async startEmail(email: string, invite: string | undefined, client: ClientInfo): Promise<void> {
    if (!(await this.limiter.hit(`code:email:${email}`, this.env.AUTH_CODE_LIMIT, 15 * 60))) throw tooMany();
    if (!(await this.limiter.hit(`code:ip:${client.ip}`, 30, 60 * 60))) throw tooMany();
    if (!(await this.mayEnter(email, invite))) return;
    const code = randomCode();
    await this.db.insert(emailCodes).values({
      id: newId(),
      email,
      codeHash: hashSecret(this.env.TOKEN_PEPPER, `${email}:${code}`),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      ip: client.ip,
    });
    await this.mail.send({
      to: email,
      subject: `${code} is your ORVYN code`,
      text: `Your ORVYN sign-in code is ${code}. It expires in 10 minutes.`,
      html: layout(
        'Your sign-in code',
        `<p style="font-size:15px;color:#475569">Enter this code to sign in. It expires in 10 minutes.</p>
<div style="font-size:34px;font-weight:650;letter-spacing:.3em;margin:18px 0;font-family:'Geist Mono',monospace">${code}</div>`,
      ),
    });
    await this.audit.record('auth.code_sent', { targetType: 'email', targetId: email, client });
  }

  async verifyEmail(
    email: string,
    code: string,
    device: DeviceInfo,
    invite: string | undefined,
    client: ClientInfo,
  ) {
    if (!(await this.limiter.hit(`verify:${email}:${client.ip}`, 10, 15 * 60))) throw tooMany();
    const [row] = await this.db
      .select()
      .from(emailCodes)
      .where(
        and(eq(emailCodes.email, email), isNull(emailCodes.consumedAt), gt(emailCodes.expiresAt, new Date())),
      )
      .orderBy(desc(emailCodes.createdAt))
      .limit(1);
    const fail = async (reason: string) => {
      await this.audit.record('auth.sign_in_failed', {
        targetType: 'email',
        targetId: email,
        client,
        meta: { reason },
      });
      return new AppError(HttpStatus.UNAUTHORIZED, 'invalid_code', 'That code is not right or has expired.');
    };
    if (!row) throw await fail('no_code');
    if (row.attempts >= MAX_CODE_ATTEMPTS) throw await fail('too_many_attempts');
    const ok = safeEqual(row.codeHash, hashSecret(this.env.TOKEN_PEPPER, `${email}:${code}`));
    if (!ok) {
      await this.db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, row.id));
      throw await fail('wrong_code');
    }
    const [consumed] = await this.db
      .update(emailCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(emailCodes.id, row.id), isNull(emailCodes.consumedAt)))
      .returning({ id: emailCodes.id });
    if (!consumed) throw await fail('race');
    return this.signIn({ email, method: 'email' }, device, invite, client);
  }

  /** Existing account, the owner's email, or a valid invite. */
  private async mayEnter(email: string, invite?: string): Promise<boolean> {
    const [u] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);
    if (u) return !u.disabled;
    if (email === this.env.OWNER_EMAIL) return true;
    return !!(await this.access.findUsableInvite(invite, email));
  }

  // ------------------------------------------------------------------ shared sign-in
  async signIn(
    id: Identity,
    device: DeviceInfo,
    inviteToken: string | undefined,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const email = id.email.toLowerCase();
    let [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);
    if (!user) {
      if (id.method === 'passkey') throw unauthorized();
      user = await this.createUser(email, id, inviteToken, client);
    } else if (!user.name && id.name) {
      [user] = await this.db
        .update(users)
        .set({ name: id.name, avatarUrl: id.avatarUrl ?? user.avatarUrl })
        .where(eq(users.id, user.id))
        .returning();
    }
    if (!user) throw unauthorized();
    if (user.disabled) throw forbidden('account_disabled', 'This account has been disabled.');

    const deviceId = newId();
    await this.db.insert(devices).values({
      id: deviceId,
      ownerId: user.id,
      name: device.name,
      platform: device.platform,
      appVersion: device.appVersion,
      userAgent: client.userAgent,
      ip: client.ip,
    });
    await this.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
    const refreshToken = await this.tokens.issueRefresh(user.id, deviceId);
    const accessToken = await this.tokens.signAccess(user.id, deviceId);
    await this.audit.record('auth.sign_in', {
      actorId: user.id,
      targetType: 'device',
      targetId: deviceId,
      client,
      meta: { method: id.method, platform: device.platform },
    });
    this.events.emit('auth.signed_in', {
      userId: user.id,
      deviceId,
      deviceName: device.name,
      platform: device.platform,
      method: id.method,
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.env.ACCESS_TOKEN_TTL_S,
      deviceId,
      platform: device.platform,
      user: await this.me(user.id),
    };
  }

  private async createUser(email: string, id: Identity, inviteToken: string | undefined, client: ClientInfo) {
    const name = id.name ?? '';
    if (email === this.env.OWNER_EMAIL) {
      const [existingOwner] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'owner'));
      if (!existingOwner) {
        const [owner] = await this.db
          .insert(users)
          .values({ id: newId(), email, name, avatarUrl: id.avatarUrl ?? null, role: 'owner' })
          .returning();
        await this.audit.record('user.created', {
          actorId: owner!.id,
          targetType: 'user',
          targetId: owner!.id,
          client,
          meta: { role: 'owner' },
        });
        return owner!;
      }
    }
    const invite = await this.access.findUsableInvite(inviteToken, email);
    if (!invite) throw forbidden('invite_required', 'ORVYN is invite-only. Ask for an invite link.');
    return this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(invites)
        .set({ usedAt: new Date() })
        .where(and(eq(invites.id, invite.id), isNull(invites.usedAt)))
        .returning({ id: invites.id });
      if (!claimed) throw forbidden('invite_used', 'This invite has already been used.');
      const [member] = await tx
        .insert(users)
        .values({ id: newId(), email, name, avatarUrl: id.avatarUrl ?? null, role: 'member' })
        .returning();
      await tx.update(invites).set({ usedBy: member!.id }).where(eq(invites.id, invite.id));
      if (invite.entitlements.length) {
        await tx
          .insert(entitlements)
          .values(invite.entitlements.map((key) => ({ ownerId: member!.id, key })));
      }
      await this.audit.record('invite.used', {
        actorId: member!.id,
        targetType: 'invite',
        targetId: invite.id,
        client,
      });
      await this.audit.record('user.created', {
        actorId: member!.id,
        targetType: 'user',
        targetId: member!.id,
        client,
        meta: { role: 'member' },
      });
      return member!;
    });
  }

  // ------------------------------------------------------------------ sessions
  async refresh(refreshToken: string, client: ClientInfo): Promise<IssuedSession> {
    const r = await this.tokens.rotate(refreshToken);
    if (r.kind === 'invalid') throw unauthorized('session_expired');
    if (r.kind === 'reuse') {
      this.access.invalidateDevice(r.deviceId);
      await this.audit.record('auth.refresh_reuse', {
        actorId: r.userId,
        targetType: 'device',
        targetId: r.deviceId,
        client,
      });
      this.events.emit('auth.device_revoked', {
        userId: r.userId,
        deviceId: r.deviceId,
        reason: 'refresh_reuse',
      });
      throw unauthorized(
        'session_revoked',
        'For your safety this device was signed out. Please sign in again.',
      );
    }
    const p = await this.access.principal(r.userId);
    if (!p || p.disabled) throw forbidden('account_disabled', 'This account has been disabled.');
    const [d] = await this.db
      .select({ platform: devices.platform })
      .from(devices)
      .where(eq(devices.id, r.deviceId));
    return {
      accessToken: await this.tokens.signAccess(r.userId, r.deviceId),
      refreshToken: r.refreshToken,
      expiresIn: this.env.ACCESS_TOKEN_TTL_S,
      deviceId: r.deviceId,
      platform: d?.platform ?? 'web',
      user: await this.me(r.userId),
    };
  }

  async revokeDevice(userId: string, deviceId: string, reason: string, client: ClientInfo): Promise<void> {
    const [d] = await this.db
      .update(devices)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(devices.id, deviceId), eq(devices.ownerId, userId), isNull(devices.revokedAt)))
      .returning({ id: devices.id });
    if (!d) throw notFound('device_not_found', 'Device not found.');
    this.access.invalidateDevice(deviceId);
    await this.audit.record(reason === 'sign_out' ? 'auth.sign_out' : 'device.revoked', {
      actorId: userId,
      targetType: 'device',
      targetId: deviceId,
      client,
    });
    this.events.emit('auth.device_revoked', { userId, deviceId, reason });
  }

  async listDevices(userId: string, currentDeviceId: string) {
    const rows = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.ownerId, userId), isNull(devices.revokedAt)))
      .orderBy(desc(devices.lastSeenAt));
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      appVersion: d.appVersion,
      current: d.id === currentDeviceId,
      createdAt: d.createdAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
    }));
  }

  async me(userId: string): Promise<Me> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw unauthorized();
    const p = await this.access.principal(userId);
    const [pk] = await this.db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.ownerId, userId))
      .limit(1);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      role: u.role,
      entitlements: [...(p?.entitlements ?? [])],
      hasPasskey: !!pk,
    };
  }

  async updateName(userId: string, name: string): Promise<Me> {
    await this.db.update(users).set({ name }).where(eq(users.id, userId));
    this.access.invalidateUser(userId);
    return this.me(userId);
  }
}
