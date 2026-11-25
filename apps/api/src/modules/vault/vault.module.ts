import { Controller, Get, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { VAULT_ITEM, VAULT_KEYS, VaultItemFields, VaultKeysFields } from '@orvyn/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { Rejected, SyncRegistry } from '../sync/sync.registry';
import { SyncModule } from '../sync/sync.module';
import { tableEntity } from '../sync/table-entity';
import { vaultItems, vaultKeys } from './vault.schema';

/**
 * The Vault holds only what it cannot read (ADR-0004). There is deliberately no service here that decrypts, searches or
 * summarises anything, and no tool for the AI: the module exports nothing.
 */
@Injectable()
class VaultEntities implements OnModuleInit {
  constructor(private readonly registry: SyncRegistry) {}
  onModuleInit(): void {
    const keys = tableEntity({
      name: VAULT_KEYS,
      entitlement: 'vault',
      table: vaultKeys,
      schema: VaultKeysFields,
      // exactly one record per person, addressed by their own id
      validate: async (_tx, ownerId, _f, id) => {
        if (id !== ownerId) throw new Rejected('vault keys id must be your own id');
      },
    });
    this.registry.register({
      ...keys,
      // losing the keys would lock the person out of everything for good: they are replaced, never deleted
      remove: async () => {
        throw new Rejected('vault keys cannot be deleted');
      },
    });
    this.registry.register(
      tableEntity({ name: VAULT_ITEM, entitlement: 'vault', table: vaultItems, schema: VaultItemFields }),
    );
  }
}

/**
 * The same ciphertext sync serves, in one call, for devices that keep no copy of everything else (the extension,
 * ADR-0017). Nothing here can be read by the server.
 */
@Controller('vault')
@RequireEntitlement('vault')
export class VaultController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('box')
  async box(@Auth() a: AuthContext) {
    const [keys] = await this.db
      .select({ pass: vaultKeys.pass, recovery: vaultKeys.recovery })
      .from(vaultKeys)
      .where(and(eq(vaultKeys.ownerId, a.userId), isNull(vaultKeys.deletedAt)));
    const items = await this.db
      .select({ id: vaultItems.id, blob: vaultItems.blob })
      .from(vaultItems)
      .where(and(eq(vaultItems.ownerId, a.userId), isNull(vaultItems.deletedAt)));
    return { keys: keys ?? null, items };
  }
}

@Module({ imports: [SyncModule], providers: [VaultEntities], controllers: [VaultController] })
export class VaultModule {}
