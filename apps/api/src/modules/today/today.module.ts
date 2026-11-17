import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import {
  CalendarFields,
  EventFields,
  eventProblem,
  ProjectFields,
  TaskFields,
  TODAY_CALENDAR,
  TODAY_EVENT,
  TODAY_PROJECT,
  TODAY_SETTINGS,
  TODAY_TASK,
  TodaySettingsFields,
} from '@orvyn/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { Rejected, SyncRegistry } from '../sync/sync.registry';
import { serverOrigin } from '../sync/sync.service';
import { tableEntity } from '../sync/table-entity';

const serverWrite = {
  get active() {
    return serverOrigin.getStore() === true;
  },
};
import { SyncModule } from '../sync/sync.module';
import { RecurrenceService } from './recurrence.service';
import { RemindersService } from './reminders.service';
import { TodayController } from './today.controller';
import { todayCalendars, todayEvents, todayProjects, todaySettings, todayTasks } from './today.schema';

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
      tableEntity({
        name: TODAY_CALENDAR,
        entitlement: 'today',
        table: todayCalendars,
        schema: CalendarFields,
        validate: async (tx, ownerId, f, id) => {
          // provider calendars are made by the server's calendar sync, never by a device
          const [existing] = await tx
            .select({ provider: todayCalendars.provider })
            .from(todayCalendars)
            .where(and(eq(todayCalendars.id, id), eq(todayCalendars.ownerId, ownerId)));
          const provider = (f.provider as string | undefined) ?? existing?.provider ?? 'orvyn';
          if (provider !== 'orvyn' && !serverWrite.active) {
            const deviceMay = new Set(['visible', 'colour', 'primary']);
            if (!existing || Object.keys(f).some((k) => !deviceMay.has(k)))
              throw new Rejected('connected calendars are managed by their account');
          }
        },
      }),
    );
    this.registry.register(
      tableEntity({
        name: TODAY_EVENT,
        entitlement: 'today',
        table: todayEvents,
        schema: EventFields,
        timestamps: ['start', 'end'],
        validate: async (tx, ownerId, f, id) => {
          const [row] = await tx
            .select()
            .from(todayEvents)
            .where(and(eq(todayEvents.id, id), eq(todayEvents.ownerId, ownerId)));
          const merged = {
            ...(row
              ? { ...row, start: row.start?.toISOString() ?? null, end: row.end?.toISOString() ?? null }
              : {}),
            ...f,
          } as Partial<EventFields>;
          if (!merged.cancelled) {
            const problem = eventProblem(merged);
            if (problem) throw new Rejected(problem);
          }
          if (typeof f.calendarId === 'string') {
            const [c] = await tx
              .select({ writable: todayCalendars.writable })
              .from(todayCalendars)
              .where(
                and(
                  eq(todayCalendars.id, f.calendarId),
                  eq(todayCalendars.ownerId, ownerId),
                  isNull(todayCalendars.deletedAt),
                ),
              );
            if (!c) throw new Rejected('unknown calendar');
            if (!c.writable && !serverWrite.active) throw new Rejected('that calendar is read-only');
          }
          if (typeof f.recurringEventId === 'string') {
            const [m] = await tx
              .select({ id: todayEvents.id })
              .from(todayEvents)
              .where(and(eq(todayEvents.id, f.recurringEventId), eq(todayEvents.ownerId, ownerId)));
            if (!m) throw new Rejected('unknown series');
          }
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
        timestamps: ['dueAt', 'scheduledStart', 'completedAt', 'lastDoneAt'],
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

@Module({
  imports: [SyncModule],
  providers: [TodayEntities, RemindersService, RecurrenceService],
  controllers: [TodayController],
  exports: [RemindersService],
})
export class TodayModule {}
