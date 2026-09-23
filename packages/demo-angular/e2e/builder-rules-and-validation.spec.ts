import { test, expect } from '@playwright/test';
import { capturePageErrors, gotoDemo, safeClick } from './test-helpers';

test.describe('Dynamic Entity E2E - Form Builder Pattern Playground & Rule Dependency Graph', () => {
  test('tests validation pattern live and inspects schema dependencies in Rule Graph', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    // ─── Step 1: Open Form Builder ──────────────────────────────────────────
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await expect(page.locator('mat-toolbar')).toContainText('Entity Builder');

    // ─── Step 2: Add a Text Field (User Code) ──────────────────────────────
    const textBtn = page.locator('[data-testid^="palette-"]').filter({ hasText: 'Text' }).first();
    await textBtn.click();

    const labelInput = page.locator('[data-testid="field-label"]');
    await expect(labelInput).toBeVisible();
    await labelInput.fill('User Code');

    // ─── Step 3: Test Interactive Validation Pattern Playground ─────────────
    const playground = page.locator('[data-testid="pattern-playground"]');
    await expect(playground).toBeVisible();

    // Click Alphanumeric preset
    const alphaPreset = page.locator('[data-testid="preset-alphanumeric"]');
    await expect(alphaPreset).toBeVisible();
    await alphaPreset.click();

    const patternInput = page.locator('[data-testid="field-pattern-input"]');
    await expect(patternInput).toHaveValue('^[a-zA-Z0-9]+$');

    const testInput = page.locator('[data-testid="regex-test-input"]');
    const testStatus = page.locator('[data-testid="regex-test-status"]');

    // Test a valid matching sample
    await testInput.fill('ValidUser123');
    await expect(testStatus).toContainText('Pattern matches');

    // Test a mismatching sample (contains space and symbol)
    await testInput.fill('Invalid User !');
    await expect(testStatus).toContainText('Pattern does not match');

    // Test an invalid regex syntax
    await patternInput.fill('[');
    await expect(testStatus).toContainText('Invalid regex syntax');
    // Acknowledge the intentional library warning emitted by the live preview for invalid pattern
    expect(errorMonitor.libraryWarnings.some(w => w.includes('not a valid regular expression'))).toBe(true);
    errorMonitor.libraryWarnings.length = 0;

    // Restore valid pattern
    await patternInput.fill('^[a-zA-Z0-9]+$');
    await expect(testStatus).toContainText('Pattern does not match');
    await testInput.fill('UserCode99');
    await expect(testStatus).toContainText('Pattern matches');

    // ─── Step 4: Add a Boolean Field & Add a Rule to Target User Code ───────
    const boolBtn = page.locator('[data-testid^="palette-"]').filter({ hasText: 'Boolean' }).first();
    await boolBtn.click();

    const boolLabelInput = page.locator('[data-testid="field-label"]');
    await expect(boolLabelInput).toBeVisible();
    await boolLabelInput.fill('Require Special Code');

    // Add a rule on Require Special Code targeting User Code
    await safeClick(page.locator('summary').filter({ hasText: 'Rules' }).first());
    const addRuleBtn = page.locator('[data-testid="add-rule"]');
    await expect(addRuleBtn).toBeVisible();
    await addRuleBtn.click();

    const ruleForm = page.locator('ngx-rule-form');
    await expect(ruleForm).toBeVisible();

    // Set rule action target to User Code if available, or save rule
    await safeClick(ruleForm.getByRole('button', { name: /Save Rule/i }));

    // ─── Step 5: Check Field Inspector Dependencies Section ─────────────────
    const depsSection = page.locator('[data-testid="section-dependencies"]');
    await expect(depsSection).toBeVisible();

    // ─── Step 6: Open Rule Dependency Graph Modal ───────────────────────────
    const ruleGraphBtn = page.locator('[data-testid="builder-rule-graph"]');
    await expect(ruleGraphBtn).toBeVisible();
    await ruleGraphBtn.click();

    const graphDialog = page.locator('[data-testid="rule-graph-dialog"]');
    await expect(graphDialog).toBeVisible();
    await expect(graphDialog).toContainText('Rule & Dependency Graph');

    // Filter dependencies in dialog
    const filterInput = page.locator('[data-testid="filter-dependencies-input"]');
    await expect(filterInput).toBeVisible();
    await filterInput.fill('Special Code');

    // Close Rule Graph Modal
    const closeBtn = page.locator('[data-testid="close-rule-graph"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(graphDialog).not.toBeVisible();

    errorMonitor.assertNoErrors();
  });
});
