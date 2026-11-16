import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { type ClientInfo } from '../../common/request';
import { DB, type Db } from '../../db/db.module';
import { auditLog } from './audit.schema';

export type AuditAction =
  | 'auth.code_sent'
  | 'auth.sign_in'
  | 'auth.sign_in_failed'
  | 'auth.refresh_reuse'
  | 'auth.sign_out'
  | 'auth.passkey_added'
  | 'auth.passkey_removed'
  | 'device.revoked'
  | 'invite.created'
  | 'invite.revoked'
  | 'invite.used'
  | 'user.created'
  | 'user.entitlements_changed'
  | 'user.disabled'
  | 'user.enabled';

@Injectable()
export class AuditService {
  private readonly log = new Logger('audit');
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(
    action: AuditAction,
    e: {
      actorId?: string | null;
      targetType?: string;
      targetId?: string;
      client?: ClientInfo;
      meta?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        action,
        actorId: e.actorId ?? null,
        targetType: e.targetType ?? null,
        targetId: e.targetId ?? null,
        ip: e.client?.ip ?? '',
        userAgent: e.client?.userAgent ?? '',
        meta: e.meta ?? {},
      });
    } catch (err) {
      this.log.error(`audit write failed for ${action}: ${String(err)}`); // never break the request
    }
  }

  async recent(limit = 200, actorId?: string) {
    const q = this.db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
    const rows = actorId ? await q.where(eq(auditLog.actorId, actorId)) : await q;
    return rows.map((r) => ({ ...r, id: r.id.toString(), createdAt: r.createdAt.toISOString() }));
  }
}
