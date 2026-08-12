import { expect, test } from '@playwright/test';
import {
  builderPaletteButton,
  fieldByLabel,
  gotoDemo,
  recordButton,
  safeClick,
  safeSelect,
} from './test-helpers';

/**
 * Phase 6 — named lookup lists (`listName`).
 *
 * The demo's `tier` field carries no options at all: they arrive from the `clientTier` list
 * registered through `LOOKUP_REGISTRY` in app.config.ts.
 */
test.describe('Dynamic Entity E2E - Phase 6 Named Lookup Lists', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('renders options resolved from a named list, in the list order', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    const tier = fieldByLabel(page, 'Tier').locator('select');
    await expect(tier.locator('option')).toHaveCount(4); // placeholder + 3 tiers

    // sortOrder, not the order the values were authored in.
    const labels = await tier.locator('option').allInnerTexts();
    expect(labels.map(l => l.trim())).toEqual(['Select...', 'Gold', 'Silver', 'Bronze']);
  });

  test('stores a picked list value and shows it back on the record', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    await fieldByLabel(page, 'Name').locator('input').fill('Lookup Test Client');
    await safeSelect(fieldByLabel(page, 'Tier').locator('select'), 'Bronze');
    await safeClick(page.getByRole('button', { name: 'Save' }));

    await safeClick(recordButton(page, 'Lookup Test Client'));
    // The stored value is the option object, so assert the selected option's text, not the
    // select's DOM value (Angular renders "3: Object" for an object-valued option).
    await expect(fieldByLabel(page, 'Tier').locator('option:checked')).toHaveText('Bronze');
  });

  test('resolves a value stored under another language (§6.2)', async ({ page }) => {
    // Globex holds the German spelling "Silber" from an older list.
    await safeClick(recordButton(page, 'Globex'));

    const tier = fieldByLabel(page, 'Tier');
    await expect(tier).toContainText('Silver');
  });

  test('the builder swaps the option editor for a list name', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await safeClick(builderPaletteButton(page, 'Dropdown'));

    // A fresh dropdown authors its options inline — seeded empty, so the editor is the
    // "add an option" affordance rather than a first row.
    const inspector = page.locator('ngx-field-inspector');
    await expect(inspector.getByText('No options yet', { exact: false })).toBeVisible();
    await expect(page.getByTestId('list-name')).toHaveCount(0);

    await safeClick(page.getByTestId('data-source'));
    await safeClick(page.getByRole('option', { name: 'A named list' }));

    await expect(page.getByTestId('list-name')).toBeVisible();
    await expect(inspector.getByText('No options yet', { exact: false })).toHaveCount(0);

    await page.getByTestId('list-name').fill('clientTier');
    await expect(page.getByTestId('list-name')).toHaveValue('clientTier');
  });
});
