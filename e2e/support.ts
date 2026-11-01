import { expect, type Page } from '@playwright/test';
import { SEED } from '../src/db/seed';

export type TenantKey = keyof typeof SEED;

export function storageStatePath(tenant: TenantKey): string {
  return `playwright/.auth/${tenant}.json`;
}

export async function signIn(page: Page, tenant: TenantKey): Promise<void> {
  const { member, organisation } = SEED[tenant];
  await page.goto('/login');
  await page.getByLabel('Email').fill(member.email);
  await page.getByLabel('Password').fill(member.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('organisation-name')).toHaveText(organisation.name);
}

/**
 * Collects anything that would indicate a broken render: uncaught exceptions and console
 * errors. Call before navigating, assert after.
 */
export function watchForErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return () => errors;
}
