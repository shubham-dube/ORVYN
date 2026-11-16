import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ENV, type Env } from '../config/env';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export const DB = Symbol('DB');
const SQL = Symbol('SQL');

@Injectable()
class SqlCloser implements OnApplicationShutdown {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}
  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: SQL,
      inject: [ENV],
      useFactory: (env: Env) => postgres(env.DATABASE_URL, { max: 10, onnotice: () => undefined }),
    },
    { provide: DB, inject: [SQL], useFactory: (sql: postgres.Sql): Db => drizzle(sql, { schema }) },
    SqlCloser,
  ],
  exports: [DB],
})
export class DbModule {}
