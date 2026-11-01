import nextEnv from '@next/env';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Same loader and precedence as Next.js; with NODE_ENV=test this reads .env.test.
nextEnv.loadEnvConfig(process.cwd());

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          // Files share one database and reset it between tests, so they run serially.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
