import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { serverEnv } from '@/env';
import * as schema from './schema';

type ClientOptions = Parameters<typeof postgres>[1];

export function createDatabase(url: string, options: ClientOptions = {}) {
  // prepare: false keeps us compatible with transaction-mode poolers (PgBouncer, Neon).
  const client = postgres(url, { max: 10, prepare: false, onnotice: () => {}, ...options });
  return { db: drizzle(client, { schema }), client };
}

export type Database = ReturnType<typeof createDatabase>['db'];

// Survive Next.js dev-server module reloads without leaking connection pools.
const globalForDb = globalThis as unknown as {
  tenantLedgerDb?: ReturnType<typeof createDatabase>;
};

export function getDb(): Database {
  globalForDb.tenantLedgerDb ??= createDatabase(serverEnv().DATABASE_URL);
  return globalForDb.tenantLedgerDb.db;
}

export async function closeDb(): Promise<void> {
  const instance = globalForDb.tenantLedgerDb;
  globalForDb.tenantLedgerDb = undefined;
  await instance?.client.end({ timeout: 5 });
}
