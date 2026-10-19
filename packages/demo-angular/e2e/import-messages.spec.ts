/**
 * What the import wizard says about each failure 3.1 names (docs/3.1-spec.md, C2), in the demo,
 * with a screenshot of each. `SCREENSHOTS=1` writes them to docs/3.1-screens; otherwise they go
 * with the rest of the run's output.
 *
 * As real as the demo allows:
 * - File refusals run the built-in parser, or `ngx-dynamic-entity/xlsx` (?parser=xlsx).
 * - `UNSUPPORTED_RUNTIME` gets a `DecompressionStream` that refuses `deflate-raw`, as Chrome and
 *   Edge 80–102 do.
 * - `PEER_MISSING` has the ExcelJS module answered with Vite's stub for a package that is not
 *   installed, verbatim, which is what `ng serve` serves without `exceljs`.
 * - The capability refusal is import-server.mjs, which does not group.
 * - Group failures in the browser are LocalImportTransport over ?plan=grouped
 *   (mock/grouping-transport.ts).
 * - A grouping server's answers are fulfilled here: the demo's server is the default one. The
 *   real preview is fetched and only its `features` and the import's answer are replaced.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { deriveImportColumns, type EntityFormConfig } from '@dynamic-entity/core';

const ROOT = join(__dirname, '../../..');
const CONFIG = (JSON.parse(readFileSync(join(ROOT, 'test_data.json'), 'utf8')) as EntityFormConfig[]).find(c => c.entity === 'complexFullTest')!;
const WORKBOOK = readFileSync(join(ROOT, 'packages/core/test-fixtures/case5_non_latin.xlsx'));
const VITE_STUB = 'var e={};throw Error(`Could not resolve "exceljs" imported by "sheet-to-schema". Is it installed?`);export{e as default};';

/** The columns a grouped complexFullTest sheet carries: its required fields, one contact per row. */
const COLUMNS = (() => {
  const { columns } = deriveImportColumns(CONFIG, { lang: 'en', maxArrayRows: 1 });
  const wanted = ['generalTab.fullName', 'generalTab.emailAddress', 'datesAndFilesTab.joinDate', 'nestedStructuresTab.addressGroup.street', 'nestedStructuresTab.emergencyContacts.0.contactName'];
  return wanted.map(ref => columns.find(column => column.ref === ref)!.header);
})();
const csvCell = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
/** One row per contact, keyed by full name. */
const sheet = (names: string[]): Buffer =>
  Buffer.from([COLUMNS, ...names.map((name, i) => [name, 'ada@example.com', '2024-03-07', 'Main St', `Contact ${i}`])].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');

async function openWizard(page: Page, query = ''): Promise<void> {
  await page.addInitScript(() => {
    Object.keys(window.localStorage)
      .filter(key => key.startsWith('de_demo_'))
      .forEach(key => window.localStorage.removeItem(key));
  });
  await page.goto(`/${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Dynamic Entity Demo' })).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import records' })).toBeVisible();
  await page.locator('#entitySelect').selectOption(CONFIG.entity);
}
const choose = (page: Page, name: string, buffer: Buffer) =>
  page.locator('[data-testid="import-file"]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
async function commit(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="import-mapper"]')).toBeVisible();
  await page.locator('[data-testid="import-to-review"]').click();
  await page.locator('[data-testid="import-commit"]').click();
}
/** The problem says `text`, and a picture of the wizard saying it is kept. */
async function says(page: Page, testInfo: TestInfo, name: string, text: RegExp): Promise<void> {
  const problem = page.locator('[data-testid="import-problem"]');
  await expect(problem).toContainText(text);
  const path = process.env['SCREENSHOTS'] ? join(ROOT, 'docs/3.1-screens', `${name}.png`) : testInfo.outputPath(`${name}.png`);
  await page.locator('ngx-entity-import').screenshot({ path });
}

test.describe('a file the browser cannot read', () => {
  test('a workbook, where the app reads CSV only', async ({ page }, testInfo) => {
    await openWizard(page);
    await expect(page.locator('[data-testid="import-file"]')).toHaveAttribute('accept', '.csv,.tsv,.txt');
    await choose(page, 'book.xlsx', WORKBOOK);
    await says(page, testInfo, 'unsupported-format-xlsx-csv-only', /this import reads CSV files only\. Save it as CSV/);
  });

  test('a pre-2007 .xls', async ({ page }, testInfo) => {
    await openWizard(page, '?parser=xlsx');
    await choose(page, 'old.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    await says(page, testInfo, 'unsupported-format-xls', /Excel 97–2003 file \(\.xls\).*Save it as \.xlsx or CSV/);
  });

  test('a UTF-16 text file', async ({ page }, testInfo) => {
    await openWizard(page);
    await choose(page, 'wide.csv', Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]));
    await says(page, testInfo, 'unsupported-format-utf16', /UTF-16 text.*Save it as CSV UTF-8/);
  });

  test('a workbook, where the browser has no deflate-raw (UNSUPPORTED_RUNTIME)', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const Native = window.DecompressionStream;
      window.DecompressionStream = class extends Native {
        constructor(format: CompressionFormat) {
          if (format === ('deflate-raw' as CompressionFormat)) throw new TypeError("Unsupported compression format: 'deflate-raw'");
          super(format);
        }
      };
    });
    await openWizard(page, '?parser=xlsx');
    await expect(page.locator('[data-testid="import-file"]')).toHaveAttribute('accept', '.csv,.tsv,.txt,.xlsx');
    await choose(page, 'book.xlsx', WORKBOOK);
    await says(page, testInfo, 'unsupported-runtime', /This browser cannot read \.xlsx files\. Chrome or Edge 103, Firefox 113 and Safari 16\.4 can/);
  });

  test('a workbook, where exceljs is not installed (PEER_MISSING)', async ({ page }, testInfo) => {
    // The one module that is ExcelJS, answered as `ng serve` answers it without the package.
    await page.route('**/*', async route => {
      if (route.request().resourceType() !== 'script') return route.continue();
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes('Worksheet name already exists')) return route.fulfill({ response, body });
      return route.fulfill({ response, body: VITE_STUB });
    });
    await openWizard(page, '?parser=xlsx');
    await choose(page, 'book.xlsx', WORKBOOK);
    await says(page, testInfo, 'peer-missing', /the exceljs package it needs is not installed/);
  });
});

test.describe('a grouped plan, and a server that does not group', () => {
  test('is refused before upload by the default server (the capability refusal)', async ({ page }, testInfo) => {
    const uploads: string[] = [];
    page.on('request', request => request.url().endsWith('/import') && uploads.push(request.url()));
    await openWizard(page, '?transport=http&plan=grouped');
    await choose(page, 'people.csv', sheet(['Ada', 'Ada', 'Bo']));
    await commit(page);
    await says(page, testInfo, 'capability-refusal', /the import server does not do that\. Nothing was imported/);
    expect(uploads).toEqual([]);
  });
});

/** The server, as one with grouping on answers: its preview lists "group", its import answers `status` and `error`. */
async function groupingServer(page: Page, status: number, error: Record<string, unknown>): Promise<void> {
  await page.route('**/api/import/*/preview', async route => {
    const response = await route.fetch();
    return route.fulfill({ response, json: { ...(await response.json()), features: ['group'] } });
  });
  await page.route('**/api/import/*/import', route => route.fulfill({ status, json: { error } }));
}

test.describe("a grouping server's refusals and failures", () => {
  for (const [reason, name, text] of [
    ['grouping-disabled', 'plan-group-grouping-disabled', /the import server does not do that/],
    ['non-contiguous', 'plan-group-non-contiguous', /can only gather rows that are next to each other.*Sort the sheet by the key columns/],
  ] as const) {
    test(`PLAN_GROUP with reason ${reason}`, async ({ page }, testInfo) => {
      await groupingServer(page, 400, { code: 'INVALID_PLAN', message: 'server words', details: [{ level: 'error', code: 'PLAN_GROUP', path: 'group', message: 'server words', reason }] });
      await openWizard(page, '?transport=http&plan=grouped');
      await choose(page, 'people.csv', sheet(['Ada', 'Ada']));
      await commit(page);
      await says(page, testInfo, name, text);
    });
  }

  for (const [status, code, details, text] of [
    [422, 'GROUP_NOT_CONTIGUOUS', { key: ['Ada'], rows: [3, 4] }, /The rows for Ada are not together: they end at row 3 and start again at row 4/],
    [413, 'GROUP_TOO_LARGE', { key: ['Ada'], rows: [2, 10002] }, /The record Ada has more rows than one record may: it starts at row 2 and reaches row 10002/],
    [413, 'TOO_MANY_GROUPS', { key: ['p'], rows: [200002] }, /more records than one import may, from row 200002/],
  ] as const) {
    test(`${code} from the server`, async ({ page }, testInfo) => {
      await groupingServer(page, status, { code, message: 'server words', details });
      await openWizard(page, '?transport=http&plan=grouped');
      await choose(page, 'people.csv', sheet(['Ada', 'Ada', 'Bo', 'Ada']));
      await commit(page);
      await says(page, testInfo, `server-${code.toLowerCase().replace(/_/g, '-')}`, text);
    });
  }
});

test.describe('a grouped plan in the browser, through LocalImportTransport', () => {
  test('GROUP_NOT_CONTIGUOUS', async ({ page }, testInfo) => {
    await openWizard(page, '?plan=grouped');
    await choose(page, 'people.csv', sheet(['Ada', 'Ada', 'Bo', 'Ada']));
    await commit(page);
    await says(page, testInfo, 'local-group-not-contiguous', /The rows for Ada are not together: they end at row 3 and start again at row 5/);
  });

  test('GROUP_TOO_LARGE', async ({ page }, testInfo) => {
    await openWizard(page, '?plan=grouped');
    await choose(page, 'people.csv', sheet(Array.from({ length: 10_001 }, () => 'Ada')));
    await commit(page);
    await says(page, testInfo, 'local-group-too-large', /The record Ada has more rows than one record may: it starts at row 2 and reaches row 10002/);
  });

  test('TOO_MANY_GROUPS (8 MiB of keys)', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    // Past 200,000 groups is past the browser's 200,000-row limit; 8 MiB of keys is not.
    const pad = 'k'.repeat(474);
    await openWizard(page, '?plan=grouped');
    await choose(page, 'people.csv', sheet(Array.from({ length: 17_600 }, (_, i) => `${pad}${String(i).padStart(6, '0')}`)));
    await commit(page);
    await says(page, testInfo, 'local-too-many-groups', /more records than one import may, from row \d+/);
  });
});
