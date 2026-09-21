import { test, expect } from '@playwright/test';
import { capturePageErrors, fieldPart, gotoDemo, safeClick, safeSelect } from './test-helpers';

test.describe('Dynamic Entity E2E - Form Submission with Hidden Nested Required Fields', () => {
  test('successfully submits a form when required fields inside a group are hidden by rules', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    // ─── Step 1: Create Entity with Group Containing Required Fields and Visibility Rule
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));
    await expect(page.getByRole('heading', { level: 2, name: 'Manage Entities' })).toBeVisible();

    await safeClick(page.getByRole('button', { name: '+ Create New Entity' }));

    const NESTED_RULE_CONFIG = {
      entity: 'nested_rule_submit_test',
      version: 1,
      name: { en: 'Nested Rule Submit Test' },
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [
            {
              id: 'fullName',
              type: 'text',
              label: { en: 'Customer Name' },
              validators: { required: true },
              colSpan: 6,
            },
            {
              id: 'addressPreference',
              type: 'dropdown',
              label: { en: 'Address Preference' },
              options: [
                { value: 'none', label: { en: 'No Address' } },
                { value: 'provided', label: { en: 'Provide Address' } },
              ],
              colSpan: 6,
            },
            {
              id: 'addressGroup',
              type: 'group',
              label: { en: 'Address Group' },
              colSpan: 12,
              children: [
                {
                  id: 'city',
                  type: 'text',
                  label: { en: 'City' },
                  validators: { required: true },
                  colSpan: 6,
                },
                {
                  id: 'zip',
                  type: 'text',
                  label: { en: 'Postal Code' },
                  validators: { required: true },
                  colSpan: 6,
                },
              ],
            },
          ],
        },
      ],
      rules: [
        {
          id: 'rule_hide_address_group',
          formConfigId: 'nested_rule_submit_test',
          fieldId: 'addressPreference',
          enabled: true,
          priority: 1,
          conditions: [
            {
              operator: 'EQUAL',
              value: 'No Address',
              compareType: 'value',
            },
          ],
          action: {
            type: 'visibility',
            value: false,
          },
          targets: [
            {
              id: 'addressGroup',
              type: 'field',
            },
          ],
        },
      ],
    };

    const configTextarea = page.locator('textarea').first();
    await configTextarea.fill(JSON.stringify(NESTED_RULE_CONFIG, null, 2));
    await safeClick(page.getByRole('button', { name: 'Save Config' }));

    // Verify entity created
    await expect(page.locator('#entitySelect option[value="nested_rule_submit_test"]')).toBeAttached();

    // ─── Step 2: Navigate to list view & click + Add Record ────────────────
    await safeClick(page.getByRole('button', { name: 'Clients Data' }));
    await safeClick(page.getByRole('button', { name: /\+ Add/i }));
    await expect(page.getByRole('heading', { level: 2, name: /New Record \(nested_rule_submit_test\)/i })).toBeVisible();

    // ─── Step 3: Trigger rule to hide address group ────────────────────────
    await fieldPart(page, 'fullName', 'input').fill('Jane Doe');
    await safeSelect(fieldPart(page, 'addressPreference', 'input'), 'No Address');

    // Verify addressGroup is hidden
    await expect(page.locator('[data-testid="field-addressGroup"]')).toHaveCount(0);

    // ─── Step 4: Submit form with hidden nested required fields ─────────────
    // If the library fails to disable controls for hidden children, form.invalid remains true
    // and submission is blocked.
    const saveBtn = page.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeEnabled();
    await safeClick(saveBtn);

    // Verify record saved successfully and returned to list view
    await expect(page.getByRole('button', { name: /\+ Add/i })).toBeVisible();
    const recordCard = page.locator('.record-list .record-card').first();
    await expect(recordCard).toBeVisible({ timeout: 5000 });
    await expect(recordCard).toContainText('Jane Doe');

    // ─── Step 5: Edit record, show address group, and verify validation ─────
    await safeClick(recordCard);
    await expect(page.getByRole('heading', { level: 2, name: /Edit Record \(nested_rule_submit_test\)/i })).toBeVisible();

    // Switch to 'Provide Address'
    await safeSelect(fieldPart(page, 'addressPreference', 'input'), 'Provide Address');

    // Group becomes visible
    await expect(page.locator('[data-testid="field-addressGroup"]')).toBeVisible();

    // Fill required nested fields
    await fieldPart(page, 'city', 'input').fill('Chicago');
    await fieldPart(page, 'zip', 'input').fill('60601');

    await safeClick(saveBtn);
    await expect(page.getByRole('button', { name: /\+ Add/i })).toBeVisible();

    errorMonitor.assertNoErrors();
  });
});
