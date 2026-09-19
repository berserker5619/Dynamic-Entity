import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import {
  buildTemplateSpec,
  lookupValuesToOptions,
  normalizeLookupValues,
  type EntityFormConfig,
  type ImportLookups,
} from '@dynamic-entity/core';
import {
  CLIENTS_CONFIG,
  CLIENT_TIER_LIST,
  EMPLOYEES_CONFIG,
  ORDERS_CONFIG,
  TEST_DATA_CONFIGS,
} from '../src/app/mock/sample-data';
import { EXTENSIONS_CONFIG } from '../src/app/mock/extensions-entity';
import { synthesiseCsv, synthesiseTypedRow } from '../../server/src/config-rows.fixtures';
import { workbookOf } from '../../server/src/workbook.fixtures';

/**
 * Every entity the demo offers, imported through a browser — both transports.
 *
 * **What this exists to catch.** `import-wizard.spec.ts` drives `clients` (three columns) and
 * `import-server.spec.ts` drives `visitNotes` (three columns). The picker offers **nine**
 * entities between `test_data.json` and the demo's own TypeScript configs, and the two the
 * suite drove were among the narrowest. `insuranceClaims` is thirty-five columns across four
 * nesting levels; `employees` carries a repeating `addresses` array that becomes nine numbered
 * columns; `extensions` carries a `file` field a sheet cannot hold and a field type the library
 * does not ship. None of them had ever been through the wizard.
 *
 * Nothing here is authored per entity. The template is downloaded from the running app, the
 * row is synthesised from the same columns by `config-rows.fixtures.ts` — the fixture the
 * server's own matrix uses — and an entity added to the demo tomorrow joins this loop by
 * existing. Each entity gets its own `test()` rather than one loop inside a single case, so a
 * failure names the config that broke instead of stopping the sweep at the first one.
 */

const STORE = '/api/imported';
const ROWS = 2;

/**
 * The picker's list, merged the way `LocalStore.ensureSeed` merges it.
 *
 * Built rather than listed: `clients` and `employees` exist in *both* `test_data.json` and
 * `sample-data.ts`, and the demo's TypeScript version wins. A hard-coded list of nine would be
 * a second statement of that merge, and the first thing to go stale.
 */
const CONFIGS: EntityFormConfig[] = (() => {
  const merged = new Map<string, EntityFormConfig>();
  for (const config of TEST_DATA_CONFIGS) merged.set(config.entity, config);
  for (const config of [CLIENTS_CONFIG, EMPLOYEES_CONFIG, ORDERS_CONFIG, EXTENSIONS_CONFIG]) {
    merged.set(config.entity, config);
  }
  return [...merged.values()];
})();

/**
 * Everything the demo offers now goes through the server too.
 *
 * This used to be `test_data.json` minus the four entities the app overrode: the server
 * refused those, because serving them from a second copy would have handed the browser one
 * schema and the server another. Both halves now read one set of JSON configs under
 * `src/app/mock/configs/`, so the refusal has nothing left to protect against and the server
 * leg covers the same nine entities the browser leg does — including `employees`, whose
 * repeating `addresses` array becomes numbered columns, and `extensions`, whose `file` field
 * a sheet cannot carry at all.
 */
const SERVED = CONFIGS;

/** The same list the app and `import-server.mjs` both resolve `clientTier` from. */
const LOOKUPS: ImportLookups = {
  clientTier: lookupValuesToOptions(normalizeLookupValues(CLIENT_TIER_LIST)),
};

/** A filled sheet for one config: the template's own headers, then `ROWS` valid rows. */
function sheetFor(config: EntityFormConfig): { csv: string; headers: string[] } {
  const spec = buildTemplateSpec(config, { lang: 'en' });
  return {
    headers: spec.columns.map(column => column.header),
    csv: synthesiseCsv(spec.columns, ROWS, {
      lang: 'en',
      lookups: LOOKUPS,
      entity: config.entity,
    }),
  };
}

async function openWizard(page: Page, entity: string, transport?: 'http'): Promise<void> {
  await page.addInitScript(() => {
    Object.keys(window.localStorage)
      .filter(key => key.startsWith('de_demo_'))
      .forEach(key => window.localStorage.removeItem(key));
  });
  await page.goto(transport ? `/?transport=${transport}` : '/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dynamic Entity Demo' })).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import records' })).toBeVisible();
  await page.locator('#entitySelect').selectOption(entity);
}

async function choose(page: Page, name: string, body: string | Buffer): Promise<void> {
  await page.locator('[data-testid="import-file"]').setInputFiles({
    name,
    mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/octet-stream',
    buffer: typeof body === 'string' ? Buffer.from(body, 'utf8') : body,
  });
}

