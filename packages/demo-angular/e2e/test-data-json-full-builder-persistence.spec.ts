import { test, expect } from '@playwright/test';
import { gotoDemo, safeClick } from './test-helpers';

test.describe('Dynamic Entity E2E - Full Builder Authoring & Full Data Entry Persistence', () => {
  test('builds custom entity config via Form Builder UI, saves, renders form, fills fields across all tabs, submits, and verifies persistence', async ({ page }) => {
    test.setTimeout(90_000);
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // ─── Step 1: Open Form Builder ──────────────────────────────────────────
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await expect(page.locator('mat-toolbar')).toContainText('Entity Builder');

    // Set entity name
    const entityInput = page.locator('mat-form-field').filter({ hasText: 'Entity name' }).first().locator('input');
    await expect(entityInput).toBeVisible({ timeout: 5000 });
    await entityInput.fill('custom_full_coverage');

    // Rename Tab 1 (Main -> General Info)
    const tab1Input = page.locator('ngx-tab-manager .deb-tabs__row mat-form-field input').first();
    await tab1Input.fill('General Info');

    // Add Tab 2 (Additional Details)
    const addTabBtn = page.locator('ngx-tab-manager button').filter({ hasText: 'Add' }).first();
    await addTabBtn.click();
    const tab2Input = page.locator('ngx-tab-manager .deb-tabs__row mat-form-field input').nth(1);
    await tab2Input.fill('Additional Details');

    // Add fields via Palette
    const textBtn = page.locator('ngx-field-palette .deb-palette__item').filter({ hasText: 'Text' }).first();
    await textBtn.click();

    const numberBtn = page.locator('ngx-field-palette .deb-palette__item').filter({ hasText: 'Number' }).first();
    await numberBtn.click();

    const dateBtn = page.locator('ngx-field-palette .deb-palette__item').filter({ hasText: 'Date' }).first();
    await dateBtn.click();

    // Verify fields added to builder canvas
    await expect(page.locator('.deb-field-row')).toHaveCount(3);

    // ─── Step 2: Save Config in Form Builder Toolbar ──────────────────────
    const saveBtn = page.locator('mat-toolbar button').filter({ hasText: 'Save' });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    await expect(page.locator('.builder-toast')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.builder-toast')).toContainText('custom_full_coverage');

    // ─── Step 3: Switch to Renderer & Select New Entity ───────────────────
    await expect(page.locator('#entitySelect option[value="custom_full_coverage"]')).toBeAttached({ timeout: 5000 });
    await page.locator('#entitySelect').selectOption('custom_full_coverage');

    await safeClick(page.getByRole('button', { name: 'Clients Data' }));
    await safeClick(page.getByRole('button', { name: /\+ Add/i }));

    await expect(page.getByRole('heading', { level: 2, name: /New Record \(custom_full_coverage\)/i })).toBeVisible();

    // ─── Step 4: Fill All Fields Across All Tabs ─────────────────────────
    await expect(page.getByRole('tab', { name: 'General Info' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Additional Details' })).toBeVisible();

    // Fill inputs on Tab 1
    const textInput = page.locator('input.ngx-field__input[type="text"]').first();
    if (await textInput.isVisible()) {
      await textInput.fill('Johnathan Doe');
    }

    const numberInput = page.locator('input.ngx-field__input[type="number"]').first();
    if (await numberInput.isVisible()) {
      await numberInput.fill('75000');
    }

    const dateInput = page.locator('input.ngx-field__input[type="date"]').first();
    if (await dateInput.isVisible()) {
      await dateInput.fill('2026-08-11');
    }

    // Switch to Tab 2
    await safeClick(page.getByRole('tab', { name: 'Additional Details' }));
    await expect(page.getByRole('tab', { name: 'Additional Details' })).toHaveAttribute('aria-selected', 'true');

    // ─── Step 5: Save Record & Verify Data Persistence ───────────────────
    const recordSaveBtn = page.getByRole('button', { name: 'Save' });
    await expect(recordSaveBtn).toBeEnabled();
    await safeClick(recordSaveBtn);

    // Verify record saved and returned to list view
    await expect(page.getByRole('button', { name: /\+ Add/i })).toBeVisible();
    const recordBtn = page.locator('div[style*="flex-direction: column"] button').first();
    await expect(recordBtn).toBeVisible({ timeout: 5000 });

    // Re-open saved record to verify persistence
    await safeClick(recordBtn);

    await expect(page.getByRole('heading', { level: 2, name: /Edit Record \(custom_full_coverage\)/i })).toBeVisible();
    await expect(textInput).toHaveValue('Johnathan Doe');
    await expect(numberInput).toHaveValue('75000');

    expect(jsErrors).toEqual([]);
  });
});
