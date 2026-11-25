import { Inject, Injectable } from '@nestjs/common';
import { buildDay, dayLines } from '@orvyn/activity';
import {
  type ActivityDay,
  type ActivityDaySummary,
  type ActivityRules,
  type ActivitySpan,
  ActivityStory,
} from '@orvyn/contracts';
import { instantAt } from '@orvyn/today-parse';
import { and, eq, gt, gte, lt, sql } from 'drizzle-orm';
import { badRequest } from '../../common/errors';
import { Seal } from '../../common/seal';
import { DB, type Db } from '../../db/db.module';
import { AiService } from '../ai/ai.service';
import { plainAi } from '../ai/plain';
import { activityRules, activitySpans } from './activity.schema';

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Inner = Omit<ActivitySpan, 'id' | 'start' | 'end'>;
const DAY = 86_400_000;
const MAX_DAYS = 31;

@Injectable()
export class ActivityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly seal: Seal,
    private readonly ai: AiService,
  ) {}

  /**
   * Idempotent by span id: a span still running is sent again with a later end. A span belongs to the person who first
   * sent it; an id that is someone else's is never taken over.
   */
  async push(ownerId: string, deviceId: string, spans: ActivitySpan[]): Promise<{ saved: number }> {
    const limit = Date.now() + 10 * 60_000; // a clock far ahead would put the future in the record
    const box = await this.seal.for(ownerId, 'activity');
    const byId = new Map(spans.filter((s) => Date.parse(s.end) <= limit).map((s) => [s.id, s]));
    if (!byId.size) return { saved: 0 };
    const rows = [...byId.values()].map(({ id, start, end, ...inner }) => ({
      id,
      ownerId,
      deviceId,
      startAt: new Date(start),
      endAt: new Date(end),
      sealed: box.seal(inner satisfies Inner),
    }));
    const saved = await this.db
      .insert(activitySpans)
      .values(rows)
      .onConflictDoUpdate({
        target: activitySpans.id,
        set: {
          endAt: sql`excluded.end_at`,
          sealed: sql`excluded.sealed`,
          updatedAt: sql`now()`,
        },
        // an old copy that arrives late never shortens a span
        setWhere: and(eq(activitySpans.ownerId, ownerId), sql`excluded.end_at >= ${activitySpans.endAt}`),
      })
      .returning({ id: activitySpans.id });
    return { saved: saved.length };
  }

  private async spans(ownerId: string, from: number, to: number): Promise<ActivitySpan[]> {
    const rows = await this.db
      .select()
      .from(activitySpans)
      .where(
        and(
          eq(activitySpans.ownerId, ownerId),
          // a span is at most a day long, so this stays on the index
          gte(activitySpans.startAt, new Date(from - DAY)),
          lt(activitySpans.startAt, new Date(to)),
          gt(activitySpans.endAt, new Date(from)),
        ),
      );
    const box = await this.seal.for(ownerId, 'activity');
    return rows.map((r) => ({
      ...box.open<Inner>(r.sealed),
      id: r.id,
      start: r.startAt.toISOString(),
      end: r.endAt.toISOString(),
    }));
  }

  private bounds(date: string, tz: string): { from: number; to: number } {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const real = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== date)
      throw badRequest('invalid_request', 'date: not a real day');
    return {
      from: instantAt(y, m, d, 0, 0, tz).getTime(),
      to: instantAt(y, m, d + 1, 0, 0, tz).getTime(),
    };
  }

  private build(date: string, tz: string, spans: ActivitySpan[], rules: ActivityRules): ActivityDay {
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
    return buildDay(date, spans, {
      ...this.bounds(date, tz),
      rules,
      hourOf: (ms) => Number(hour.format(ms)),
    });
  }

  async day(ownerId: string, date: string, tz: string): Promise<ActivityDay> {
    const { from, to } = this.bounds(date, tz);
    return this.build(date, tz, await this.spans(ownerId, from, to), await this.rules(ownerId));
  }

  async range(ownerId: string, from: string, to: string, tz: string): Promise<ActivityDaySummary[]> {
    const start = this.bounds(from, tz).from;
    const end = this.bounds(to, tz).to;
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    if (b < a || b - a > (MAX_DAYS - 1) * DAY)
      throw badRequest('invalid_request', `Choose up to ${MAX_DAYS} days.`);
    const rules = await this.rules(ownerId);
    const spans = await this.spans(ownerId, start, end);
    const out: ActivityDaySummary[] = [];
    for (let t = a; t <= b; t += DAY) {
      const d = this.build(new Date(t).toISOString().slice(0, 10), tz, spans, rules);
      out.push({
        date: d.date,
        activeMs: d.activeMs,
        deepMs: d.deepMs,
        firstAt: d.firstAt,
        lastAt: d.lastAt,
        byCategory: d.byCategory,
      });
    }
    return out;
  }

  /** Written only when asked for. The model sees names and durations (ADR-0018). */
  async story(ownerId: string, date: string, tz: string): Promise<ActivityStory> {
    const d = await this.day(ownerId, date, tz);
    if (d.activeMs < 5 * 60_000)
      return {
        story: 'There is not enough recorded on this day to tell.',
        wins: [],
        leaks: [],
        tomorrow: '',
      };
    const clock = (iso: string) =>
      new Date(iso).toLocaleTimeString('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    return plainAi(() =>
      this.ai.complete({
        ownerId,
        task: 'activity.story',
        system: `You tell a person how their day at the computer went, honestly and kindly, from a record of it.
Answer {"story": 3 to 6 short sentences in plain English with real times and what they worked on, "wins": up to 3,
"leaks": up to 3 places where time slipped (with durations), "tomorrow": one concrete suggestion}.
Use only what the record shows. Do not guess at feelings or at what is not in the record.`,
        data: [{ type: 'text', text: dayLines(d, clock) }],
        schema: ActivityStory,
        maxTokens: 900,
      }),
    );
  }

  async rules(ownerId: string): Promise<ActivityRules> {
    const [r] = await this.db.select().from(activityRules).where(eq(activityRules.ownerId, ownerId));
    return r?.rules ?? { categories: {}, blocked: [] };
  }

  async saveRules(ownerId: string, rules: ActivityRules): Promise<ActivityRules> {
    await this.db
      .insert(activityRules)
      .values({ ownerId, rules })
      .onConflictDoUpdate({ target: activityRules.ownerId, set: { rules, updatedAt: new Date() } });
    return rules;
  }

  /** Gone for good, for spans that started in the window. */
  async remove(ownerId: string, from: Date, to: Date): Promise<{ removed: number }> {
    const gone = await this.db
      .delete(activitySpans)
      .where(
        and(
          eq(activitySpans.ownerId, ownerId),
          gte(activitySpans.startAt, from),
          lt(activitySpans.startAt, to),
        ),
      )
      .returning({ id: activitySpans.id });
    return { removed: gone.length };
  }
}
