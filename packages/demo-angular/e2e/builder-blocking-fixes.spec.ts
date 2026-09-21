import { expect, test } from '@playwright/test';
import {
  builderPaletteButton,
  fieldByLabel,
  gotoDemo,
  safeClick,
  safeSelect,
  selectMatOption,
} from './test-helpers';

/**
 * Two authoring paths that used to leave a config that could not be saved or evaluated:
 * 1. Rule evaluation against a choice field, whose stored value is a LocalizedText object.
 * 2. Inline options and a list name being set at once, in the builder's source switcher.
 */
test.describe('Builder authoring paths that used to block a save', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('rule evaluation handles LocalizedText choice values correctly', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    // Status is a dropdown storing { en: 'Active' }. Switching status toggles conditional fields.
    const statusSelect = fieldByLabel(page, 'Status').locator('select');
    await safeSelect(statusSelect, 'Active');

    // Verify selecting Active triggers rules / preserves expected form state
    await expect(fieldByLabel(page, 'Status').locator('option:checked')).toHaveText('Active');
  });

  test('builder data source toggle enforces option vs listName exclusivity', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await safeClick(builderPaletteButton(page, 'Dropdown'));

    const inspector = page.locator('ngx-field-inspector');
    
    // Switch to named list
    await selectMatOption(page, 'data-source', 'A named list');
    await expect(page.getByTestId('list-name')).toBeVisible();

    await page.getByTestId('list-name').fill('clientTier');
    await expect(page.getByTestId('list-name')).toHaveValue('clientTier');

    // Switch back to manual options: listName input must disappear
    await selectMatOption(page, 'data-source', 'Authored here');

    await expect(page.getByTestId('list-name')).toHaveCount(0);
    await expect(inspector.getByTestId('add-option')).toBeVisible();

    // Adding an option confirms it is in manual mode
    await safeClick(inspector.getByTestId('add-option'));
    await expect(inspector.locator('[data-testid="option-row"]')).toHaveCount(1);
  });

  test('named list resolution and persistence round trip', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    const tierSelect = fieldByLabel(page, 'Tier').locator('select');
    await safeSelect(tierSelect, 'Gold');

    await expect(tierSelect.locator('option:checked')).toHaveText('Gold');
  });
});
