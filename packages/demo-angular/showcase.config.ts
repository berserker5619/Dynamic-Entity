import { defineConfig, devices } from '@playwright/test';

/**
 * Recording config — deliberately separate from `playwright.config.ts`.
 *
 * These are not tests. They drive the real demo through a workflow at a pace a person can
 * follow, and keep the video. The assertions in them exist to make the run fail loudly if
 * the app changes underneath, rather than to prove anything: a recording that silently
 * captures a broken flow is worse than one that does not run.
 *
 * `testDir` keeps them out of the CI suite, which runs `./e2e`.
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const PORT = Number(env['PLAYWRIGHT_PORT'] ?? 4200);
const BASE_URL = env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './showcase',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: 'list',
  outputDir: './showcase-output',
  use: {
    baseURL: BASE_URL,
    // 900p rather than 720p, and 16:9. The builder is a three-column layout with a preview
    // underneath: at 720 the toolbar and palette sat outside the frame and Playwright's
    // auto-scroll made the view jump between them. Recording taller keeps the whole app in
    // shot, and the viewer's player scales it down anyway.
    viewport: { width: 1600, height: 900 },
    video: { mode: 'on', size: { width: 1600, height: 900 } },
    // A light slowMo only. It applies per *keystroke* as well as per click, so anything
    // higher turns a few typed labels into minutes of footage — the first attempt ran 3.2
    // minutes and timed out. Pacing belongs in explicit pauses between steps, not here.
    launchOptions: { slowMo: 120 },
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
      // The viewport is re-stated after the device spread on purpose: project-level `use`
      // wins over the top-level one, and `devices['Desktop Chrome']` carries its own
      // 1280x720 — which silently overrode the size set above.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
  ],
});
