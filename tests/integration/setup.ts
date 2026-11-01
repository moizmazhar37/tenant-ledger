import { afterAll } from 'vitest';
import { closeDb } from '@/db/client';

afterAll(async () => {
  await closeDb();
});
