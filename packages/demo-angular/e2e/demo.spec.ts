import { test, expect } from '@playwright/test';

test.describe('Dynamic Entity Demo E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4200');
    await page.waitForLoadState('networkidle');
  });

  test('1. Renders clients table with sample data and handles search filtering', async ({ page }) => {
    // Verify main heading
    await expect(page.locator('h1')).toHaveText('Dynamic Entity Demo');

    // Verify sample client records render in the list
    await expect(page.locator('button', { hasText: 'Acme Corp' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Globex' })).toBeVisible();

    // Perform search filtering
    const searchInput = page.locator('input[placeholder="Search clients…"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Stark');
    await page.waitForTimeout(300);

    // Verify search results
    await expect(page.locator('button', { hasText: 'Stark Industries' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Globex' })).not.toBeVisible();
  });

  test('2. Opens dynamic form, fills inputs, and creates a record', async ({ page }) => {
    // Click "+ Add Client"
    const addBtn = page.locator('button', { hasText: '+ Add Client' });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Verify Dynamic Form section title
    await expect(page.locator('h2')).toHaveText('New Client');
    await expect(page.locator('ngx-dynamic-form')).toBeVisible();

    // Fill form fields rendered by ngx-dynamic-form
    await page.locator('.ngx-field', { hasText: 'Name' }).locator('input').fill('Acme Global');
    await page.locator('.ngx-field', { hasText: 'Email' }).locator('input').fill('info@acmeglobal.com');
    await page.locator('.ngx-field', { hasText: 'Company' }).locator('input').fill('Acme');
    await page.locator('.ngx-field', { hasText: 'Status' }).locator('select').selectOption('active');
    await page.locator('.ngx-field', { hasText: 'Salary' }).locator('input').fill('185000');
    await page.locator('.ngx-field', { hasText: 'Notes' }).locator('textarea').fill('New client added via Playwright E2E test.');

    // Submit form
    const saveBtn = page.locator('button.ngx-form__submit', { hasText: 'Save' });
    await saveBtn.click();
    await page.waitForTimeout(500);

    // Verify returned to list view and new client exists
    await expect(page.locator('button', { hasText: 'Acme Global' })).toBeVisible();
  });

  test('3. Evaluates RBAC data masking dynamically when role changes', async ({ page }) => {
    // Switch role to "IT Support (Masked Salary)"
    const itRoleBtn = page.locator('button.role-btn', { hasText: 'IT Support' });
    await expect(itRoleBtn).toBeVisible();
    await itRoleBtn.click();

    // Click on Acme Corp record to open form in masked role view
    await page.locator('button', { hasText: 'Acme Corp' }).click();
    await expect(page.locator('h2')).toHaveText('Edit Client');

    // Salary field should be masked as XXXXXXXXX for IT_SUPPORT role
    const salaryMaskedValue = page.locator('.ngx-field', { hasText: 'Salary' }).locator('.ngx-field__value--masked');
    await expect(salaryMaskedValue).toHaveText('XXXXXXXXX');

    // Click Back to List
    await page.locator('button.ngx-form__reset', { hasText: 'Back to List' }).click();

    // Switch back to Admin role
    const adminRoleBtn = page.locator('button.role-btn', { hasText: 'Admin' });
    await adminRoleBtn.click();

    // Back in list view, click record again
    await page.locator('button', { hasText: 'Acme Corp' }).click();
    // Salary field should now display unmasked salary input with 120000
    const salaryInput = page.locator('.ngx-field', { hasText: 'Salary' }).locator('input');
    await expect(salaryInput).toHaveValue('120000');
  });

  test('4. Navigates to Entity Builder, adds field, and updates live preview', async ({ page }) => {
    // Click "Form Builder" navigation tab
    const builderNavBtn = page.locator('button.nav-link', { hasText: 'Form Builder' });
    await builderNavBtn.click();

    // Verify visual builder is mounted
    const builder = page.locator('ngx-entity-builder');
    await expect(builder).toBeVisible();

    // Verify palette buttons (Text, Number, Date, etc.)
    const textTypeBtn = builder.locator('.deb-palette__item', { hasText: 'Text' }).first();
    await expect(textTypeBtn).toBeVisible();
    await textTypeBtn.click();
    await page.waitForTimeout(500);

    // Verify canvas field row appears
    await expect(builder.locator('.deb-field-row')).toHaveCount(1);

    // Verify live preview slot updates with live Angular form
    const preview = page.locator('.builder-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('h3')).toContainText('Live preview');
  });
});
