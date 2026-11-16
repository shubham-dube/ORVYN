import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import postgres from 'postgres';

/** Applies committed migrations (drizzle/). Used by `pnpm migrate`, tests and the deploy script. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  runMigrations(url).then(
    () => console.warn('migrations applied'),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
