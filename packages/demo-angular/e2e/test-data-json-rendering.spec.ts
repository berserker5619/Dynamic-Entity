import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FIELD_TYPE_CATALOG } from '@dynamic-entity/core';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

test.describe('Dynamic Entity E2E - Rendering test_data.json Configurations', () => {
  const testDataPath = path.resolve(__dirname, '../../../test_data.json');
  const rawData = fs.readFileSync(testDataPath, 'utf8');
  const entityConfigs = JSON.parse(rawData);

  test('validates and parses all entity configs in test_data.json', () => {
    expect(Array.isArray(entityConfigs)).toBe(true);
    expect(entityConfigs.length).toBeGreaterThan(0);

    const entities = entityConfigs.map((c: any) => c.entity);
    expect(entities.length).toBe(entityConfigs.length);
  });

  /**
   * Every field type in the reference dataset must exist in the catalog.
   *
   * This dataset shipped for a long time using `time`, `entityRef` and `referencedField`,
   * none of which are field types — the renderer skipped all three and warned to the
   * console, while the browser test below still passed because it only watched for
   * uncaught exceptions. A static check fails in milliseconds and needs no browser.
   */
  test('uses only field types the catalog defines', () => {
    const valid = new Set(FIELD_TYPE_CATALOG.map(m => m.type as string));
    const offenders: string[] = [];

    const walkFields = (fields: any[] | undefined, entity: string) => {
      for (const f of fields ?? []) {
        if (f?.type && !valid.has(f.type)) offenders.push(`${entity}.${f.id} -> "${f.type}"`);
        walkFields(f?.children, entity);
      }
    };
    const walkTabs = (tabs: any[] | undefined, entity: string) => {
      for (const t of tabs ?? []) {
        walkFields(t?.fields, entity);
        walkTabs(t?.children, entity);
      }
    };
    for (const cfg of entityConfigs) walkTabs(cfg?.tabs, cfg?.entity);

    expect(offenders).toEqual([]);
  });

  test('renders Entity Manager table with test_data.json entities', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));
    await expect(page.getByRole('heading', { level: 2, name: 'Manage Entities' })).toBeVisible();

    for (const cfg of entityConfigs) {
      await expect(page.getByRole('cell', { name: cfg.entity })).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  for (const cfg of entityConfigs) {
    test(`renders entity form and switches tabs without JS errors for "${cfg.entity}"`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', err => errors.push(err.message));

      // A field type with no registered component renders nothing and reports it as a
      // console warning, not an exception — so watching pageerror alone let three dead
      // fields pass unnoticed. Treat the library's own diagnostics as failures.
      const libraryWarnings: string[] = [];
      page.on('console', msg => {
        if (msg.type() !== 'warning' && msg.type() !== 'error') return;
        const text = msg.text();
        if (text.includes('[ngx-dynamic-entity]')) libraryWarnings.push(text);
      });

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

          // A tab that declares its own fields must actually render controls. Switching
          // tabs cleanly over an empty panel is not evidence that anything rendered.
          if ((tab.fields ?? []).length > 0 && !tab.moduleName) {
            await expect(page.locator('[data-testid="form-panel"] ngx-dynamic-field').first())
              .toBeVisible();
          }
        }
      }

      expect(errors).toEqual([]);
      expect(libraryWarnings).toEqual([]);
    });
  }
});
