import { expect, test, type Page } from '@playwright/test';

/**
 * The import wizard driven through a real server, in a real browser.
 *
 * `@dynamic-entity/server` is unit-tested against streams, and `verify-server-consumer.mjs`
 * drives its four routes against a listener — but neither of those is a browser, and the claim
 * the whole package rests on is about a *user's* import producing the same records whichever
 * side does the work. That needs the wizard, a network and a server at once, which is this.
 *
 * `?transport=http` switches the demo onto `provideHttpImportTransport`; the dev server proxies
 * `/api/import` to `import-server.mjs`, so the browser sees one origin. The default stays the
 * in-browser transport — `import-wizard.spec.ts` covers that, and registering both by default
 * would prove neither is the default.
 *
 * **`visitNotes` is the entity on purpose.** It carries a required *date*, which is the field
 * type this feature nearly shipped broken: a spreadsheet stores a date at UTC midnight, and
 * anything that stringifies it renders local time and moves the day for every user west of
 * Greenwich. A parity assertion that avoided dates would avoid the interesting half.
 */

const STORE = '/api/imported';

/** The template headers for `visitNotes`, which is what a mapped sheet must be headed with. */
const HEADERS = [
  'Visit Summary / Patient Name',
  'Visit Summary / Visit Date',
  'Visit Summary / Clinical Diagnosis & Notes',
].join(',');

const SHEET =
  `${HEADERS}\r\n` +
  'Ada Lovelace,2024-03-07,Routine review\r\n' +
  'Grace Hopper,2024-01-01,"Follow-up, six weeks"\r\n';

/** Open the wizard with the server transport registered. */
async function openServerWizard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.keys(window.localStorage)
      .filter(key => key.startsWith('de_demo_'))
      .forEach(key => window.localStorage.removeItem(key));
  });
  await page.goto('/?transport=http');
  await expect(page.getByRole('heading', { level: 1, name: 'Dynamic Entity Demo' })).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import records' })).toBeVisible();
}

/** The demo's entity picker, so the wizard is pointed at `visitNotes`. */
async function chooseEntity(page: Page, entity: string): Promise<void> {
  await page.locator('#entitySelect').selectOption(entity);
}

async function choose(page: Page, name: string, body: string | Buffer): Promise<void> {
  await page.locator('[data-testid="import-file"]').setInputFiles({
    name,
    mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/octet-stream',
    buffer: typeof body === 'string' ? Buffer.from(body, 'utf8') : body,
  });
}

