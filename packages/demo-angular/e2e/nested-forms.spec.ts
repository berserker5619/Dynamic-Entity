import { test, expect } from '@playwright/test';
import {
  builderFieldRows,
  builderPaletteButton,
  gotoDemo,
  safeClick,
  safeFill,
} from './test-helpers';

test.describe('Dynamic Entity E2E - Nested Groups & Array Lists', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('creates a group field and reflects label edits in live preview', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    const builder = page.locator('ngx-entity-builder');
    const preview = page.getByTestId('builder-preview');

    await expect(builder).toBeVisible();
    await safeClick(builderPaletteButton(page, 'Group'));

    await expect(builderFieldRows(page)).toHaveCount(1);

    // Set the field label in the inspector and ensure the builder's label updates.
    await safeFill(page.getByLabel('Label (en)'), 'Contact Details');

    await expect(builderFieldRows(page)).toContainText('Contact Details');
  });

  test('creates an array field and manages repeated items in preview', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    const builder = page.locator('ngx-entity-builder');
    const preview = page.getByTestId('builder-preview');

    await expect(builder).toBeVisible();
    await safeClick(builderPaletteButton(page, 'Array'));
    await expect(builderFieldRows(page)).toHaveCount(1);

    const arrayContainer = preview.locator('[data-field-type="array"]');
    const addBtn = arrayContainer.locator('[data-testid$="-add"]');

    await expect(arrayContainer).toBeVisible();
    await safeClick(addBtn);
    await expect(arrayContainer.locator('[data-testid$="-row"]')).toHaveCount(1);

    await safeClick(addBtn);
    await expect(arrayContainer.locator('[data-testid$="-row"]')).toHaveCount(2);

    await safeClick(arrayContainer.locator('[data-testid*="-remove-"]').first());
    await expect(arrayContainer.locator('[data-testid$="-row"]')).toHaveCount(1);
  });
});
