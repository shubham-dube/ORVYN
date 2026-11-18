import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { VAULT_ITEM, VAULT_KEYS, VaultItemFields, VaultKeysFields } from '@orvyn/contracts';
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

@Module({ imports: [SyncModule], providers: [VaultEntities] })
export class VaultModule {}
