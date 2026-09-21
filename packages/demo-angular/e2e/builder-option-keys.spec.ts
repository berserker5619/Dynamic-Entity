import { test, expect } from '@playwright/test';
import { capturePageErrors, gotoDemo, safeClick } from './test-helpers';

test.describe('Dynamic Entity E2E - Form Builder Stable Option Keys ($key)', () => {
  test('assigns stable $key on new options and updates unkeyed configs via toolbar', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    // ─── Step 1: Open Form Builder ──────────────────────────────────────────
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await expect(page.locator('mat-toolbar')).toContainText('Entity Builder');

    // Name the entity
    const entityInput = page.locator('mat-form-field').filter({ hasText: 'Entity name' }).first().locator('input');
    await expect(entityInput).toBeVisible();
    await entityInput.fill('option_key_test');

    // Add a Dropdown field
    const dropdownBtn = page.locator('[data-testid^="palette-"]').filter({ hasText: 'Dropdown' }).first();
    await dropdownBtn.click();

    // Verify Dropdown field is selected and inspector is open
    await expect(page.locator('[data-testid="field-id"]')).toBeVisible();

    // In Options section, add two options
    const addOptionBtn = page.locator('[data-testid="add-option"]');
    await expect(addOptionBtn).toBeVisible();
    await addOptionBtn.click();
    const opt0Input = page.locator('[data-testid="option-0"]');
    await expect(opt0Input).toBeVisible();
    await opt0Input.fill('Gold Tier');

    await addOptionBtn.click();
    const opt1Input = page.locator('[data-testid="option-1"]');
    await expect(opt1Input).toBeVisible();
    await opt1Input.fill('Silver Tier');

    // Since options added via builder are minted with stable keys, "assign-option-keys" should not be visible
    await expect(page.locator('[data-testid="assign-option-keys"]')).toHaveCount(0);

    // ─── Step 2: Load an unkeyed config via Entity Manager ─────────────────
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));
    await expect(page.getByRole('heading', { level: 2, name: 'Manage Entities' })).toBeVisible();

    await safeClick(page.getByRole('button', { name: '+ Create New Entity' }));
    const UNKEYED_CONFIG = {
      entity: 'legacy_unkeyed_options',
      version: 1,
      name: { en: 'Legacy Unkeyed Options' },
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [
            {
              id: 'planType',
              type: 'dropdown',
              label: { en: 'Plan Type' },
              options: [
                { value: 'basic', label: { en: 'Basic Plan' } },
                { value: 'pro', label: { en: 'Pro Plan' } },
              ],
            },
          ],
        },
      ],
    };

    const configTextarea = page.locator('textarea').first();
    await configTextarea.fill(JSON.stringify(UNKEYED_CONFIG, null, 2));
    await safeClick(page.getByRole('button', { name: 'Save Config' }));

    // Verify persisted
    await expect(page.locator('#entitySelect option[value="legacy_unkeyed_options"]')).toBeAttached();

    // ─── Step 3: Open unkeyed config in Form Builder ──────────────────────
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await expect(page.locator('mat-toolbar')).toContainText('Entity Builder');

    // Load the legacy_unkeyed_options entity into the builder
    await page.locator('#builderEntitySelect').selectOption('legacy_unkeyed_options');

    // Select the Dropdown field on the canvas to inspect it
    const fieldRow = page.locator('[data-testid="builder-field-row"]').filter({ hasText: 'Plan Type' }).first();
    await expect(fieldRow).toBeVisible();
    await fieldRow.click();

    // Verify "Assign stable keys" button appears because legacy options lack $key
    const assignBtn = page.locator('[data-testid="assign-option-keys"]');
    await expect(assignBtn).toBeVisible();

    // Click "Assign stable keys"
    await assignBtn.click();

    // Verify "Assign stable keys" button disappears once keys are assigned
    await expect(assignBtn).toHaveCount(0);

    // Save the upgraded config
    const saveBtn = page.locator('mat-toolbar button').filter({ hasText: 'Save' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(page.getByTestId('builder-toast')).toBeVisible();

    errorMonitor.assertNoErrors();
  });
});
