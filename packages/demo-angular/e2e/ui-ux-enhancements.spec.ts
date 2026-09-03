import { test, expect } from '@playwright/test';
import {
  fieldByLabel,
  fieldPart,
  gotoDemo,
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

  test('displays contextual human-friendly validation error message when submitting empty required fields', async ({ page }) => {
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
});
