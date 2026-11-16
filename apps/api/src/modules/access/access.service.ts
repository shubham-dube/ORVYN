import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type CreateInviteRequest,
  ENTITLEMENT_KEYS,
  type EntitlementKey,
  isEntitlementKey,
  type Role,
} from '@orvyn/contracts';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { hashSecret, randomToken } from '../../common/crypto';
import { badRequest, notFound } from '../../common/errors';
import { type ClientInfo } from '../../common/request';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { newId } from '../../db/ids';
import { AuditService } from '../audit/audit.service';
import { devices, users } from '../auth/auth.schema';
import { entitlements, invites } from './access.schema';

export interface Principal {
  userId: string;
  role: Role;
  disabled: boolean;
  entitlements: Set<EntitlementKey>;
}

const CACHE_MS = 15_000;

/**
 * Who may do what (ADR-0005). Cached briefly per process; every change invalidates the cache and emits
 * an event so connected devices update immediately.
 */
@Injectable()
export class AccessService {
  private readonly principals = new Map<string, { at: number; p: Principal }>();
  private readonly deviceState = new Map<string, { at: number; ok: boolean; ownerId: string }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async principal(userId: string): Promise<Principal | null> {
    const hit = this.principals.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) return null;
    let keys: EntitlementKey[];
    if (u.role === 'owner') keys = [...ENTITLEMENT_KEYS];
    else {
      const rows = await this.db
        .select({ key: entitlements.key })
        .from(entitlements)
        .where(and(eq(entitlements.ownerId, userId), eq(entitlements.enabled, true)));
      keys = rows.map((r) => r.key).filter(isEntitlementKey);
    }
    const p: Principal = { userId, role: u.role, disabled: u.disabled, entitlements: new Set(keys) };
    this.principals.set(userId, { at: Date.now(), p });
    return p;
  }

  /** Device belongs to user and is not revoked. */
  async deviceActive(userId: string, deviceId: string): Promise<boolean> {
    const hit = this.deviceState.get(deviceId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok && hit.ownerId === userId;
    const [d] = await this.db
      .select({ ownerId: devices.ownerId, revokedAt: devices.revokedAt })
      .from(devices)
      .where(eq(devices.id, deviceId));
    const ok = !!d && !d.revokedAt;
    this.deviceState.set(deviceId, { at: Date.now(), ok, ownerId: d?.ownerId ?? '' });
    return ok && d?.ownerId === userId;
  }

  invalidateUser(userId: string): void {
    this.principals.delete(userId);
  }
  invalidateDevice(deviceId: string): void {
    this.deviceState.delete(deviceId);
  }

  // ------------------------------------------------------------------ admin: entitlements
  async setEntitlements(
    actorId: string,
    userId: string,
    keys: string[],
    client?: ClientInfo,
  ): Promise<string[]> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound();
    if (u.role === 'owner') throw badRequest('owner_has_all', 'The owner always has every feature.');
    const valid = [...new Set(keys.filter(isEntitlementKey))].filter((k) => k !== 'admin');
    await this.db.transaction(async (tx) => {
      await tx.delete(entitlements).where(eq(entitlements.ownerId, userId));
      if (valid.length) await tx.insert(entitlements).values(valid.map((key) => ({ ownerId: userId, key })));
    });
    this.invalidateUser(userId);
    await this.audit.record('user.entitlements_changed', {
      actorId,
      targetType: 'user',
      targetId: userId,
      client,
      meta: { keys: valid },
    });
    this.events.emit('access.entitlements_changed', { userId, entitlements: valid });
    return valid;
  }

  async setDisabled(actorId: string, userId: string, disabled: boolean, client?: ClientInfo): Promise<void> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound();
    if (u.role === 'owner') throw badRequest('cannot_disable_owner', 'The owner account cannot be disabled.');
    await this.db.update(users).set({ disabled }).where(eq(users.id, userId));
    if (disabled) {
      await this.db
        .update(devices)
        .set({ revokedAt: new Date(), revokedReason: 'user_disabled' })
        .where(and(eq(devices.ownerId, userId), isNull(devices.revokedAt)));
      this.deviceState.clear();
      this.events.emit('access.user_disabled', { userId });
    }
    this.invalidateUser(userId);
    await this.audit.record(disabled ? 'user.disabled' : 'user.enabled', {
      actorId,
      targetType: 'user',
      targetId: userId,
      client,
    });
  }

  async listUsers() {
    const rows = await this.db.select().from(users).orderBy(users.createdAt);
    const ents = await this.db.select().from(entitlements).where(eq(entitlements.enabled, true));
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      disabled: u.disabled,
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      entitlements:
        u.role === 'owner' ? [...ENTITLEMENT_KEYS] : ents.filter((e) => e.ownerId === u.id).map((e) => e.key),
    }));
  }

  // ------------------------------------------------------------------ invites
  async createInvite(actorId: string, req: CreateInviteRequest, client?: ClientInfo) {
    const token = randomToken(24);
    const id = newId();
    const keys = [...new Set(req.entitlements.filter(isEntitlementKey))].filter((k) => k !== 'admin');
    const expiresAt = new Date(Date.now() + req.expiresInDays * 86_400_000);
    await this.db.insert(invites).values({
      id,
      tokenHash: hashSecret(this.env.TOKEN_PEPPER, token),
      email: req.email ?? null,
      entitlements: keys,
      note: req.note ?? null,
      createdBy: actorId,
      expiresAt,
    });
    await this.audit.record('invite.created', {
      actorId,
      targetType: 'invite',
      targetId: id,
      client,
      meta: { keys },
    });
    return {
      id,
      email: req.email ?? null,
      entitlements: keys,
      note: req.note ?? null,
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      link: `${this.env.WEB_URL}/join/${token}`,
    };
  }

  async listInvites() {
    const rows = await this.db
      .select()
      .from(invites)
      .where(isNull(invites.revokedAt))
      .orderBy(desc(invites.createdAt));
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      entitlements: i.entitlements,
      note: i.note,
      expiresAt: i.expiresAt.toISOString(),
      usedAt: i.usedAt?.toISOString() ?? null,
    }));
  }

  async revokeInvite(actorId: string, id: string, client?: ClientInfo): Promise<void> {
    await this.db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
    await this.audit.record('invite.revoked', { actorId, targetType: 'invite', targetId: id, client });
  }

  /** A usable invite for this token (and email, when the invite names one). */
  async findUsableInvite(token: string | undefined, email?: string) {
    if (!token) return null;
    const [i] = await this.db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, hashSecret(this.env.TOKEN_PEPPER, token)),
          isNull(invites.usedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, new Date()),
        ),
      );
    if (!i) return null;
    if (email && i.email && i.email.toLowerCase() !== email.toLowerCase()) return null;
    return i;
  }

  async invitePreview(token: string) {
    const i = await this.findUsableInvite(token);
    if (!i) return { valid: false as const };
    const [by] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, i.createdBy));
    return { valid: true as const, email: i.email, invitedBy: by?.name || 'The owner' };
  }
}
