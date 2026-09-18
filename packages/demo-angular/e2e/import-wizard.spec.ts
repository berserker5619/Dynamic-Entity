import { expect, test, type Page } from '@playwright/test';
import { gotoDemo } from './test-helpers';

/**
 * The import wizard, driven end to end in a browser.
 *
 * **This suite existed as a claim before it existed as a file.** `check-demo-coverage`'s
 * allowlist said the in-browser transport was "the one worth proving end to end", the demo
 * hosted the wizard, and nothing ever drove it — so the gate that exists to catch "documented
 * but not exercised" was itself reporting a covered point that no browser had ever opened.
 *
 * What it covers is the path a consumer gets with nothing registered: the file is read in the
 * tab, mapped by `@dynamic-entity/core`, and the records come back to the host. Every step of
 * the wizard is a place a user can be shown something wrong, so every step is asserted rather
 * than clicked through.
 */

/** Put the demo on the import screen with an entity selected. */
async function openWizard(page: Page): Promise<void> {
  await gotoDemo(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import records' })).toBeVisible();
}

/**
 * Hand the file input a file, the way the browser would.
 *
 * `setInputFiles` with a buffer rather than a fixture on disk: the sheet under test is three
 * lines, and a file in the repository is a file that drifts from the assertions about it.
 */
async function choose(page: Page, name: string, body: string): Promise<void> {
  await page.locator('[data-testid="import-file"]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(body, 'utf8'),
  });
}

/**
 * The demo's `clients` entity offers Name, Email, Company, Status, Tier, Salary, Notes, and
 * only Name is required. Two of them is enough to exercise the wizard, and a short row is
 * padded rather than dropped — which is itself the behaviour being relied on here.
 */
const HEADERS = 'Name,Email';

test.describe('the import wizard, with no backend at all', () => {
  test('reads a file, shows the mapping it inferred, and imports it', async ({ page }) => {
    await openWizard(page);
    await choose(page, 'clients.csv', `${HEADERS}\r\nAda Lovelace,ada@example.com\r\n`);

    // The mapping screen, reached without anything being registered — the built-in CSV parser
    // and the in-browser transport are what got us here.
    const mapper = page.locator('[data-testid="import-mapper"]');
    await expect(mapper).toBeVisible();

    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();

    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText('1');
    // And the host received the records, which is the seam the wizard exists to feed.
    await expect(page.locator('[data-testid="demo-import-saved"]')).toContainText('1');
  });

  test('counts a blank row as skipped rather than as a failure', async ({ page }) => {
    // A blank line in the middle of a sheet is not an error and must not be reported as one —
    // but a user who expected three records and got two deserves to see where the third went.
    await openWizard(page);
    await choose(
      page,
      'gappy.csv',
      `${HEADERS}\r\nAda Lovelace,ada@example.com\r\n\r\nGrace Hopper,grace@example.com\r\n`,
    );

    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();

    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText('2');
    await expect(page.locator('[data-testid="import-skipped"]')).toContainText('1');
  });

  test('shows what a row will become before anything is committed', async ({ page }) => {
    // The review step is the point of the wizard. The expensive mistake is not a file that
    // fails to import, it is one that imports cleanly into the wrong fields — invisible in a
    // summary, obvious in a rendered row.
    await openWizard(page);
    await choose(page, 'clients.csv', `${HEADERS}\r\nAda Lovelace,ada@example.com\r\n`);

    await page.locator('[data-testid="import-to-review"]').click();
    const preview = page.locator('[data-testid="import-preview"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Ada Lovelace');

    // Nothing has been written yet: the host says nothing until commit.
    await expect(page.locator('[data-testid="demo-import-saved"]')).toHaveCount(0);
  });

  test('can go back from review and change the mapping', async ({ page }) => {
    await openWizard(page);
    await choose(page, 'clients.csv', `${HEADERS}\r\nAda Lovelace,ada@example.com\r\n`);

    await page.locator('[data-testid="import-to-review"]').click();
    await expect(page.locator('[data-testid="import-preview"]')).toBeVisible();

    await page.locator('[data-testid="import-back"]').click();
    await expect(page.locator('[data-testid="import-mapper"]')).toBeVisible();
  });

  test('offers a template, and the template it offers is importable', async ({ page }) => {
    // The round trip that matters: a user downloads the template, fills it in, and uploads it.
    // A template whose own headers do not map is a template that fails on first use.
    await openWizard(page);

    const download = page.waitForEvent('download');
    await page.locator('[data-testid="import-template-download"]').click();
    const file = await download;
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8');

    expect(csv.split(/\r?\n/)[0]).toBeTruthy();
    // The guidance notes are deliberately not in the file: CSV has one header row and no
    // concept of a second, so a hint row would come back as a failed row 2 on every re-import.
    expect(csv.trim().split(/\r?\n/)).toHaveLength(1);

    await choose(page, 'filled.csv', `${csv.trim()}\r\nAda Lovelace,ada@example.com\r\n`);
    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();
    await expect(page.locator('[data-testid="import-succeeded"]')).toContainText('1');
  });

  test('starting over clears the previous file', async ({ page }) => {
    await openWizard(page);
    await choose(page, 'clients.csv', `${HEADERS}\r\nAda Lovelace,ada@example.com\r\n`);
    await page.locator('[data-testid="import-to-review"]').click();
    await page.locator('[data-testid="import-commit"]').click();
    await expect(page.locator('[data-testid="import-succeeded"]')).toBeVisible();

    await page.locator('[data-testid="import-restart"]').click();
    await expect(page.locator('[data-testid="import-file"]')).toBeVisible();
    await expect(page.locator('[data-testid="import-succeeded"]')).toHaveCount(0);
  });
});
