import { test, expect } from '@playwright/test';
import {
  builderPaletteButton,
  expectSaveWithheld,
  fieldByLabel,
  fieldPart,
  gotoDemo,
  openInspectorSection,
  safeClick,
} from './test-helpers';

test.describe('Dynamic Entity E2E - UI/UX Redesign & Ergonomics Upgrade', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('renders dynamic form inside a 12-column responsive CSS grid container', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Acme Corp' }));

    const formPanel = page.getByTestId('form-panel');
    await expect(formPanel).toBeVisible();

    const displayStyle = await formPanel.evaluate(el => window.getComputedStyle(el).display);
    expect(displayStyle).toBe('grid');
  });

  test('displays contextual human-friendly validation error message when submitting empty required fields', async ({
    page,
  }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));
    await expect(page.getByRole('heading', { level: 2, name: 'New Client' })).toBeVisible();

    const nameInput = fieldByLabel(page, 'Name').locator('input');
    await nameInput.focus();
    await nameInput.blur();

    const errorMsg = fieldPart(page, 'name', 'error');
    await expect(errorMsg).toBeVisible();
    // This is no longer the library's built-in English message: `app.config.ts` registers a
    // `validationMessages.required` override, and its English wording is deliberately
    // identical so this assertion still reads correctly. What it covers is the *override*
    // reaching a text field. The library's own default is pinned by
    // `validation-messages.service.spec.ts` in the renderer package, and the German half of
    // this override is asserted in `extension-points.spec.ts`.
    await expect(errorMsg).toHaveText('This field is required.');
  });

  test('triggers save on Ctrl+S keyboard shortcut', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    const nameInput = fieldByLabel(page, 'Name').locator('input');
    await nameInput.fill('Shortcut Client');

    // Press Ctrl+S
    await page.keyboard.press('Control+s');

    // Verify returning to client list view
    await expect(page.getByPlaceholder('Search clients…')).toBeVisible();
  });

  /**
   * `layout="auto"` sizes an unset field by its type. A text field takes half the row, so
   * Name and Email sit side by side instead of an eight-row ladder. The demo opted in; the
   * library default is still `stack`.
   */
  test('auto layout puts two short fields on one row', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'narrow', 'auto layout is 12-column desktop; narrow collapses to 1 column');
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    const nameSlot = page.locator('#field-container-name');
    const emailSlot = page.locator('#field-container-email');
    await expect(nameSlot).toBeVisible();
    await expect(emailSlot).toBeVisible();

    const nameSpan = await nameSlot.evaluate(
      el => el.style.gridColumn || window.getComputedStyle(el).gridColumnStart || window.getComputedStyle(el).gridColumnEnd,
    );
    const emailSpan = await emailSlot.evaluate(
      el => el.style.gridColumn || window.getComputedStyle(el).gridColumnStart || window.getComputedStyle(el).gridColumnEnd,
    );
    expect(nameSpan).toMatch(/6/);
    expect(emailSpan).toMatch(/6/);

    const notesSlot = page.locator('#field-container-notes');
    const notesSpan = await notesSlot.evaluate(
      el => el.style.gridColumn || window.getComputedStyle(el).gridColumnStart || window.getComputedStyle(el).gridColumnEnd,
    );
    expect(notesSpan).toMatch(/12/);
  });

  /**
   * Help text is in the DOM even when the bubble is hidden, and the control names it.
   * Hover/focus is what *shows* it; `aria-describedby` is what a screen reader gets without
   * either.
   */
  test('author help text sits beside the label and is named by the control', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    const hint = fieldPart(page, 'email', 'hint');
    await expect(hint).toHaveText('We use this for billing notices — a shared inbox is fine.');

    const emailInput = fieldPart(page, 'email', 'input');
    await emailInput.focus();
    await expect(hint).toBeVisible();

    const describedBy = await emailInput.getAttribute('aria-describedby');
    const hintId = await hint.getAttribute('id');
    expect(describedBy).toBeTruthy();
    expect(hintId).toBeTruthy();
    expect(describedBy!.split(/\s+/)).toContain(hintId);
  });

  test('Save stays clickable while invalid, and the summary names the reason', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    const save = page.getByTestId('form-submit');
    await expect(save).toBeEnabled();
    await expectSaveWithheld(page);

    await safeClick(save);
    await expect(page.getByTestId('error-summary-name')).toContainText('This field is required.');
  });
});

test.describe('the builder as a person uses it', () => {
  test('the palette filter finds a type by a word that is not in its label', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));

    await expect(page.locator('ngx-field-palette')).toContainText('Basic');
    await expect(page.locator('ngx-field-palette')).toContainText('Choice');

    await page.getByTestId('palette-search').fill('money');
    await expect(page.getByTestId('palette-currency')).toBeVisible();
    await expect(page.getByTestId('palette-text')).toHaveCount(0);

    await safeClick(page.getByTestId('palette-search-clear'));
    await expect(page.getByTestId('palette-text')).toBeVisible();
  });

  test('the width control authors colSpan and shows it on the canvas row', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await safeClick(builderPaletteButton(page, 'Text'));

    await expect(page.getByTestId('layout-count')).toHaveText('12/12');
    await safeClick(page.getByTestId('field-span-6'));
    await expect(page.getByTestId('layout-count')).toHaveText('6/12');
    await expect(page.getByTestId('row-span-text_1')).toHaveText('6/12');
  });

  test('the issue list opens and selects the field it names', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await safeClick(builderPaletteButton(page, 'Dropdown'));

    await safeClick(page.getByTestId('builder-problems'));
    const noOptions = page.getByTestId('builder-problem').filter({ hasText: 'has no options' });
    await expect(noOptions).toBeVisible();
    await safeClick(noOptions);

    await expect(page.getByTestId('field-id')).toHaveValue('dropdown_1');
    await expect(page.getByTestId('add-option')).toBeVisible();
  });

  test('advanced inspector sections start closed until the field uses them', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await safeClick(builderPaletteButton(page, 'Text'));

    await expect(page.getByTestId('add-show-when')).toBeHidden();
    await openInspectorSection(page, 'Visibility');
    await expect(page.getByTestId('add-show-when')).toBeVisible();
  });

  test('help text authored in the inspector reaches the live preview', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await safeClick(builderPaletteButton(page, 'Text'));
    await page.getByTestId('field-hint').fill('The number on the card.');

    const preview = page.getByTestId('builder-preview');
    await expect(preview.getByTestId(/-hint$/)).toHaveText('The number on the card.');
  });
});
