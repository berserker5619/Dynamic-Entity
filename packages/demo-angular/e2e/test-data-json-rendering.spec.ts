import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Dynamic Entity E2E - Rendering test_data.json Configurations', () => {
  const testDataPath = path.resolve(__dirname, '../../../test_data.json');
  const rawData = fs.readFileSync(testDataPath, 'utf8');
  const entityConfigs = JSON.parse(rawData);

  test('validates and parses all 12 real-world entity configs', () => {
    expect(Array.isArray(entityConfigs)).toBe(true);
    expect(entityConfigs.length).toBe(12);

    const entities = entityConfigs.map((c: any) => c.entity);
    expect(entities).toEqual([
      'individuals',
      'organizations',
      'clients',
      'payerProfiles',
      'visitNotes',
      'student',
      'patientDetailsForm',
      'expence',
      'employees',
      'deals',
      'connections',
      'nizamKT',
    ]);
  });

  test('renders form configurations without any issues or errors', async ({ page }) => {
    // Listen for uncaught JS errors
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/');
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));
    await expect(page.getByRole('heading', { level: 2, name: 'Manage Entities' })).toBeVisible();

    // Verify all 12 entities are listed in Entity Manager table
    const tableRows = page.locator('tbody tr');
    await expect(tableRows).toHaveCount(12);

    // Verify no page errors occurred
    expect(errors).toEqual([]);
  });
});

async function safeClick(locator: any): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 5000 });
  await locator.click();
}
