import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { type ServerMessage } from '@orvyn/contracts';
import Redis from 'ioredis';
import { type WebSocket } from 'ws';
import { ENV, type Env } from '../../config/env';

interface Envelope {
  userId: string;
  /** Only this device. */
  deviceId?: string;
  /** Every device of the user except this one. */
  exceptDeviceId?: string;
  /** Close the matching sockets after sending. */
  close?: boolean;
  msg: ServerMessage;
}

const CHANNEL = 'orvyn:realtime';
/** Presence (spec 0015): one sorted set per person of open sockets, scored by when each stops counting. */
const PRESENCE_TTL_MS = 70_000;
const PRESENCE_REFRESH_MS = 30_000;
const presenceKey = (u: string) => `orvyn:presence:${u}`;
const lastSeenKey = (u: string) => `orvyn:lastseen:${u}`;

/** Emitted when a person comes online (first socket) or goes offline (last socket closes). */
export interface PresenceChanged {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
}

/**
 * Pushes small messages to a person's connected devices. Messages go through Redis pub/sub so any process
 * (API or worker) can send, and whichever process holds the socket delivers it.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('realtime');
  private readonly sockets = new Map<string, Set<{ ws: WebSocket; deviceId: string }>>();
  private pub!: Redis;
  private sub!: Redis;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    this.pub = new Redis(this.env.REDIS_URL);
    this.sub = new Redis(this.env.REDIS_URL);
    await this.sub.subscribe(CHANNEL);
    this.sub.on('message', (_c, raw) => {
      try {
        this.deliverLocal(JSON.parse(raw) as Envelope);
      } catch (e) {
        this.log.warn(`bad realtime envelope: ${String(e)}`);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const set of this.sockets.values()) for (const s of set) s.ws.close(1001, 'server shutting down');
    await Promise.all([this.sub?.quit().catch(() => undefined), this.pub?.quit().catch(() => undefined)]);
  }

  attach(userId: string, deviceId: string, ws: WebSocket): () => void {
    const entry = { ws, deviceId };
    let set = this.sockets.get(userId);
    if (!set) this.sockets.set(userId, (set = new Set()));
    set.add(entry);
    const socketId = randomUUID();
    void this.online(userId, socketId);
    const refresh = setInterval(() => void this.online(userId, socketId), PRESENCE_REFRESH_MS);
    return () => {
      clearInterval(refresh);
      set.delete(entry);
      if (!set.size) this.sockets.delete(userId);
      void this.offline(userId, socketId);
    };
  }

  // ------------------------------------------------------------------ presence (online / last seen)
  private async online(userId: string, socketId: string) {
    try {
      const now = Date.now();
      const key = presenceKey(userId);
      const before = await this.pub.zcount(key, now, '+inf');
      await this.pub.zadd(key, now + PRESENCE_TTL_MS, socketId);
      await this.pub.pexpire(key, PRESENCE_TTL_MS * 2);
      if (!before) this.events.emit('presence.changed', { userId, online: true, lastSeenAt: null });
    } catch (e) {
      this.log.debug(`presence: ${String(e)}`);
    }
  }

  private async offline(userId: string, socketId: string) {
    try {
      const key = presenceKey(userId);
      await this.pub.zrem(key, socketId);
      const at = new Date().toISOString();
      await this.pub.set(lastSeenKey(userId), at, 'EX', 60 * 60 * 24 * 365);
      if (!(await this.pub.zcount(key, Date.now(), '+inf')))
        this.events.emit('presence.changed', { userId, online: false, lastSeenAt: at });
    } catch (e) {
      this.log.debug(`presence: ${String(e)}`);
    }
  }

  /** Who is online now, and when the others were last seen. */
  async presence(userIds: string[]): Promise<Map<string, { online: boolean; lastSeenAt: string | null }>> {
    const out = new Map<string, { online: boolean; lastSeenAt: string | null }>();
    if (!userIds.length) return out;
    const now = Date.now();
    const p = this.pub.pipeline();
    for (const u of userIds) p.zcount(presenceKey(u), now, '+inf').get(lastSeenKey(u));
    const r = (await p.exec()) ?? [];
    userIds.forEach((u, i) => {
      const n = Number(r[i * 2]?.[1] ?? 0);
      const seen = (r[i * 2 + 1]?.[1] as string | null) ?? null;
      out.set(u, { online: n > 0, lastSeenAt: n > 0 ? null : seen });
    });
    return out;
  }

  connectedDevices(userId: string): string[] {
    return [...(this.sockets.get(userId) ?? [])].map((s) => s.deviceId);
  }

  async send(e: Envelope): Promise<void> {
    await this.pub.publish(CHANNEL, JSON.stringify(e));
  }

  toUser(userId: string, msg: ServerMessage, exceptDeviceId?: string) {
    return this.send({ userId, msg, exceptDeviceId });
  }

  private deliverLocal(e: Envelope): void {
    const set = this.sockets.get(e.userId);
    if (!set) return;
    const data = JSON.stringify(e.msg);
    for (const s of [...set]) {
      if (e.deviceId && s.deviceId !== e.deviceId) continue;
      if (e.exceptDeviceId && s.deviceId === e.exceptDeviceId) continue;
      if (s.ws.readyState === s.ws.OPEN) s.ws.send(data);
      if (e.close) s.ws.close(4401, 'session revoked');
    }
  }

  // ------------------------------------------------------------------ security events
  @OnEvent('auth.device_revoked')
  async onDeviceRevoked(p: { userId: string; deviceId: string }) {
    await this.send({
      userId: p.userId,
      deviceId: p.deviceId,
      msg: { type: 'session.revoked' },
      close: true,
    });
  }

  @OnEvent('access.user_disabled')
  async onUserDisabled(p: { userId: string }) {
    await this.send({ userId: p.userId, msg: { type: 'session.revoked' }, close: true });
  }

  @OnEvent('access.entitlements_changed')
  async onEntitlements(p: { userId: string; entitlements: string[] }) {
    await this.toUser(p.userId, { type: 'entitlements.changed', entitlements: p.entitlements });
  }
}
