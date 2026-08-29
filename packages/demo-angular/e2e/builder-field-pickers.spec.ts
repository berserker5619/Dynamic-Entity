import { expect, test } from '@playwright/test';
import { builderPaletteButton, gotoDemo, safeClick } from './test-helpers';

/**
 * Every place the builder names a field used to be a text box, which is the one way left to
 * author a reference that names two fields at once — ids are unique per scope, so `address`
 * means nothing in particular once two tabs have one.
 *
 * These specs hold the pickers in place: what they offer is a path, and choosing from a list
 * is the only way to author one.
 */
test.describe('the builder names fields by picking them', () => {
  async function openBuilderWithTwoFields(page: import('@playwright/test').Page): Promise<void> {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await safeClick(builderPaletteButton(page, 'Text'));
    await safeClick(builderPaletteButton(page, 'Number'));
    await expect(page.locator('[data-testid="builder-field-row"]')).toHaveCount(2);
  }

  test('the showWhen watched field is a picker, seeded with a real field', async ({ page }) => {
    await openBuilderWithTwoFields(page);

    await safeClick(page.getByTestId('add-show-when'));

    // A picker, not an input — and seeded with a path rather than the literal string "field",
    // which used to reference nothing and hide the field until someone noticed.
    const watched = page.getByTestId('show-when-field');
    await expect(watched).toBeVisible();
    // The trigger shows "Label path"; the bracketed token is what gets stored.
    await expect(watched).toContainText('main.');
    await expect(watched).not.toContainText(/^field$/);
  });

  test('the showWhen picker offers every field, by path', async ({ page }) => {
    await openBuilderWithTwoFields(page);
    await safeClick(page.getByTestId('add-show-when'));

    await safeClick(page.getByTestId('show-when-field'));
    const options = page.getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.first()).toContainText('main.');
  });

  test('a rule names its trigger and its targets by path', async ({ page }) => {
    await openBuilderWithTwoFields(page);

    await safeClick(page.getByTestId('add-rule'));

    // Both were free text. The trigger is a single select; the targets are a multi-select,
    // which did not exist at all — a rule could only ever act on the field it triggered from.
    const trigger = page.getByTestId('rule-trigger');
    const targets = page.getByTestId('rule-targets');
    await expect(trigger).toBeVisible();
    await expect(targets).toBeVisible();
    await expect(trigger).toContainText('main.');
    await expect(targets).toContainText('main.');
  });

  test('a rule can be applied to more than one field', async ({ page }) => {
    await openBuilderWithTwoFields(page);
    await safeClick(page.getByTestId('add-rule'));

    await safeClick(page.getByTestId('rule-targets'));
    const options = page.getByRole('option');
    await expect(options).toHaveCount(2);
    await options.nth(0).click();
    await options.nth(1).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);

    // Both fields selected: the trigger text lists each chosen path.
    await expect(page.getByTestId('rule-targets')).toContainText('main.text_1');
    await expect(page.getByTestId('rule-targets')).toContainText('main.number_1');
  });

  test('the cascade parent offers paths once a field is an entity reference', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await safeClick(builderPaletteButton(page, 'Text'));
    await safeClick(builderPaletteButton(page, 'Entity Reference'));

    await safeClick(page.getByTestId('entity-ref-parent'));
    const options = page.getByRole('option');
    // "None" plus the one other field — never the entity-ref field itself, which cannot
    // cascade from its own value.
    await expect(options).toHaveCount(2);
    await expect(options.nth(1)).toContainText('main.text_1');
  });
});
