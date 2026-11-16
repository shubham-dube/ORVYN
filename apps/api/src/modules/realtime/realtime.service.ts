import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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

  constructor(@Inject(ENV) private readonly env: Env) {}

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
    return () => {
      set.delete(entry);
      if (!set.size) this.sockets.delete(userId);
    };
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