/** What the server actually stored, which is the only answer the wizard cannot fake. */
async function stored(page: Page, entity: string): Promise<Record<string, unknown>[]> {
  const response = await page.request.get(`${STORE}/${entity}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

test.beforeEach(async ({ request }) => {
  // The server's store outlives a page, so each test starts from empty rather than from
  // whatever the last one wrote.
  await request.delete(STORE);
});

test.describe('an import that happens on a server', () => {
  test('uploads, maps and imports, and the records land on the server', async ({ page }) => {
    await openServerWizard(page);
    await chooseEntity(page, 'visitNotes');
    await choose(page, 'visits.csv', SHEET);

    await expect(page.locator('[data-testid="import-mapper"]')).toBeVisible();
    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();

    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText('2');

    const records = await stored(page, 'visitNotes');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      visitSummaryTab: { patientName: 'Ada Lovelace', visitDate: '2024-03-07' },
    });
  });

  test('reports the count rather than the records, which is the point of streaming', async ({ page }) => {
    // The server streamed the file precisely so that the records never had to exist at once,
    // so `records` comes back empty and `imported` carries the number. A wizard reading
    // `records.length` would announce a successful import of nothing.
    await openServerWizard(page);
    await chooseEntity(page, 'visitNotes');
    await choose(page, 'visits.csv', SHEET);
    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();

    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText('2');
    // The demo host saves `result.records`, which is empty here — so it reports nothing saved
    // locally while the server holds two. That difference is the feature, not a bug.
    expect(await stored(page, 'visitNotes')).toHaveLength(2);
  });

  test('a date survives the round trip as the day it says', async ({ page }) => {
    // The defect this feature nearly shipped with. The browser sends text, the server coerces
    // it, and a calendar date must never round-trip through an instant on either side.
    await openServerWizard(page);
    await chooseEntity(page, 'visitNotes');
    await choose(page, 'dates.csv', `${HEADERS}\r\nEdge Case,2024-01-01,New year\r\n`);
    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();
    await expect(page.locator('[data-testid="import-succeeded"]')).toBeVisible();

    const records = await stored(page, 'visitNotes');
    expect((records[0] as { visitSummaryTab: { visitDate: string } }).visitSummaryTab.visitDate).toBe(
      '2024-01-01',
    );
  });

  test('surfaces a row the server rejected, with the server count', async ({ page }) => {
    // `patientName` and `visitDate` are both required. The middle row has neither.
    await openServerWizard(page);
    await chooseEntity(page, 'visitNotes');
    await choose(
      page,
      'bad.csv',
      `${HEADERS}\r\nAda Lovelace,2024-03-07,ok\r\n,,missing both\r\nGrace Hopper,2024-01-01,ok\r\n`,
    );
    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();

    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText('2');
    await expect(page.locator('[data-testid="import-failed"]')).toContainText('1');
    await expect(page.locator('[data-testid="import-errors"]')).toBeVisible();

    expect(await stored(page, 'visitNotes')).toHaveLength(2);
  });

  test('shows the server\'s refusal when the file is not one it reads', async ({ page }) => {
    // Format is decided by the first bytes, not by the name — so a file called .csv that is
    // really a pre-2007 workbook is named as such rather than parsed into nonsense.
    await openServerWizard(page);
    await chooseEntity(page, 'visitNotes');
    await choose(page, 'old.csv', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]));

    await expect(page.locator('[data-testid="import-problem"]')).toContainText(/\.xls/);
    // And it stays on the upload step rather than advancing into an empty mapper.
    await expect(page.locator('[data-testid="import-mapper"]')).toHaveCount(0);
  });

  test('404s an entity the server does not serve, in language a user can act on', async ({ page }) => {
    // `clients` is overridden by the demo app, so the server deliberately does not serve it.
    // Refusing clearly beats importing against a config the user never saw.
    await openServerWizard(page);
    await chooseEntity(page, 'clients');
    await choose(page, 'anything.csv', 'Name\r\nAda\r\n');

    await expect(page.locator('[data-testid="import-problem"]')).toBeVisible();
    await expect(page.locator('[data-testid="import-mapper"]')).toHaveCount(0);
  });

  test('downloads a template from the server, and that template imports', async ({ page }) => {
    await openServerWizard(page);
    await chooseEntity(page, 'visitNotes');

    const download = page.waitForEvent('download');
    await page.locator('[data-testid="import-template-download"]').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('visitNotes-template.csv');

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8').trim();

    // Headers only — a guidance row would come back as a failed row 2 on every re-import.
    expect(csv.split(/\r?\n/)).toHaveLength(1);

    await choose(page, 'filled.csv', `${csv}\r\nAda Lovelace,2024-03-07,From the template\r\n`);
    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();
    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText('1');
    expect(await stored(page, 'visitNotes')).toHaveLength(1);
  });
});

test.describe('client and server produce the same records', () => {
  /**
   * The claim the whole package rests on, asserted end to end rather than in a unit test.
   *
   * The same file goes through the in-browser transport and through the server. One set of
   * records is built in the tab and saved to the demo's local store; the other is built on a
   * different machine by the same pure functions and held by the server. They must be equal —
   * and a date is in there precisely because that is where the two could most plausibly drift.
   */
  test('the same sheet imported each way yields identical records', async ({ page, request }) => {
    await request.delete(STORE);

    // The server's copy.
    await openServerWizard(page);
    await chooseEntity(page, 'visitNotes');
    await choose(page, 'visits.csv', SHEET);
    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();
    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText('2');
    const fromServer = await stored(page, 'visitNotes');

    // The browser's copy, through the default transport on a clean page.
    await page.addInitScript(() => {
      Object.keys(window.localStorage)
        .filter(key => key.startsWith('de_demo_'))
        .forEach(key => window.localStorage.removeItem(key));
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await chooseEntity(page, 'visitNotes');

    // The demo seeds visitNotes with sample records, so the imported ones are the difference
    // rather than the whole store. Comparing the store outright would compare the seed.
    const readStore = () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('de_demo_records_visitNotes');
        return raw ? (JSON.parse(raw) as Record<string, unknown>[]) : [];
      });
    const before = new Set((await readStore()).map(record => JSON.stringify(record)));

    await choose(page, 'visits.csv', SHEET);
    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();
    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText('2');

    const fromBrowser = (await readStore()).filter(
      record => !before.has(JSON.stringify(record)),
    );

    expect(fromBrowser).toHaveLength(2);
    expect(fromServer).toHaveLength(2);

    /**
     * Compared by what the *import* produced, not by what each host did with it.
     *
     * The demo's local store stamps an `_id` on save and the server's Map does not, and the two
     * hosts append in different orders — neither of which the import decided. `_configVersion`
     * stays in: both sides stamp it, so it is part of what parity means.
     */
    const shape = (records: Record<string, unknown>[]) =>
      records
        .map(record => {
          const copy = { ...record } as Record<string, unknown>;
          delete copy['_id'];
          return copy;
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    expect(shape(fromServer)).toEqual(shape(fromBrowser));
    // And the thing most likely to drift between two machines is in there.
    expect(JSON.stringify(shape(fromServer))).toContain('2024-03-07');
  });
});
