import { test, expect } from '@playwright/test';
import { FIELD_TYPE_CATALOG } from '@dynamic-entity/core';
import { builderPaletteButton, gotoDemo, safeClick } from './test-helpers';

test.describe('Field catalogue parity and conditional visibility', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  /*
   * Every type in core's catalog, by its palette hook, not four of them by label. The title
   * used to promise an "18-type catalog" while the catalog had grown to 27 and the test
   * checked six labels, so a type dropped from the palette would have passed.
   */
  test('Form Builder palette offers every catalog type plus the registered custom one, and nothing else', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await expect(page.locator('ngx-entity-builder')).toBeVisible();

    for (const meta of FIELD_TYPE_CATALOG) {
      await expect(page.getByTestId(`palette-${meta.type}`), meta.type).toHaveCount(1);
    }
    // Plus the one custom type the demo registers for the palette (`nps`, app.config.ts).
    await expect(page.getByTestId('palette-nps')).toHaveCount(1);
    const offered = page.locator(
      '[data-testid^="palette-"]:not([data-testid="palette-search"]):not([data-testid="palette-search-clear"]):not([data-testid="palette-no-match"])',
    );
    await expect(offered).toHaveCount(FIELD_TYPE_CATALOG.length + 1);
    expect(FIELD_TYPE_CATALOG.length).toBe(27);
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
