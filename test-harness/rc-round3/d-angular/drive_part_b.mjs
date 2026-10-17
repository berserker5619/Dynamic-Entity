import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = 'http://localhost:4200';
// Screenshots land in the repository's docs/rc-screens/round3 unless R3_SCREENS says otherwise.
const SCREENS_DIR = process.env.R3_SCREENS ?? path.resolve(HERE, '../../../docs/rc-screens/round3');
const TEST_DATA_DIR = process.env.R3_TEST_DATA ?? path.join(HERE, 'test-data');

fs.mkdirSync(SCREENS_DIR, { recursive: true });

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {
      // retry
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Server at ${url} did not respond within ${timeoutMs}ms`);
}

async function run() {
  console.log('Checking server and app availability...');
  await waitForServer('http://localhost:4321/api/import/customers/template?format=csv', 30000);
  console.log('Backend server is ready.');
  await waitForServer(APP_URL, 60000);
  // Playwright's own Chromium (`npx playwright install chromium`), or PW_CHROMIUM to use another.
  const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log('\nNavigating to', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'networkidle' });

  // -------------------------------------------------------------
  // FLOW 1: Local Import Transport (In-Browser)
  // -------------------------------------------------------------
  console.log('\n--- Running Flow 1: Local Import Transport ---');
  await page.click('[data-testid="tab-local"]');
  await page.waitForSelector('[data-testid="mode-local-section"]');
  
  // 01: Upload screen
  await page.screenshot({ path: path.join(SCREENS_DIR, '01-local-upload.png') });
  console.log('Captured 01-local-upload.png');

  // Upload customers.csv
  const fileInput = await page.waitForSelector('[data-testid="mode-local-section"] [data-testid="import-file"]');
  await fileInput.setInputFiles(path.join(TEST_DATA_DIR, 'customers.csv'));

  // 02: Mapping screen
  await page.waitForSelector('[data-testid="mode-local-section"] [data-testid="import-to-review"]');
  await page.screenshot({ path: path.join(SCREENS_DIR, '02-local-map.png') });
  console.log('Captured 02-local-map.png');

  // Go to review
  await page.click('[data-testid="mode-local-section"] [data-testid="import-to-review"]');

  // 03: Review screen
  await page.waitForSelector('[data-testid="mode-local-section"] [data-testid="import-commit"]');
  await page.screenshot({ path: path.join(SCREENS_DIR, '03-local-review.png') });
  console.log('Captured 03-local-review.png');

  // Commit
  await page.click('[data-testid="mode-local-section"] [data-testid="import-commit"]');

  // 04: Commit success
  await page.waitForSelector('[data-testid="mode-local-section"] [data-testid="import-succeeded"]');
  await page.screenshot({ path: path.join(SCREENS_DIR, '04-local-commit-success.png') });
  console.log('Captured 04-local-commit-success.png');

  // -------------------------------------------------------------
  // FLOW 2: HTTP Import Transport against @dynamic-entity/server@next
  // -------------------------------------------------------------
  console.log('\n--- Running Flow 2: HTTP Import Transport ---');
  await page.click('[data-testid="tab-http"]');
  await page.waitForSelector('[data-testid="mode-http-section"]');

  // 05: HTTP Upload screen
  await page.screenshot({ path: path.join(SCREENS_DIR, '05-http-upload.png') });
  console.log('Captured 05-http-upload.png');

  // Upload customers.csv
  const httpFileInput = await page.waitForSelector('[data-testid="mode-http-section"] [data-testid="import-file"]');
  await httpFileInput.setInputFiles(path.join(TEST_DATA_DIR, 'customers.csv'));

  // 06: HTTP Mapping screen
  await page.waitForSelector('[data-testid="mode-http-section"] [data-testid="import-to-review"]');
  await page.screenshot({ path: path.join(SCREENS_DIR, '06-http-map.png') });
  console.log('Captured 06-http-map.png');

  // Go to review
  await page.click('[data-testid="mode-http-section"] [data-testid="import-to-review"]');

  // 07: HTTP Review screen
  await page.waitForSelector('[data-testid="mode-http-section"] [data-testid="import-commit"]');
  await page.screenshot({ path: path.join(SCREENS_DIR, '07-http-review.png') });
  console.log('Captured 07-http-review.png');

  // Commit
  await page.click('[data-testid="mode-http-section"] [data-testid="import-commit"]');

  // 08: HTTP Commit success
  await page.waitForSelector('[data-testid="mode-http-section"] [data-testid="import-succeeded"]');
  await page.screenshot({ path: path.join(SCREENS_DIR, '08-http-commit-success.png') });
  console.log('Captured 08-http-commit-success.png');

  // -------------------------------------------------------------
  // FLOW 3: Date-Order Mismatch between wizard and server
  // -------------------------------------------------------------
  console.log('\n--- Running Flow 3: Date-Order Mismatch ---');
  await page.click('[data-testid="tab-mismatch"]');
  await page.waitForSelector('[data-testid="mode-mismatch-section"]');

  const mismatchFileInput = await page.waitForSelector('[data-testid="mode-mismatch-section"] [data-testid="import-file"]');
  await mismatchFileInput.setInputFiles(path.join(TEST_DATA_DIR, 'employees_ambiguous_date.csv'));

  await page.waitForSelector('[data-testid="mode-mismatch-section"] [data-testid="import-to-review"]');
  await page.click('[data-testid="mode-mismatch-section"] [data-testid="import-to-review"]');

  // Wait for mismatch alert banner
  await page.waitForSelector('[data-testid="mode-mismatch-section"] [data-testid="import-date-order-mismatch"]');
  await page.screenshot({ path: path.join(SCREENS_DIR, '09-date-order-mismatch.png') });
  console.log('Captured 09-date-order-mismatch.png');

  // -------------------------------------------------------------
  // FLOW 4: Stored 2.5 Plan Reopened
  // -------------------------------------------------------------
  console.log('\n--- Running Flow 4: Stored 2.5 Plan Reopened ---');
  await page.click('[data-testid="tab-stored-plan"]');
  await page.waitForSelector('[data-testid="mode-stored-plan-section"]');

  const planFileInput = await page.waitForSelector('[data-testid="mode-stored-plan-section"] [data-testid="import-file"]');
  await planFileInput.setInputFiles(path.join(TEST_DATA_DIR, 'customers.csv'));

  // Pre-mapped from 2.5 plan
  await page.waitForSelector('[data-testid="mode-stored-plan-section"] [data-testid="import-to-review"]');
  await page.screenshot({ path: path.join(SCREENS_DIR, '10-stored-25-plan-reopened.png') });
  console.log('Captured 10-stored-25-plan-reopened.png');

  // Review & Commit
  await page.click('[data-testid="mode-stored-plan-section"] [data-testid="import-to-review"]');
  await page.waitForSelector('[data-testid="mode-stored-plan-section"] [data-testid="import-commit"]');
  await page.click('[data-testid="mode-stored-plan-section"] [data-testid="import-commit"]');

  await page.waitForSelector('[data-testid="mode-stored-plan-section"] [data-testid="import-succeeded"]');
  await page.screenshot({ path: path.join(SCREENS_DIR, '11-stored-25-plan-imported.png') });
  console.log('Captured 11-stored-25-plan-imported.png');

  await browser.close();
  console.log('\nAll E2E flows finished successfully!');
}

run().catch((err) => {
  console.error('E2E run failed:', err);
  process.exit(1);
});
