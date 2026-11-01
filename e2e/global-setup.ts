import { createDatabase } from '../src/db/client';
import { assertTestDatabaseUrl, migrateDatabase, resetDatabase } from '../tests/support/database';

export default async function globalSetup() {
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL);
  await migrateDatabase(url);
  const { db, client } = createDatabase(url, { max: 1 });
  try {
    await resetDatabase(db);
  } finally {
    await client.end();
  }
}
