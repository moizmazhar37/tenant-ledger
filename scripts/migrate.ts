import './load-env';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Migrations need a direct connection, not a transaction-mode pooler. Hosted Postgres on
// Vercel (Neon) exposes one as DATABASE_URL_UNPOOLED; locally and in CI there is no pooler.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  console.log('Migrations applied');
} finally {
  await client.end();
}
