import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

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

  test('renders Entity Manager table with all 12 test_data.json entities', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));
    await expect(page.getByRole('heading', { level: 2, name: 'Manage Entities' })).toBeVisible();

    await expect(page.getByRole('cell', { name: 'visitNotes' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'organizations' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'individuals' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  for (const cfg of entityConfigs) {
    test(`renders entity form and switches tabs without JS errors for "${cfg.entity}"`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', err => errors.push(err.message));

      await gotoDemo(page);
      const entitySelect = page.locator('#entitySelect');
      await safeSelect(entitySelect, cfg.entity);

      await safeClick(page.getByRole('button', { name: /Add/i }));

      // Check each visible tab in the config
      const visibleTabs = (cfg.tabs || []).filter((t: any) => t.visibility !== false);
      for (const tab of visibleTabs) {
        const tabName = tab.label ? (tab.label['en'] || Object.values(tab.label)[0]) : tab.id;
        const tabButton = page.getByRole('tab', { name: String(tabName) });
        if (await tabButton.isVisible()) {
          await safeClick(tabButton);
          await expect(tabButton).toHaveAttribute('aria-selected', 'true');
        }
      }

      expect(errors).toEqual([]);
    });
  }
});
