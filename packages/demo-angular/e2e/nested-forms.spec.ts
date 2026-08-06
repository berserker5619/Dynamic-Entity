import { test, expect } from '@playwright/test';
import { builderPaletteButton, gotoDemo } from './test-helpers';

test.describe('Dynamic Entity E2E - Nested Groups & Array Lists', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('creates a group field and reflects label edits in live preview', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    const builder = page.locator('ngx-entity-builder');
    const preview = page.locator('.builder-preview');

    await expect(builder).toBeVisible();
    await safeClick(builderPaletteButton(page, 'Group'));

    await expect(builder.locator('.deb-field-row')).toHaveCount(1);
    await expect(builder.locator('.deb-field-label')).toContainText('Group 1');
    await expect(preview.locator('.ngx-field--group')).toBeVisible();

    await safeFill(page.getByLabel('Label (en)'), 'Contact Details');

    await expect(builder.locator('.deb-field-label')).toContainText('Contact Details');
    await expect(preview.locator('.ngx-field--group')).toContainText('Contact Details');
  });

  test('creates an array field and manages repeated items in preview', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    const builder = page.locator('ngx-entity-builder');
    const preview = page.locator('.builder-preview');

    await expect(builder).toBeVisible();
    await safeClick(builderPaletteButton(page, 'Array'));
    await expect(builder.locator('.deb-field-row')).toHaveCount(1);

    const arrayContainer = preview.locator('.ngx-field--array');
    const addBtn = arrayContainer.locator('button.ngx-field__array-add-btn');

    await expect(arrayContainer).toBeVisible();
    await safeClick(addBtn);
    await expect(arrayContainer.locator('.ngx-field__array-item')).toHaveCount(1);

    await safeClick(addBtn);
    await expect(arrayContainer.locator('.ngx-field__array-item')).toHaveCount(2);

    await safeClick(arrayContainer.locator('button.ngx-field__array-remove-btn').first());
    await expect(arrayContainer.locator('.ngx-field__array-item')).toHaveCount(1);
  });
});
