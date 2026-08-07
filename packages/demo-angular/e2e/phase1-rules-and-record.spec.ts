import { test, expect } from '@playwright/test';
import { fieldByLabel, gotoDemo, safeClick } from './test-helpers';

test.describe('Dynamic Entity E2E - Phase 1 Rules Engine & Record Form', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('renders client record form and interacts with dynamic form components', async ({ page }) => {
    // Open client record edit mode
    await safeClick(page.getByRole('button', { name: 'Acme Corp' }));

    await expect(page.getByRole('heading', { level: 2, name: 'Edit Client' })).toBeVisible();
    await expect(page.locator('ngx-dynamic-form')).toBeVisible();

    const nameInput = fieldByLabel(page, 'Name').locator('input');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('Acme Corp');
  });

  test('executes reactive form changes and emits formReset to return to list', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));
    await expect(page.getByRole('heading', { level: 2, name: 'New Client' })).toBeVisible();

    const form = page.locator('ngx-dynamic-form');
    await expect(form).toBeVisible();

    const nameInput = fieldByLabel(page, 'Name').locator('input');
    await nameInput.fill('Temp Name');

    const resetBtn = form.locator('button.ngx-form__reset');
    await expect(resetBtn).toBeVisible();

    await resetBtn.click();
    await expect(page.getByPlaceholder('Search clients…')).toBeVisible();
  });
});
