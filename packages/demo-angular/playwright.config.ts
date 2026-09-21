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

/** Where import-server.mjs listens. proxy.conf.json points /api here, so the two must agree. */
const IMPORT_PORT = Number(env['IMPORT_PORT'] ?? 4300);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!env['CI'],
  retries: env['CI'] ? 1 : 0,
  workers: Number(env['PLAYWRIGHT_WORKERS'] ?? 1),
  reporter: env['CI'] ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'on',
  },
  /**
   * Two servers, because half this suite is about a backend.
   *
   * The Angular dev server proxies /api to the import server (proxy.conf.json), so the browser
   * only ever sees one origin — the same shape a real deployment has, and the reason no CORS
   * header appears anywhere in this demo. import-server.mjs answers nothing on / , so its
   * readiness is checked on a route it actually serves.
   */
  webServer: [
    {
      command: `node import-server.mjs`,
      url: `http://localhost:${IMPORT_PORT}/api/imported/visitNotes`,
      env: { IMPORT_PORT: String(IMPORT_PORT) },
      reuseExistingServer: !env['CI'],
      timeout: 60 * 1000,
    },
    /**
     * `--live-reload false` is load-bearing, not tidiness.
     *
     * The dev server reloads the browser whenever it rebuilds, and a reload part-way through
     * a test detaches whatever the test was about to click. That surfaced as
     * `form-builder-employees.spec.ts` failing on "element was detached from the DOM …
     * waiting for navigation to finish" — a builder flow that passes on its own in 1.1
     * minutes and took 5.6 under the full suite, which is what a rebuild storm looks like
     * from inside a test. Nothing here edits application source, so a reload during a run is
     * never something the suite wanted.
     */
    {
      command: `npx ng serve --port ${PORT} --live-reload false`,
      url: BASE_URL,
      reuseExistingServer: !env['CI'],
      timeout: 120 * 1000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /*
     * A second engine, opt-in: `PLAYWRIGHT_ALL_BROWSERS=1 npx playwright test`.
     *
     * Off by default because CI installs chromium alone (see e2e.yml) and a project it cannot
     * launch fails the run. It is worth reaching for when a change is mostly CSS — the builder
     * layout is grid, sticky and custom-property arithmetic, and those are where engines
     * disagree. The sidebar specs were last run green on Firefox this way.
     *
     * WebKit has no entry at all: it will not launch on a Windows host (missing system
     * libraries), so adding one would only produce failures nobody can act on locally.
     */
    ...(env['PLAYWRIGHT_ALL_BROWSERS']
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
            testMatch: [
              /builder-sidebar-collapse.spec.ts/,
              /contrast-aa.spec.ts/,
              /ui-ux-enhancements.spec.ts/,
            ],
          },
        ]
      : []),
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
        // German is roughly a third longer than English, and the grid collapses to one
        // column here — which is where a translated button first overflows its own row.
        /ui-text-i18n-widgets\.spec\.ts/,
        /ui-ux-enhancements\.spec\.ts/,
      ],
    },
  ],
});
