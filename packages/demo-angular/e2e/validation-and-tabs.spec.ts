import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fieldByLabel, fieldPart, gotoDemo, recordButton, safeClick } from './test-helpers';

const testDataPath = path.resolve(__dirname, '../../../test_data.json');
const rawData = fs.readFileSync(testDataPath, 'utf8');
const entityConfigs = JSON.parse(rawData);

test.describe('Dynamic Entity E2E - Validation, Roles, and Config Manager', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  /**
   * Save stays clickable while a required field is empty, and refuses.
   *
   * It used to be disabled, which is a worse answer than a refusal: a greyed button cannot
   * say which field is missing, and on a tabbed form that field is usually not the one on
   * screen. Pressing it now names the count, lists the field as a link that jumps to it, and
   * badges the tab holding it — all of which is asserted here, because "the save was blocked"
   * is only half the requirement. The other half is that the user can tell why.
   */
  test('refuses the save and names the missing field', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));
    await expect(page.getByRole('heading', { level: 2, name: 'New Client' })).toBeVisible();

    const saveBtn = page.getByRole('button', { name: 'Save' });
    await safeClick(saveBtn);

    await expect(page.getByTestId('error-summary')).toBeVisible();
    await expect(page.getByTestId('error-summary-heading')).toContainText('1 field');
    await expect(page.getByTestId('error-summary-name')).toContainText('Name');
    await expect(page.getByTestId('error-summary-name')).toContainText('This field is required.');
    await expect(page.getByTestId('tab-errors-general')).toHaveText('1');
    // Nothing was written: still on the form.
    await expect(page.getByRole('heading', { level: 2, name: 'New Client' })).toBeVisible();

    await fieldByLabel(page, 'Name').locator('input').fill('Valid Test Client');
    await expect(page.getByTestId('error-summary')).toBeHidden();

    await safeClick(saveBtn);
    await expect(recordButton(page, 'Valid Test Client')).toBeVisible();
  });

  test('blocks saving for the viewer role, and allows it for a role with edit rights', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Viewer (Readonly)' }));
    await safeClick(recordButton(page, 'Acme Corp'));
    await expect(page.getByRole('heading', { level: 2, name: 'Edit Client' })).toBeVisible();

    // `permissions.edit` on the clients config excludes `viewer`, and the form drops the whole
    // actions block rather than disabling it — so Save and Reset are absent, not greyed out.
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0);
    // The record stays readable — this is a permission check, not a hidden form. It is
    // readable as text, not as a filled-in input: `permissions.edit` used to gate the Save
    // button alone, so a viewer got editable fields and only discovered the record was not
    // theirs to change after typing into it.
    await expect(fieldPart(page, 'name', 'value')).toHaveText('Acme Corp');
    await expect(fieldByLabel(page, 'Name').locator('input')).toHaveCount(0);

    // The same record, as a role that may edit: Save is live. Asserting both halves is what
    // stops this passing for the wrong reason — a Save button disabled by a validation bug
    // would otherwise look like a working permission check.
    await safeClick(page.getByRole('button', { name: /Back to List/i }));
    // Exact: "Entity Manager" in the nav also contains "Manager".
    await safeClick(page.getByRole('button', { name: 'Manager', exact: true }));
    await safeClick(recordButton(page, 'Acme Corp'));

    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('edits config metadata and increments the version', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));

    await expect(page.getByRole('heading', { level: 2, name: 'Manage Entities' })).toBeVisible();
    // The seven configs from test_data.json, plus the two entities the demo seeds itself:
    // `orders` (entity-ref loaders and autoPatch) and `extensions` (the extension points
    // that need schema support). Counted rather than listed so a config added to
    // test_data.json is picked up here without an edit.
    await expect(page.locator('tbody tr')).toHaveCount(entityConfigs.length + 2);

    await page
      .locator('tr')
      .filter({ hasText: 'clients' })
      .getByRole('button', { name: /Edit Metadata/i })
      .click();
    await expect(page.getByRole('heading', { level: 3, name: /Edit Config: clients/i })).toBeVisible();

    const textarea = page.locator('textarea').first();
    const originalConfig = JSON.parse(await textarea.inputValue());
    originalConfig.name = { en: 'Clients Directory' };
    await textarea.fill(JSON.stringify(originalConfig, null, 2));

    await safeClick(page.getByRole('button', { name: 'Save Config' }));
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));

    const clientsRow = page.locator('tbody tr').filter({ hasText: 'clients' });
    await expect(clientsRow).toContainText('2');
  });
});
