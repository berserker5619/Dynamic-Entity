import { expect, test, type Page } from '@playwright/test';
import { DEMO_MASK, fieldByLabel, fieldPart, gotoDemo, safeClick, safeSelect } from './test-helpers';

/**
 * The extension points that are configured application-wide, in `app.config.ts`.
 *
 * Each test here fails if its provider is removed — that is the only property that makes any
 * of this worth running. A token that is registered but never observed proves nothing: the
 * form renders either way, and the whole reason this suite exists is that eleven documented
 * extension points shipped with no end-to-end evidence at all.
 *
 * The entity-scoped points — custom validators, hooks, migrations, uploads and a field type
 * the library does not ship — live in `extensions-entity.spec.ts`.
 */

/** Open one entity's list from the header picker. */
async function openEntity(page: Page, entity: string): Promise<void> {
  await safeSelect(page.locator('#entitySelect'), entity);
}

test.describe('validationMessages — the registered pack, not the library defaults', () => {
  test('error text follows the interface language', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    // Touch a required field and leave it empty.
    const name = fieldByLabel(page, 'Name').locator('input');
    await name.focus();
    await name.blur();

    const error = fieldPart(page, 'name', 'error');
    // English is deliberately identical to the library's own default — see the pack in
    // `app.config.ts`. It is the German that proves the override is what is being read.
    await expect(error).toHaveText('This field is required.');

    await safeClick(page.getByTestId('ui-lang-de'));
    await expect(error).toHaveText('Pflichtfeld.');

    await safeClick(page.getByTestId('ui-lang-en'));
    await expect(error).toHaveText('This field is required.');
  });
});

test.describe('setDateFormatters — display format tied to the interface language', () => {
  /**
   * Two surfaces, because they used to disagree.
   *
   * The record view's summary panel has always rendered through core's `formatDisplayValue`,
   * which is the function `setDateFormatters` replaces. The read-only `date` **field** did
   * not — it called `toLocaleDateString()` itself — so a host that configured formatters got
   * them on the summary and silently not on the field. Asserting both is what stops the two
   * paths drifting apart again.
   */
  test('a date renders in the language the interface is set to', async ({ page }) => {
    await gotoDemo(page);
    await openEntity(page, 'extensions');
    await safeClick(page.getByRole('button', { name: 'Current Sample' }));
    await safeClick(page.getByTestId('toggle-record-view'));

    const reviewedOn = page.getByTestId('summary-reviewedOn');
    // 2026-03-08 — month-first in English, day-first in German. Without the formatters both
    // would follow the browser's locale and read identically.
    await expect(reviewedOn).toContainText('3/8/2026');

    await safeClick(page.getByTestId('ui-lang-de'));
    await expect(reviewedOn).toContainText('8.3.2026');
  });

  test('the read-only date field follows the same formatters as the summary', async ({ page }) => {
    await gotoDemo(page);
    await openEntity(page, 'extensions');
    await safeClick(page.getByRole('button', { name: 'Current Sample' }));
    // 'Data only' renders every field read-only, which is the `date` field's display path.
    await safeClick(page.getByTestId('mode-data'));

    const field = fieldPart(page, 'reviewedOn', 'value');
    await expect(field).toHaveText('3/8/2026');

    await safeClick(page.getByTestId('ui-lang-de'));
    await expect(field).toHaveText('8.3.2026');

    // And the summary agrees with it, in the same language, at the same moment.
    await expect(page.getByTestId('summary-reviewedOn')).toContainText('8.3.2026');
  });
});

test.describe('MASKED_PLACEHOLDER — one mask, whichever path withheld the value', () => {
  /**
   * The demo provides `DEMO_MASK` to the renderer *and* uses the same constant for the
   * records `LocalStore` masks on the way out. The renderer half is asserted here; the
   * store half is asserted in `local-store.masking.spec.ts`, because the demo's list rows
   * render a label rather than the masked field and there is nothing on screen to look at.
   */
  test('a masked field shows the configured placeholder, not the library default', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'IT Support (Masked Salary)' }));
    await safeClick(page.getByRole('button', { name: 'Acme Corp' }));

    const masked = fieldByLabel(page, 'Salary').locator('[data-testid$="-masked"]');
    await expect(masked).toBeVisible();
    await expect(masked).toHaveText(DEMO_MASK);
    // The negative matters as much as the positive: it is what fails if the provider is
    // dropped, since the field would then fall back to the library's own literal.
    await expect(masked).not.toHaveText('XXXXXXXXX');
  });
});

test.describe('ENTITY_REF_CACHE_STORE — options that outlive a reload', () => {
  /**
   * The options appear either way, so "the dropdown is populated" proves nothing. What the
   * store changes is whether the *loader* runs, and the counter the demo's loaders keep is
   * the only way to see that.
   *
   * The counter itself is per page load — a module-level object — so after a reload it
   * starts at zero. That makes the second assertion stronger than a "still 1": the loader
   * did not run at all in the new document, and the options came from sessionStorage.
   */
  test('a reload repopulates an entity-ref field without calling its loader again', async ({ page }) => {
    await gotoDemo(page);
    await openEntity(page, 'orders');
    await safeClick(page.getByRole('button', { name: /Record \(order_001\)/ }));

    const company = fieldPart(page, 'company', 'input');
    // Sampled only *after* a retrying assertion has proven the options are rendered, so the
    // load has already settled and the counter cannot still be moving. A one-shot
    // `expect(await …)` would race anywhere else in this file.
    await expect(company.locator('option', { hasText: 'Acme' })).toHaveCount(1);
    expect(await page.evaluate(() => window.__refLoaderCalls?.companies ?? -1)).toBeGreaterThan(0);

    await page.reload();
    await openEntity(page, 'orders');
    await safeClick(page.getByRole('button', { name: /Record \(order_001\)/ }));

    await expect(fieldPart(page, 'company', 'input').locator('option', { hasText: 'Acme' })).toHaveCount(1);
    expect(await page.evaluate(() => window.__refLoaderCalls?.companies ?? -1)).toBe(0);
  });
});

test.describe('SYSTEM_DEFAULT_CAN_EDIT — who may edit a system-default tab', () => {
  /**
   * `organizations` marks its `orgInfo` tab `systemDefault`. The predicate the demo
   * registers admits `admin` and nobody else, and it only sees a role at all because
   * `BuilderPageComponent` passes `[userRoles]` — without that it would be handed an empty
   * array and lock the tab for everyone, which is how this token behaved before it was wired.
   */
  test('the tab is editable as admin and locked as a viewer', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await safeSelect(page.getByTestId('builder-entity-select'), 'organizations');

    const systemTab = page.getByTestId('tab-row-orgInfo').locator('input').first();
    await expect(systemTab).toBeVisible();
    await expect(systemTab).toBeEnabled();

    await safeClick(page.getByRole('button', { name: /^Viewer/ }));
    await expect(systemTab).toBeDisabled();

    await safeClick(page.getByRole('button', { name: 'Admin' }));
    await expect(systemTab).toBeEnabled();
  });
});
