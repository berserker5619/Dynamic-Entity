import { expect, test, type Page } from '@playwright/test';
import { builderFieldRows, builderPaletteButton, gotoDemo, safeClick } from './test-helpers';

/**
 * Undo / redo in the builder.
 *
 * The store specs cover the history itself. What they cannot show is that the toolbar is
 * wired to it, that the buttons disable at the ends, and that Ctrl+Z reaches the store from
 * a real keyboard — including the case it must deliberately ignore.
 */
test.describe('builder undo / redo', () => {
  const undo = (page: Page) => page.getByTestId('builder-undo');
  const redo = (page: Page) => page.getByTestId('builder-redo');

  async function openBuilder(page: Page): Promise<void> {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await expect(page.locator('ngx-entity-builder')).toBeVisible();
  }

  test('both buttons start disabled on a fresh builder', async ({ page }) => {
    await openBuilder(page);
    // Opening is not an edit, so there is nothing to step back to.
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
  });

  test('undoes an added field and redoes it', async ({ page }) => {
    await openBuilder(page);
    await safeClick(builderPaletteButton(page, 'text'));
    await expect(builderFieldRows(page)).toHaveCount(1);
    await expect(undo(page)).toBeEnabled();

    await safeClick(undo(page));
    await expect(builderFieldRows(page)).toHaveCount(0);
    await expect(redo(page)).toBeEnabled();

    await safeClick(redo(page));
    await expect(builderFieldRows(page)).toHaveCount(1);
  });

  test('steps back through several edits one at a time', async ({ page }) => {
    await openBuilder(page);
    await safeClick(builderPaletteButton(page, 'text'));
    await safeClick(builderPaletteButton(page, 'number'));
    await safeClick(builderPaletteButton(page, 'email'));
    await expect(builderFieldRows(page)).toHaveCount(3);

    for (const remaining of [2, 1, 0]) {
      await safeClick(undo(page));
      await expect(builderFieldRows(page)).toHaveCount(remaining);
    }
    await expect(undo(page)).toBeDisabled();
  });

  test('Ctrl+Z undoes, and Ctrl+Shift+Z redoes', async ({ page }) => {
    await openBuilder(page);
    await safeClick(builderPaletteButton(page, 'text'));
    await expect(builderFieldRows(page)).toHaveCount(1);

    await page.keyboard.press('Control+z');
    await expect(builderFieldRows(page)).toHaveCount(0);

    await page.keyboard.press('Control+Shift+z');
    await expect(builderFieldRows(page)).toHaveCount(1);
  });

  test('Ctrl+Z inside a text input is left to the input', async ({ page }) => {
    await openBuilder(page);
    await safeClick(builderPaletteButton(page, 'text'));
    await expect(builderFieldRows(page)).toHaveCount(1);

    // An input has its own undo stack. Hijacking it would throw away a whole field when the
    // author only wanted to take back a character.
    const label = page.getByTestId('field-label');
    await label.click();
    await label.fill('Some label');
    await page.keyboard.press('Control+z');

    await expect(builderFieldRows(page)).toHaveCount(1);
  });

  test('a new edit after an undo abandons the redo branch', async ({ page }) => {
    await openBuilder(page);
    await safeClick(builderPaletteButton(page, 'text'));
    await safeClick(undo(page));
    await expect(redo(page)).toBeEnabled();

    await safeClick(builderPaletteButton(page, 'number'));
    await expect(redo(page)).toBeDisabled();
    await expect(builderFieldRows(page)).toHaveCount(1);
  });
});
