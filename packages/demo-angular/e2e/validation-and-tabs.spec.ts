import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fieldByLabel, gotoDemo, recordButton, safeClick } from './test-helpers';

const testDataPath = path.resolve(__dirname, '../../../test_data.json');
const rawData = fs.readFileSync(testDataPath, 'utf8');
const entityConfigs = JSON.parse(rawData);

test.describe('Dynamic Entity E2E - Validation, Roles, and Config Manager', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('validates required fields before allowing submission', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));
    await expect(page.getByRole('heading', { level: 2, name: 'New Client' })).toBeVisible();

    const saveBtn = page.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeDisabled();

    await fieldByLabel(page, 'Name').locator('input').fill('Valid Test Client');
    await expect(saveBtn).toBeEnabled();

    await safeClick(saveBtn);
    await expect(recordButton(page, 'Valid Test Client')).toBeVisible();
  });

  test('blocks saving for the viewer role, and allows it for a role with edit rights', async ({
    page,
  }) => {
    await safeClick(page.getByRole('button', { name: 'Viewer (Readonly)' }));
    await safeClick(recordButton(page, 'Acme Corp'));
    await expect(page.getByRole('heading', { level: 2, name: 'Edit Client' })).toBeVisible();

    // `permissions.edit` on the clients config excludes `viewer`, and the form drops the whole
    // actions block rather than disabling it — so Save and Reset are absent, not greyed out.
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0);
    // The record stays readable — this is a permission check, not a hidden form.
    await expect(fieldByLabel(page, 'Name').locator('input')).toHaveValue('Acme Corp');

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
    // configs from test_data.json + the seeded `orders` demo entity.
    await expect(page.locator('tbody tr')).toHaveCount(entityConfigs.length + 1);

    await page.locator('tr').filter({ hasText: 'clients' }).getByRole('button', { name: /Edit Metadata/i }).click();
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
