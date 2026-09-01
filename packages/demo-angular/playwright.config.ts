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
    /**
     * A narrow viewport, because the layout genuinely changes there.
     *
     * `styles.css` collapses the 12-column grid to one column under 640px and forces every
     * field to span it. Nothing exercised that, so a rule that stopped applying — or a
     * control that overflowed its column — would have gone unnoticed on a desktop-only run.
     *
     * Kept to the specs that render a form or the builder rather than the whole suite: the
     * builder flows are long, and running them twice buys layout coverage the second time
     * at several minutes' cost.
     */
    {
      name: 'narrow',
      /**
       * A narrow viewport, not a device emulation.
       *
       * `devices['Pixel 7']` sets `isMobile`, and under that emulation Playwright's hit test
       * disagrees with the DOM: it reports the form panel intercepting a Save button the
       * page places 49px below it, and `elementFromPoint` at every point on that button
       * returns the button. The same 412x915 viewport *without* `isMobile` clicks fine, and
       * a forced click under emulation succeeds — so the layout is sound and the artefact is
       * in the emulated coordinate space.
       *
       * The point here was the CSS anyway: `styles.css` collapses the 12-column grid to one
       * column under 640px, and nothing exercised that. A plain narrow viewport covers it
       * without importing an emulation quirk into the suite.
       */
      use: { viewport: { width: 412, height: 915 } },
      testMatch: [
        /accessibility\.spec\.ts/,
        /demo\.spec\.ts/,
        /markdown-field\.spec\.ts/,
        /record-presentation-modes\.spec\.ts/,
        /ui-ux-enhancements\.spec\.ts/,
      ],
    },
  ],
});
