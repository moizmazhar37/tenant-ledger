import { assertTestDatabaseUrl, migrateDatabase } from '../support/database';

export default async function setup() {
  await migrateDatabase(assertTestDatabaseUrl(process.env.DATABASE_URL));
}
