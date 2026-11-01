/**
 * Every page in the app, visited as an authenticated member and as an anonymous visitor.
 * The first test discovers pages from the filesystem, so adding a page without adding it
 * here fails the suite.
 */
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, test } from '@playwright/test';
import { SEED } from '../src/db/seed';
import { storageStatePath, watchForErrors } from './support';

type Expectation = { heading: string } | { redirectsTo: string };

interface RouteSpec {
  path: string;
  authenticated: Expectation;
  anonymous: Expectation;
}

const acmeEntry = SEED.acme.entries[0];

const ROUTES: Record<string, RouteSpec> = {
  '/': {
    path: '/',
    authenticated: { redirectsTo: '/dashboard' },
    anonymous: { redirectsTo: '/login' },
  },
  '/login': {
    path: '/login',
    authenticated: { redirectsTo: '/dashboard' },
    anonymous: { heading: 'Sign in' },
  },
  '/dashboard': {
    path: '/dashboard',
    authenticated: { heading: 'Ledger' },
    anonymous: { redirectsTo: '/login' },
  },
  '/entries/[id]': {
    path: `/entries/${acmeEntry.id}`,
    authenticated: { heading: acmeEntry.description },
    anonymous: { redirectsTo: '/login' },
  },
};

function discoverPageRoutes(dir = join(process.cwd(), 'src', 'app')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return discoverPageRoutes(full);
    if (!/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) return [];
    const segments = relative(join(process.cwd(), 'src', 'app'), dir)
      .split(sep)
      .filter((segment) => segment && !/^\(.*\)$/.test(segment));
    return [`/${segments.join('/')}`];
  });
}

test('every page under src/app has a route spec in this file', () => {
  expect(discoverPageRoutes().sort()).toEqual(Object.keys(ROUTES).sort());
});

for (const [pattern, spec] of Object.entries(ROUTES)) {
  for (const audience of ['authenticated', 'anonymous'] as const) {
    test.describe(`${pattern} as ${audience}`, () => {
      test.use({
        storageState:
          audience === 'authenticated' ? storageStatePath('acme') : { cookies: [], origins: [] },
      });

      const expectation = spec[audience];
      const title =
        'heading' in expectation
          ? `renders "${expectation.heading}" without errors`
          : `redirects to ${expectation.redirectsTo}`;

      test(title, async ({ page, baseURL }) => {
        const errors = watchForErrors(page);
        const response = await page.goto(spec.path);

        expect(response?.status(), 'final response status').toBe(200);
        if ('heading' in expectation) {
          await expect(page).toHaveURL(new URL(spec.path, baseURL).href);
          await expect(
            page.getByRole('heading', { level: 1, name: expectation.heading }),
          ).toBeVisible();
        } else {
          await expect(page).toHaveURL(new URL(expectation.redirectsTo, baseURL).href);
        }
        expect(errors()).toEqual([]);
      });
    });
  }
}
