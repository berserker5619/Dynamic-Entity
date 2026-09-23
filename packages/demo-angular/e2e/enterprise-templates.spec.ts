import { test, expect } from '@playwright/test';
import { fieldById, gotoDemo, recordButton, safeClick, safeSelect } from './test-helpers';

test.describe('Enterprise Entity Templates (Healthcare & IT Assets)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('loads and navigates Patient Intake clinical triage entity and multi-tab records', async ({ page }) => {
    const entitySelect = page.locator('#entitySelect');
    await safeSelect(entitySelect, 'patientIntake');

    // Wait for the records list to update for patientIntake
    await expect(recordButton(page, 'Eleanor Vance')).toBeVisible();
    await expect(recordButton(page, 'Marcus Sterling')).toBeVisible();
    await expect(recordButton(page, 'Amara Chen')).toBeVisible();

    // Open Eleanor Vance record
    await safeClick(recordButton(page, 'Eleanor Vance'));
    await expect(page.getByRole('heading', { level: 2, name: /Edit Record \(patientIntake\)/i })).toBeVisible();

    // Verify Tab 1: Demographics & Vitals
    await expect(fieldById(page, 'fullName').locator('input')).toHaveValue('Eleanor Vance');
    await expect(fieldById(page, 'dateOfBirth').locator('input')).toHaveValue('1984-06-12');

    // Navigate to Tab 2: Clinical History & Allergies
    const historyTabBtn = page.getByRole('tab', { name: /Clinical History & Allergies/i });
    await expect(historyTabBtn).toBeVisible();
    await safeClick(historyTabBtn);

    // Verify Tab 2 is active and allergy details textarea has seeded notes
    await expect(historyTabBtn).toHaveAttribute('aria-selected', 'true');
    await expect(fieldById(page, 'allergyDetails').locator('textarea')).toHaveValue(/Penicillin/);

    // Return to list
    await safeClick(page.getByRole('button', { name: /Back to List/i }));
    await expect(recordButton(page, 'Eleanor Vance')).toBeVisible();
  });

  test('loads and navigates IT Assets fleet lifecycle entity with decommission audit data', async ({ page }) => {
    const entitySelect = page.locator('#entitySelect');
    await safeSelect(entitySelect, 'itAssets');

    // Verify seeded IT assets appear in table/card list
    await expect(recordButton(page, 'AST-10492')).toBeVisible();
    await expect(recordButton(page, 'AST-10884')).toBeVisible();
    await expect(recordButton(page, 'AST-09142')).toBeVisible();

    // Open retired asset AST-09142
    await safeClick(recordButton(page, 'AST-09142'));
    await expect(page.getByRole('heading', { level: 2, name: /Edit Record \(itAssets\)/i })).toBeVisible();

    // Verify Tab 1 hardware fields
    await expect(fieldById(page, 'assetTag').locator('input')).toHaveValue('AST-09142');
    await expect(fieldById(page, 'modelName').locator('input')).toHaveValue('ThinkPad X1 Carbon Gen 10');

    // Navigate to Tab 3: Decommissioning & Data Sanitization
    const decommissionTabBtn = page.getByRole('tab', { name: /Decommissioning & Data Sanitization/i });
    await expect(decommissionTabBtn).toBeVisible();
    await safeClick(decommissionTabBtn);

    await expect(decommissionTabBtn).toHaveAttribute('aria-selected', 'true');
    await expect(fieldById(page, 'retirementNotes').locator('textarea')).toHaveValue(/NIST/);
  });
});
