import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { LIBRARY_DOC, LibraryDocFields } from '@orvyn/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { files } from '../files/files.schema';
import { Rejected, SyncRegistry } from '../sync/sync.registry';
import { SyncModule } from '../sync/sync.module';
import { serverOrigin } from '../sync/sync.service';
import { tableEntity } from '../sync/table-entity';
import { libraryDocs } from './library.schema';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

/** What a device sets for the reading state: it asks for a read ('new'); the in-between states are the server's. */
const DEVICE_STATUSES = new Set(['new', 'ready']);

@Injectable()
class LibraryEntities implements OnModuleInit {
  constructor(private readonly registry: SyncRegistry) {}
  onModuleInit(): void {
    this.registry.register(
      tableEntity({
        name: LIBRARY_DOC,
        entitlement: 'library',
        table: libraryDocs,
        schema: LibraryDocFields,
        validate: async (tx, ownerId, f) => {
          if (!serverOrigin.getStore()) {
            if (typeof f.status === 'string' && !DEVICE_STATUSES.has(f.status))
              throw new Rejected('not a status a device sets');
            if ('problem' in f && f.problem !== null) throw new Rejected('problems come from the server');
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

@Module({
  imports: [SyncModule],
  providers: [LibraryEntities, LibraryService],
  controllers: [LibraryController],
  exports: [LibraryService],
})
export class LibraryModule {}
