import { Controller, Get, Inject, Query } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { libraryDocs } from './library.schema';

/** For clients without the whole Library on the device (the Chrome extension): a quick search. */
@Controller('library')
@RequireEntitlement('library')
export class LibraryController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('search')
  async search(@Auth() a: AuthContext, @Query('q') q = '') {
    const words = q.trim().slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 5);
    if (!words.length) return [];
    const like = (w: string) => `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db
      .select({
        id: libraryDocs.id,
        title: libraryDocs.title,
        category: libraryDocs.category,
        summary: libraryDocs.summary,
        expiresOn: libraryDocs.expiresOn,
        fileId: libraryDocs.fileId,
        mime: libraryDocs.mime,
      })
      .from(libraryDocs)
      .where(
        and(
          eq(libraryDocs.ownerId, a.userId),
          isNull(libraryDocs.deletedAt),
          ...words.map((w) =>
            or(
              ilike(libraryDocs.title, like(w)),
              ilike(libraryDocs.summary, like(w)),
              ilike(libraryDocs.category, like(w)),
              ilike(libraryDocs.text, like(w)),
              sql`${libraryDocs.tags}::text ilike ${like(w)}`,
            ),
          ),
        ),
      )
      .orderBy(desc(libraryDocs.updatedAt))
      .limit(10);
    return rows;
  }
}
