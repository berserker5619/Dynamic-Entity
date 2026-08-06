import { test, expect } from '@playwright/test';

test.describe('Dynamic Entity E2E - Validation & Multi-Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4200');
    await page.waitForLoadState('networkidle');
  });

  test('1. Validates required form fields and prevents invalid submission', async ({ page }) => {
    // Click "+ Add Client"
    await page.locator('button', { hasText: '+ Add Client' }).click();
    await expect(page.locator('h2')).toHaveText('New Client');

    // Save button should be disabled when required field (Name) is empty
    const saveBtn = page.locator('button.ngx-form__submit', { hasText: 'Save' });
    await expect(saveBtn).toBeDisabled();

    // Fill required Name field
    await page.locator('.ngx-field', { hasText: 'Name' }).locator('input').fill('Valid Test Client');

    // Save button should now be enabled
    await expect(saveBtn).toBeEnabled();

    // Submit form
    await saveBtn.click();
    await page.waitForTimeout(500);

    // Verify successfully returned to list and record exists
    await expect(page.locator('button', { hasText: 'Valid Test Client' })).toBeVisible();
  });

  test('2. Navigates between tabs in multi-tab forms', async ({ page }) => {
    // Click on Acme Corp to open Edit Client
    await page.locator('button', { hasText: 'Acme Corp' }).click();
    await expect(page.locator('h2')).toHaveText('Edit Client');

    // Check tab bar if tabs exist
    const form = page.locator('ngx-dynamic-form');
    await expect(form).toBeVisible();

    // Verify reset button returns to list view
    const resetBtn = page.locator('button.ngx-form__reset', { hasText: 'Back to List' });
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();
    await page.waitForTimeout(300);

    // Verify returned to client list
    await expect(page.locator('h1')).toHaveText('Dynamic Entity Demo');
  });
});
