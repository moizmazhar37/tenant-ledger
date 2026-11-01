import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { Database } from '../../src/db/client';
import { seedDatabase } from '../../src/db/seed';

/** Test suites truncate tables. Refuse to touch anything not obviously a test database. */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is not set');
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run destructive tests against database "${name}". ` +
        'Point DATABASE_URL at a database whose name ends in _test.',
    );
  }
  return url;
}

export async function migrateDatabase(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  } finally {
    await client.end();
  }
}

/** Every test starts from the same two seeded organisations and nothing else. */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`truncate table ledger_entries, sessions, members, organisations cascade`);
  await seedDatabase(db);
}

/** Same server and credentials, different database name. */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}
