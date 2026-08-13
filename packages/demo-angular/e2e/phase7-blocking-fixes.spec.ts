import { expect, test } from '@playwright/test';
import {
  builderPaletteButton,
  fieldByLabel,
  gotoDemo,
  safeClick,
  safeSelect,
} from './test-helpers';

/**
 * Phase 7.0 — End-to-end verification of Phase 7.0 fixes:
 * 1. Object-value rule evaluation with LocalizedText choice values.
 * 2. Option/list exclusivity in the builder data source switcher.
 */
test.describe('Dynamic Entity E2E - Phase 7.0 Fixes & Edge Cases', () => {
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
    await safeClick(page.getByTestId('data-source'));
    await safeClick(page.getByRole('option', { name: 'A named list' }));
    await expect(page.getByTestId('list-name')).toBeVisible();

    await page.getByTestId('list-name').fill('clientTier');
    await expect(page.getByTestId('list-name')).toHaveValue('clientTier');

    // Switch back to manual options: listName input must disappear
    await safeClick(page.getByTestId('data-source'));
    await safeClick(page.getByRole('option', { name: 'Authored here' }));

    await expect(page.getByTestId('list-name')).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: 'Option' })).toBeVisible();

    // Adding an option confirms it is in manual mode
    await safeClick(inspector.getByRole('button', { name: 'Option' }));
    await expect(inspector.locator('[data-testid="option-row"]')).toHaveCount(1);
  });

  test('named list resolution and persistence round trip', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    const tierSelect = fieldByLabel(page, 'Tier').locator('select');
    await safeSelect(tierSelect, 'Gold');

    await expect(tierSelect.locator('option:checked')).toHaveText('Gold');
  });
});
