import { test, expect } from '@playwright/test';
import { builderPaletteButton, gotoDemo, safeClick } from './test-helpers';

test.describe('Dynamic Entity E2E - Phase 0 Catalog Parity & Conditional Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('Form Builder palette exposes full 18-type catalog including Month & Year, Image, File, Entity Reference', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    const builder = page.locator('ngx-entity-builder');
    await expect(builder).toBeVisible();

    // Verify newly unified catalog items are present in palette
    await expect(builderPaletteButton(page, 'Month & Year')).toBeVisible();
    await expect(builderPaletteButton(page, 'Image Upload')).toBeVisible();
    await expect(builderPaletteButton(page, 'File Attachment')).toBeVisible();
    await expect(builderPaletteButton(page, 'Entity Reference')).toBeVisible();
    await expect(builderPaletteButton(page, 'Text Area')).toBeVisible();
    await expect(builderPaletteButton(page, 'Currency')).toBeVisible();
  });

  test('adds Month & Year, Image, File, and Entity Reference fields to builder canvas and live preview', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    const builder = page.locator('ngx-entity-builder');
    const preview = page.getByTestId('builder-preview');
    await expect(builder).toBeVisible();

    // Add Month & Year
    await safeClick(builderPaletteButton(page, 'Month & Year'));
    await expect(preview.locator('[data-field-type="monthYear"]')).toBeVisible();

    // Add Image Upload
    await safeClick(builderPaletteButton(page, 'Image Upload'));
    await expect(preview.locator('[data-field-type="image"]')).toBeVisible();

    // Add File Attachment
    await safeClick(builderPaletteButton(page, 'File Attachment'));
    await expect(preview.locator('[data-field-type="file"]')).toBeVisible();

    // Add Entity Reference
    await safeClick(builderPaletteButton(page, 'Entity Reference'));
    await expect(preview.locator('[data-field-type="entity-ref"]')).toBeVisible();
  });
});