/** Download whatever the template button produces, as bytes. */
async function downloadTemplate(page: Page): Promise<{ name: string; bytes: Buffer }> {
  const pending = page.waitForEvent('download');
  await page.locator('[data-testid="import-template-download"]').click();
  const file = await pending;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { name: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

async function commit(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="import-mapper"]')).toBeVisible();
  await page.locator('[data-testid="import-to-review"]').click();
  await page.locator('[data-testid="import-commit"]').click();
}

test.describe('every entity the demo offers, imported in the browser', () => {
  for (const config of CONFIGS) {
    test(`${config.entity} imports through the in-browser transport`, async ({ page }) => {
      await openWizard(page, config.entity);

      // The template the *running app* generates, not one this spec built. A template whose
      // own headers do not map is a template that fails on first use, and the only way to
      // know they map is to fill in the file the user was handed.
      const { headers, csv } = sheetFor(config);
      expect(headers.length).toBeGreaterThan(0);

      const template = await downloadTemplate(page);
      expect(template.name).toBe(`${config.entity}-template.csv`);
      // Headers only — a guidance row would come back as a failed row 2 on every re-import —
      // and the same headers this spec is about to write rows under.
      expect(template.bytes.toString('utf8').trim().split(/\r?\n/)).toEqual([
        csv.split('\r\n')[0],
      ]);

      await choose(page, `${config.entity}.csv`, csv);
      await commit(page);

      await expect(page.locator('[data-testid="import-succeeded"]')).toContainText(String(ROWS));
      // Nothing failed — a row that errored would be counted here and nowhere else.
      await expect(page.locator('[data-testid="import-failed"]')).toHaveCount(0);
      // And the host received them, which is the seam the wizard exists to feed.
      await expect(page.locator('[data-testid="demo-import-saved"]')).toContainText(String(ROWS));
    });
  }
});

test.describe('every entity the server serves, imported through it', () => {
  test.beforeEach(async ({ request }) => {
    // The server's store outlives a page, so each test starts from empty rather than from
    // whatever the last one wrote.
    await request.delete(STORE);
  });

  for (const config of SERVED) {
    test(`${config.entity} imports through the server transport`, async ({ page }) => {
      await openWizard(page, config.entity, 'http');

      const { csv } = sheetFor(config);
      await choose(page, `${config.entity}.csv`, csv);
      await commit(page);

      await expect(page.locator('[data-testid="import-succeeded"]')).toContainText(String(ROWS));
      await expect(page.locator('[data-testid="import-failed"]')).toHaveCount(0);

      // What the server actually stored, which is the only answer the wizard cannot fake.
      const response = await page.request.get(`${STORE}/${config.entity}`);
      expect(response.ok()).toBe(true);
      expect(await response.json()).toHaveLength(ROWS);
    });
  }
});

/**
 * The `file` field on `extensions`, seen by a user rather than counted in a unit test.
 *
 * A field a sheet cannot carry is reported, never quietly dropped: an attachment column
 * missing from a generated template looks identical to one nobody thought to include, and the
 * user finds out when the import they believed was complete turns out not to be.
 */
test('a field a spreadsheet cannot carry is named on the template screen', async ({ page }) => {
  await openWizard(page, EXTENSIONS_CONFIG.entity);
  await expect(page.locator('[data-testid="import-template-unsupported"]')).toBeVisible();

  // And an entity with nothing to report says nothing, so the notice means something.
  await page.locator('#entitySelect').selectOption('organizations');
  await expect(page.locator('[data-testid="import-template-unsupported"]')).toHaveCount(0);
});

/**
 * The second direction of the feature, reachable by a person for the first time.
 *
 * Both halves ship — map columns onto fields, and pick fields to generate a file — but xlsx
 * generation only works through a server transport, and until `import-page.component.ts` grew
 * a format control the demo never set `templateFormat`. So `write-template.ts` was written,
 * unit-tested, and unreachable by anyone browsing the demo.
 */
test.describe('an xlsx template', () => {
  test('is written by the server, filled in, and imported back', async ({ page, request }) => {
    await request.delete(STORE);
    const config = TEST_DATA_CONFIGS.find(candidate => candidate.entity === 'visitNotes')!;

    await openWizard(page, config.entity, 'http');
    await page.locator('[data-testid="demo-template-format"]').selectOption('xlsx');

    const template = await downloadTemplate(page);
    expect(template.name).toBe('visitNotes-template.xlsx');
    // A real workbook, not a CSV under an .xlsx name: every xlsx is a zip, and every zip
    // starts `PK`. That distinction is the whole reason the local transport refuses.
    expect(template.bytes.subarray(0, 2).toString('latin1')).toBe('PK');

    // Opened the way Excel would open it. A file the writer produced that the reader cannot
    // read is the failure a byte-signature check would miss entirely.
    const spec = buildTemplateSpec(config, { lang: 'en' });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(template.bytes as unknown as ArrayBuffer);
    const headerRow = book.worksheets[0].getRow(1);
    const headers = spec.columns.map((_, index) => String(headerRow.getCell(index + 1).value ?? ''));
    expect(headers).toEqual(spec.columns.map(column => column.header));

    // Filled in and uploaded, which is the whole round trip: the server wrote it, a
    // spreadsheet program's job is done here, and the server reads it back. The rows are
    // **typed** — a workbook holds a `Date` in a date cell, not text — so this is also the
    // only path in the demo suite that reaches `coerceTypedCell`.
    const filled = await workbookOf(
      headers,
      Array.from({ length: ROWS }, () =>
        synthesiseTypedRow(spec.columns, { lang: 'en', lookups: LOOKUPS, entity: config.entity }),
      ),
    );

    await choose(page, 'filled.xlsx', filled);
    await commit(page);
    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText(String(ROWS));

    const stored = await (await page.request.get(`${STORE}/${config.entity}`)).json();
    expect(stored).toHaveLength(ROWS);
    // The day the template said, not the day a local render of it would say.
    expect(stored[0].visitSummaryTab.visitDate).toBe('2024-03-07');
  });

  test('is refused by name in a build that can only write CSV', async ({ page }) => {
    // The designed refusal, and the reason it is a feature: a file named `.xlsx` that is
    // really a CSV is worse than no file at all, because the user finds out in Excel.
    await openWizard(page, 'visitNotes');
    await page.locator('[data-testid="demo-template-format"]').selectOption('xlsx');
    await page.locator('[data-testid="import-template-download"]').click();

    await expect(page.locator('[data-testid="import-problem"]')).toContainText(
      /can only write CSV templates/i,
    );
  });
});
