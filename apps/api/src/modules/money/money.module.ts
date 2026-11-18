import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import {
  AccountFields,
  BudgetFields,
  CategoryFields,
  MONEY_ACCOUNT,
  MONEY_BUDGET,
  MONEY_RECURRING,
  RecurringFields,
  MONEY_CATEGORY,
  MONEY_TRANSACTION,
  TransactionFields,
} from '@orvyn/contracts';
import { and, eq, isNull, ne, type SQL } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { Rejected, SyncRegistry, type Tx } from '../sync/sync.registry';
import { SyncModule } from '../sync/sync.module';
import { tableEntity } from '../sync/table-entity';
import { MoneyController } from './money.controller';
import {
  moneyAccounts,
  moneyBudgets,
  moneyCategories,
  moneyRecurring,
  moneyTransactions,
} from './money.schema';
import { RecurringService } from './recurring.service';
import { serverOrigin } from '../sync/sync.service';

type Owned = PgTable & { id: PgColumn; ownerId: PgColumn; deletedAt: PgColumn };

/** A referenced row must be the person's own (rule 5: cross-user access only through sharing objects). */
async function mine(tx: Tx, table: Owned, ownerId: string, id: unknown, what: string) {
  if (typeof id !== 'string') return;
  const [r] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.ownerId, ownerId), isNull(table.deletedAt)) as SQL);
  if (!r) throw new Rejected(`unknown ${what}`);
}

@Injectable()
class MoneyEntities implements OnModuleInit {
  constructor(private readonly registry: SyncRegistry) {}

  onModuleInit(): void {
    this.registry.register(
      tableEntity({ name: MONEY_ACCOUNT, entitlement: 'money', table: moneyAccounts, schema: AccountFields }),
    );
    this.registry.register(
      tableEntity({
        name: MONEY_CATEGORY,
        entitlement: 'money',
        table: moneyCategories,
        schema: CategoryFields,
      }),
    );
    this.registry.register(
      tableEntity({
        name: MONEY_BUDGET,
        entitlement: 'money',
        table: moneyBudgets,
        schema: BudgetFields,
        validate: (tx, ownerId, f) => mine(tx, moneyCategories, ownerId, f.categoryId, 'category'),
      }),
    );
    this.registry.register(
      tableEntity({
        name: MONEY_RECURRING,
        entitlement: 'money',
        table: moneyRecurring,
        schema: RecurringFields,
        validate: async (tx, ownerId, f) => {
          await mine(tx, moneyCategories, ownerId, f.categoryId, 'category');
          await mine(tx, moneyAccounts, ownerId, f.accountId, 'account');
          if (!serverOrigin.getStore() && 'lastRunOn' in f && f.lastRunOn !== null)
            throw new Rejected('lastRunOn is the server’s');
          if (typeof f.rrule === 'string' && !/^(RRULE:)?FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)\b/i.test(f.rrule))
            throw new Rejected('not a repeat rule');
        },
      }),
    );
    this.registry.register(
      tableEntity({
        name: MONEY_TRANSACTION,
        entitlement: 'money',
        table: moneyTransactions,
        schema: TransactionFields,
        timestamps: ['occurredAt'],
        validate: async (tx, ownerId, f, id) => {
          await mine(tx, moneyCategories, ownerId, f.categoryId, 'category');
          await mine(tx, moneyAccounts, ownerId, f.accountId, 'account');
          if (typeof f.dedupeKey === 'string') {
            const [dup] = await tx
              .select({ id: moneyTransactions.id })
              .from(moneyTransactions)
              .where(
                and(
                  eq(moneyTransactions.ownerId, ownerId),
                  eq(moneyTransactions.dedupeKey, f.dedupeKey),
                  isNull(moneyTransactions.deletedAt),
                  ne(moneyTransactions.id, id),
                ),
              );
            if (dup) throw new Rejected('duplicate'); // the same payment is already recorded (AC2)
          }
        },
      }),
    );
  }
}

@Module({
  imports: [SyncModule],
  providers: [MoneyEntities, RecurringService],
  controllers: [MoneyController],
})
export class MoneyModule {}
