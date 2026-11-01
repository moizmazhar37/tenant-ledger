import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Tenant data is only reachable through src/db/tenant.ts, which scopes every query.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/db/schema',
              importNames: ['ledgerEntries'],
              message: 'Query ledger entries through withTenant() in @/db/tenant.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**']),
]);
