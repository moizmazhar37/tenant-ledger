import './load-env';
import { createDatabase } from '@/db/client';
import { seedDatabase } from '@/db/seed';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db, client } = createDatabase(url, { max: 1 });
try {
  await seedDatabase(db);
  console.log('Seeded organisations: Acme Ltd, Globex Corporation');
} finally {
  await client.end();
}
