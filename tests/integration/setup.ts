import { afterAll, beforeEach } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { resetDatabase } from '../support/database';

beforeEach(async () => {
  await resetDatabase(getDb());
});

afterAll(async () => {
  await closeDb();
});
