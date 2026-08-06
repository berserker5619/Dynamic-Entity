import { test, expect } from '@playwright/test';
import { fieldByLabel, gotoDemo, recordButton } from './test-helpers';

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

  test('enforces readonly mode for viewer role', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Viewer (Readonly)' }));
    await safeClick(recordButton(page, 'Acme Corp'));

    await expect(page.getByRole('heading', { level: 2, name: 'Edit Client' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Back to List/i })).toBeVisible();
  });

  test('edits config metadata and increments the version', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));

    await expect(page.getByRole('heading', { level: 2, name: 'Manage Entities' })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(2);

    await safeClick(page.getByRole('button', { name: /Edit Metadata/i }).first());
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
