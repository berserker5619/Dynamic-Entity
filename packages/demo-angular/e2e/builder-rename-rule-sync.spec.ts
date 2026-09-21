import { test, expect } from '@playwright/test';
import { capturePageErrors, gotoDemo, safeClick } from './test-helpers';

test.describe('Dynamic Entity E2E - Form Builder Field Rename Updates Rule Paths', () => {
  test('updates bracketed rule trigger and target paths when field label derives a new id', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    // ─── Step 1: Open Form Builder ──────────────────────────────────────────
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await expect(page.locator('mat-toolbar')).toContainText('Entity Builder');

    // Name the entity
    const entityInput = page.locator('mat-form-field').filter({ hasText: 'Entity name' }).first().locator('input');
    await expect(entityInput).toBeVisible();
    await entityInput.fill('builder_rule_sync_test');

    // ─── Step 2: Add a Text Field & Set Initial Label ──────────────────────
    const textBtn = page.locator('[data-testid^="palette-"]').filter({ hasText: 'Text' }).first();
    await textBtn.click();

    // Verify Inspector is open on the new field
    const fieldIdInput = page.locator('[data-testid="field-id"]');
    await expect(fieldIdInput).toBeVisible();

    const labelInput = page.locator('[data-testid="field-label"]');
    await expect(labelInput).toBeVisible();
    await labelInput.fill('Customer Email');

    // The field id derives automatically from label
    await expect(fieldIdInput).toHaveValue('customerEmail');

    // ─── Step 3: Expand Rules Section & Add a Rule Attached to this Field ───
    await safeClick(page.locator('summary').filter({ hasText: 'Rules' }));

    const addRuleBtn = page.locator('[data-testid="add-rule"]');
    await expect(addRuleBtn).toBeVisible();
    await addRuleBtn.click();

    // In the rule form, verify the trigger field defaulted to the bracketed path
    const ruleForm = page.locator('ngx-rule-form');
    await expect(ruleForm).toBeVisible();
    await expect(ruleForm.locator('[data-testid="rule-trigger"]')).toContainText('customerEmail');

    // Set a condition value
    const condValueInput = ruleForm.getByRole('textbox', { name: 'Value', exact: true });
    await condValueInput.fill('vip@example.com');

    // Save the rule
    await safeClick(ruleForm.getByRole('button', { name: /Save Rule/i }));

    // Verify rule item appears in the list with the bracketed path
    const ruleSummary = page.locator('[data-testid="rule-item"] .deb-rule-item__summary');
    await expect(ruleSummary).toBeVisible();
    await expect(ruleSummary).toContainText('customerEmail');
    await expect(ruleSummary).toContainText('vip@example.com');

    // ─── Step 4: Rename the Field by Changing its Label ─────────────────────
    // Changing the label from 'Customer Email' to 'Billing Contact' derives the new id 'billingContact'
    await labelInput.fill('Billing Contact');
    await expect(fieldIdInput).toHaveValue('billingContact');

    // Verify the rule summary synchronized its path to billingContact
    await expect(ruleSummary).toContainText('billingContact');
    await expect(ruleSummary).not.toContainText('customerEmail');

    // ─── Step 5: Save Config in Toolbar ─────────────────────────────────────
    const saveBtn = page.locator('mat-toolbar button').filter({ hasText: 'Save' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(page.getByTestId('builder-toast')).toBeVisible();

    errorMonitor.assertNoErrors();
  });
});
