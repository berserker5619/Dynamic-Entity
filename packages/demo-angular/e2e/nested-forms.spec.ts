import { test, expect } from '@playwright/test';

test.describe('Dynamic Entity E2E - Nested Groups & Array Lists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4200');
    await page.waitForLoadState('networkidle');
  });

  test('1. Navigates to Form Builder, creates a group field, and verifies rendering', async ({ page }) => {
    // Navigate to Form Builder tab
    await page.locator('button.nav-link', { hasText: 'Form Builder' }).click();
    const builder = page.locator('ngx-entity-builder');
    await expect(builder).toBeVisible();

    // Click exact Group palette button (filter out Radio Group)
    const groupTypeBtn = builder.locator('.deb-palette__item').filter({ hasText: 'Group' }).filter({ hasNotText: 'Radio' }).first();
    await expect(groupTypeBtn).toBeVisible();
    await groupTypeBtn.click();
    await page.waitForTimeout(500);

    // Verify canvas shows Group field row
    await expect(builder.locator('.deb-field-row')).toHaveCount(1);
    await expect(builder.locator('.deb-field-label')).toContainText('Group 1');

    // Verify live preview renders <ngx-group-field> fieldset
    const preview = page.locator('.builder-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.ngx-field--group')).toBeVisible();
  });

  test('2. Navigates to Form Builder, creates an array field, adds items, and removes an item', async ({ page }) => {
    // Navigate to Form Builder tab
    await page.locator('button.nav-link', { hasText: 'Form Builder' }).click();
    const builder = page.locator('ngx-entity-builder');
    await expect(builder).toBeVisible();

    // Click Array palette button
    const arrayTypeBtn = builder.locator('.deb-palette__item', { hasText: 'Array' }).first();
    await expect(arrayTypeBtn).toBeVisible();
    await arrayTypeBtn.click();
    await page.waitForTimeout(500);

    // Verify canvas shows Array field row
    await expect(builder.locator('.deb-field-row')).toHaveCount(1);

    // Live preview should render <ngx-array-field> container with "+ Add Item" button
    const preview = page.locator('.builder-preview');
    await expect(preview).toBeVisible();
    const arrayContainer = preview.locator('.ngx-field--array');
    await expect(arrayContainer).toBeVisible();

    // Click "+ Add Item" button
    const addBtn = arrayContainer.locator('button.ngx-field__array-add-btn');
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await page.waitForTimeout(300);

    // Verify item row #1 appears
    await expect(arrayContainer.locator('.ngx-field__array-item')).toHaveCount(1);

    // Click "+ Add Item" button again for row #2
    await addBtn.click();
    await page.waitForTimeout(300);
    await expect(arrayContainer.locator('.ngx-field__array-item')).toHaveCount(2);

    // Click "Remove" button on row #1
    const removeBtn = arrayContainer.locator('button.ngx-field__array-remove-btn').first();
    await removeBtn.click();
    await page.waitForTimeout(300);
    await expect(arrayContainer.locator('.ngx-field__array-item')).toHaveCount(1);
  });
});
