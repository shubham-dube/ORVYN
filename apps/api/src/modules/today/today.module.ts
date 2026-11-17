import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import {
  ProjectFields,
  TaskFields,
  TODAY_PROJECT,
  TODAY_SETTINGS,
  TODAY_TASK,
  TodaySettingsFields,
} from '@orvyn/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { Rejected, SyncRegistry } from '../sync/sync.registry';
import { tableEntity } from '../sync/table-entity';
import { todayProjects, todaySettings, todayTasks } from './today.schema';

/** Today (spec 0002): projects and tasks as synced entities behind the `today` feature switch. */
@Injectable()
class TodayEntities implements OnModuleInit {
  constructor(private readonly registry: SyncRegistry) {}

  onModuleInit(): void {
    this.registry.register(
      tableEntity({
        name: TODAY_SETTINGS,
        entitlement: 'today',
        table: todaySettings,
        schema: TodaySettingsFields,
        // exactly one record per person, addressed by their own id
        validate: async (_tx, ownerId, _f, id) => {
          if (id !== ownerId) throw new Rejected('settings id must be your own id');
        },
      }),
    );
    this.registry.register(
      tableEntity({ name: TODAY_PROJECT, entitlement: 'today', table: todayProjects, schema: ProjectFields }),
    );
    this.registry.register(
      tableEntity({
        name: TODAY_TASK,
        entitlement: 'today',
        table: todayTasks,
        schema: TaskFields,
        timestamps: ['dueAt', 'scheduledStart', 'completedAt'],
        validate: async (tx, ownerId, f) => {
          if (typeof f.projectId !== 'string') return;
          const [p] = await tx
            .select({ id: todayProjects.id })
            .from(todayProjects)
            .where(
              and(
                eq(todayProjects.id, f.projectId),
                eq(todayProjects.ownerId, ownerId),
                isNull(todayProjects.deletedAt),
              ),
            );
          if (!p) throw new Rejected('unknown project');
        },
      }),
    );
  }
}

@Module({ providers: [TodayEntities] })
export class TodayModule {}
