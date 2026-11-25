import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '../../db/columns';
import { users } from '../auth/auth.schema';

/** The profile forms are filled from (spec 0020), as one blob sealed per person. */
export const fillProfiles = pgTable('fill_profiles', {
  ownerId: uuid('owner_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  sealed: text('sealed').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
