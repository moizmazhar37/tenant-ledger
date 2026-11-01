import { expect, test } from '@playwright/test';
import { SEED } from '../src/db/seed';
import { signIn, storageStatePath, type TenantKey } from './support';

const pairs = [
  { viewer: 'acme', owner: 'globex' },
  { viewer: 'globex', owner: 'acme' },
] as const satisfies { viewer: TenantKey; owner: TenantKey }[];

for (const { viewer, owner } of pairs) {
  test.describe(`${viewer} member looking at ${owner} data`, () => {
    test.use({ storageState: storageStatePath(viewer) });

    test('the dashboard lists only their own entries', async ({ page }) => {
      await page.goto('/dashboard');
      for (const entry of SEED[viewer].entries) {
        await expect(page.getByRole('link', { name: entry.description })).toBeVisible();
      }
      for (const entry of SEED[owner].entries) {
        await expect(page.getByText(entry.description)).toHaveCount(0);
      }
    });

    test('the detail page for another organisation’s entry is a 404', async ({ page }) => {
      const foreign = SEED[owner].entries[0];
      const response = await page.goto(`/entries/${foreign.id}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(foreign.description)).toHaveCount(0);
    });

    test('the API answers 404 for another organisation’s entry', async ({ page }) => {
      const foreign = SEED[owner].entries[0];
      const response = await page.request.get(`/api/entries/${foreign.id}`);
      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    });
  });
}

test.describe('session lifecycle', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a wrong password is rejected without creating a session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(SEED.acme.member.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'not recognised' })).toBeVisible();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('signing out ends the session', async ({ page }) => {
    // Signs in afresh: signing out the shared storage-state session would break other tests.
    await signIn(page, 'acme');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
