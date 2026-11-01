import nextEnv from '@next/env';
import { defineConfig, devices } from '@playwright/test';

// Load .env.test like Vitest does; real environment variables (CI) take precedence.
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'test';
nextEnv.loadEnvConfig(process.cwd());

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A retry turns a real failure into a flake that nobody investigates.
  retries: 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  // Runs the production build from `npm run build`, not the dev server.
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      WEBHOOK_SECRET: process.env.WEBHOOK_SECRET ?? '',
    },
  },
});
