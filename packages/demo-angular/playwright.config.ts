import { defineConfig, devices } from '@playwright/test';

/**
 * Port for the demo app under test.
 *
 * Configurable because `reuseExistingServer` is on outside CI: if anything else is already
 * listening on this port, Playwright attaches to it and the whole suite runs against the
 * wrong application — reporting our app as broken when it was never started. Set
 * PLAYWRIGHT_PORT to something free when that happens.
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const PORT = Number(env['PLAYWRIGHT_PORT'] ?? 4200);
const BASE_URL = env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!env['CI'],
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'on',
  },
  webServer: {
    command: `npx ng serve --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !env['CI'],
    timeout: 120 * 1000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
