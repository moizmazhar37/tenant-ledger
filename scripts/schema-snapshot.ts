/**
 * Applies every migration to a throwaway database on the DATABASE_URL server and writes
 * the resulting schema to drizzle/schema-snapshot.txt. Commit the file with the migration.
 * `npm run db:snapshot:check` regenerates it and fails on any git diff, which is what the
 * migration-check workflow runs.
 */
import './load-env';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { introspectSchema, renderSchema } from '@/db/introspect';

const SNAPSHOT_PATH = 'drizzle/schema-snapshot.txt';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const name = `tenant_ledger_snapshot_${randomBytes(4).toString('hex')}`;
const freshUrl = new URL(url);
freshUrl.pathname = `/${name}`;

const admin = postgres(url, { max: 1, onnotice: () => {} });
let rendered: string;
try {
  await admin.unsafe(`create database "${name}"`);
  const fresh = postgres(freshUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(fresh), { migrationsFolder: 'drizzle' });
    rendered = renderSchema(await introspectSchema(fresh));
  } finally {
    await fresh.end();
  }
} finally {
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.end();
}

writeFileSync(SNAPSHOT_PATH, rendered);
console.log(`Wrote ${SNAPSHOT_PATH}`);
