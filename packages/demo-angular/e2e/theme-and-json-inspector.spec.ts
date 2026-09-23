import { test, expect } from '@playwright/test';
import { gotoDemo, recordButton, safeClick } from './test-helpers';

test.describe('Theme Switcher & Live JSON Inspector', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await gotoDemo(page);
  });

  test.describe('Dark Mode Theme Switcher', () => {
    test('toggles light, dark, and auto modes and updates DOM attribute and localStorage', async ({ page }) => {
      const darkBtn = page.getByTestId('theme-dark');
      const lightBtn = page.getByTestId('theme-light');
      const autoBtn = page.getByTestId('theme-auto');

      // 1. Switch to Dark
      await safeClick(darkBtn);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(darkBtn).toHaveClass(/role-btn--active/);
      await expect(darkBtn).toHaveAttribute('aria-pressed', 'true');

      let savedTheme = await page.evaluate(() => localStorage.getItem('demo-theme'));
      expect(savedTheme).toBe('dark');

      // 2. Reload and verify dark mode persistence
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByTestId('theme-dark')).toHaveClass(/role-btn--active/);

      // 3. Switch to Light
      await safeClick(page.getByTestId('theme-light'));
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(lightBtn).toHaveClass(/role-btn--active/);
      await expect(lightBtn).toHaveAttribute('aria-pressed', 'true');

      savedTheme = await page.evaluate(() => localStorage.getItem('demo-theme'));
      expect(savedTheme).toBe('light');

      // 4. Switch to Auto and test OS preference emulation
      await safeClick(page.getByTestId('theme-auto'));
      await expect(autoBtn).toHaveClass(/role-btn--active/);
      await expect(autoBtn).toHaveAttribute('aria-pressed', 'true');

      savedTheme = await page.evaluate(() => localStorage.getItem('demo-theme'));
      expect(savedTheme).toBe('auto');

      // Emulate OS dark preference
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

      // Emulate OS light preference
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    });
  });

  test.describe('Live JSON Inspector Drawer', () => {
    test('opens and closes drawer via toggle button, close button, backdrop, and Escape key', async ({ page }) => {
      const inspectorBtn = page.getByTestId('json-inspector-btn');
      const drawer = page.getByTestId('json-inspector-drawer');
      const closeBtn = page.getByTestId('json-close-btn');

      // Initial state: drawer hidden
      await expect(drawer).toHaveCount(0);

      // Open via header button
      await safeClick(inspectorBtn);
      await expect(drawer).toBeVisible();

      // Close via close button (✕)
      await safeClick(closeBtn);
      await expect(drawer).toHaveCount(0);

      // Re-open and close via Escape key
      await safeClick(inspectorBtn);
      await expect(drawer).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);

      // Re-open and close via backdrop click (click in the exposed margin to the left of the drawer)
      await safeClick(inspectorBtn);
      await expect(drawer).toBeVisible();
      await page.getByTestId('json-inspector-backdrop').click({ position: { x: 5, y: 50 } });
      await expect(drawer).toHaveCount(0);
    });

    test('displays formatted entity schema and switches to record data', async ({ page }) => {
      const inspectorBtn = page.getByTestId('json-inspector-btn');
      const schemaTab = page.getByTestId('json-tab-schema');
      const recordTab = page.getByTestId('json-tab-record');
      const content = page.getByTestId('json-inspector-content');

      // Open inspector on list view (no record selected)
      await safeClick(inspectorBtn);
      await expect(page.getByTestId('json-inspector-drawer')).toBeVisible();

      // Entity Schema is default tab
      await expect(schemaTab).toHaveClass(/json-tab-btn--active/);
      const schemaText = await content.textContent();
      expect(schemaText).toContain('"entity": "clients"');
      expect(schemaText).toContain('"tabs"');

      // Verify it parses as valid JSON
      const parsedSchema = JSON.parse(schemaText || '{}');
      expect(parsedSchema.entity).toBe('clients');

      // Switch to Record Data tab (currently none selected)
      await safeClick(recordTab);
      await expect(recordTab).toHaveClass(/json-tab-btn--active/);
      const emptyRecordText = await content.textContent();
      expect(emptyRecordText?.trim()).toBe('{}');

      // Close inspector
      await safeClick(page.getByTestId('json-close-btn'));

      // Open a record ('Acme Corp')
      await safeClick(recordButton(page, 'Acme Corp'));
      await expect(page.getByRole('heading', { level: 2, name: 'Edit Client' })).toBeVisible();

      // Open inspector again
      await safeClick(inspectorBtn);
      await expect(page.getByTestId('json-inspector-drawer')).toBeVisible();

      // Switch to Record Data tab
      await safeClick(recordTab);
      const recordText = await content.textContent();
      expect(recordText).toContain('Acme Corp');

      const parsedRecord = JSON.parse(recordText || '{}');
      expect(parsedRecord.name).toBe('Acme Corp');
    });

    test('provides copy-to-clipboard action with visual confirmation feedback', async ({ page }) => {
      const inspectorBtn = page.getByTestId('json-inspector-btn');
      const copyBtn = page.getByTestId('json-copy-btn');

      await safeClick(inspectorBtn);
      await expect(page.getByTestId('json-inspector-drawer')).toBeVisible();

      await expect(copyBtn).toContainText('📋 Copy');
      await safeClick(copyBtn);

      // Verify visual confirmation feedback
      await expect(copyBtn).toContainText('✓ Copied!');

      // Check clipboard content if browser allows readText
      const clipboardText = await page.evaluate(async () => {
        try {
          return await navigator.clipboard.readText();
        } catch {
          return null;
        }
      });

      if (clipboardText) {
        const parsed = JSON.parse(clipboardText);
        expect(parsed.entity).toBe('clients');
      }
    });

    test('triggers JSON download with entity-specific filename', async ({ page }) => {
      const inspectorBtn = page.getByTestId('json-inspector-btn');
      const downloadBtn = page.getByTestId('json-download-btn');

      await safeClick(inspectorBtn);
      await expect(page.getByTestId('json-inspector-drawer')).toBeVisible();

      // Expect download event
      const downloadPromise = page.waitForEvent('download');
      await safeClick(downloadBtn);
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toBe('clients-config.json');
    });
  });
});
