import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { DROP_ITEM, DropItemFields } from '@orvyn/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { files } from '../files/files.schema';
import { Rejected, SyncRegistry } from '../sync/sync.registry';
import { SyncModule } from '../sync/sync.module';
import { serverOrigin } from '../sync/sync.service';
import { tableEntity } from '../sync/table-entity';
import { dropItems } from './drop.schema';
import { DropService } from './drop.service';

/** What a device may set; the proposal and the in-between states are the server's (AI never acts silently). */
const DEVICE_STATUSES = new Set(['new', 'done', 'kept', 'dismissed']);

@Injectable()
class DropEntities implements OnModuleInit {
  constructor(private readonly registry: SyncRegistry) {}
  onModuleInit(): void {
    this.registry.register(
      tableEntity({
        name: DROP_ITEM,
        entitlement: 'drop',
        table: dropItems,
        schema: DropItemFields,
        validate: async (tx, ownerId, f) => {
          if (!serverOrigin.getStore()) {
            if ('proposal' in f && f.proposal !== null) throw new Rejected('proposals come from the server');
            if ('problem' in f && f.problem !== null) throw new Rejected('proposals come from the server');
            if (typeof f.status === 'string' && !DEVICE_STATUSES.has(f.status))
              throw new Rejected('not a status a device sets');
          }
          if (typeof f.fileId === 'string') {
            const [own] = await tx
              .select({ id: files.id })
              .from(files)
              .where(and(eq(files.id, f.fileId), eq(files.ownerId, ownerId), isNull(files.deletedAt)));
            if (!own) throw new Rejected('unknown file');
          }
        },
      }),
    );
  }
}

@Module({ imports: [SyncModule], providers: [DropEntities, DropService], exports: [DropService] })
export class DropModule {}
