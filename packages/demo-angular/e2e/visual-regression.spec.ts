import { test, expect } from '@playwright/test';
import { capturePageErrors, gotoDemo, safeClick } from './test-helpers';

test.describe('Dynamic Entity E2E - Visual Regression Testing', () => {
  test('matches visual snapshot for Records List view', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    const recordList = page.locator('.record-list');
    await expect(recordList).toBeVisible();

    await page.evaluate(() => document.fonts.ready);

    await expect(recordList).toHaveScreenshot('record-list-view.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    });

    errorMonitor.assertNoErrors();
  });

  test('matches visual snapshot for Form presentation mode', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    const formWrapper = page.locator('.form-wrapper');
    await expect(formWrapper).toBeVisible();

    await page.evaluate(() => document.fonts.ready);

    await expect(formWrapper).toHaveScreenshot('form-presentation-mode.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    });

    errorMonitor.assertNoErrors();
  });

  test('matches visual snapshot for Record View mode with summary and quick-jumps', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));
    await safeClick(page.getByTestId('toggle-record-view'));

    const formWrapper = page.locator('.form-wrapper');
    await expect(formWrapper).toBeVisible();
    await expect(page.getByTestId('toggle-record-view')).toHaveClass(/nav-link--active/);

    await page.evaluate(() => document.fonts.ready);

    await expect(formWrapper).toHaveScreenshot('record-view-presentation-mode.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    });

    errorMonitor.assertNoErrors();
  });

  test('matches visual snapshot for Data Only read-only presentation mode', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));
    await safeClick(page.getByTestId('mode-data'));

    const formWrapper = page.locator('.form-wrapper');
    await expect(formWrapper).toBeVisible();
    await expect(page.getByTestId('mode-data')).toHaveClass(/nav-link--active/);

    await page.evaluate(() => document.fonts.ready);

    await expect(formWrapper).toHaveScreenshot('data-only-presentation-mode.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    });

    errorMonitor.assertNoErrors();
  });

  test('matches visual snapshot for Form Builder palette and canvas', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));

    const builderHost = page.locator('app-builder-page');
    await expect(builderHost).toBeVisible();
    await expect(page.locator('mat-toolbar')).toContainText('Entity Builder');

    await page.evaluate(() => document.fonts.ready);

    await expect(builderHost).toHaveScreenshot('builder-canvas-palette.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    });

    errorMonitor.assertNoErrors();
  });

  test('matches visual snapshot for Spreadsheet Import wizard', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Import' }));

    const importHost = page.locator('app-import-page');
    await expect(importHost).toBeVisible();

    await page.evaluate(() => document.fonts.ready);

    await expect(importHost).toHaveScreenshot('import-wizard-step1.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    });

    errorMonitor.assertNoErrors();
  });

  test('toggles theme to dark mode and back', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    const darkBtn = page.getByTestId('theme-dark');
    await safeClick(darkBtn);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const lightBtn = page.getByTestId('theme-light');
    await safeClick(lightBtn);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    errorMonitor.assertNoErrors();
  });

  test('opens live JSON inspector drawer and switches tabs', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    const inspectorBtn = page.getByTestId('json-inspector-btn');
    await safeClick(inspectorBtn);

    const drawer = page.getByTestId('json-inspector-drawer');
    await expect(drawer).toBeVisible();

    const codeContent = page.getByTestId('json-inspector-content');
    await expect(codeContent).toContainText('"entity": "clients"');

    // Switch to record tab
    await safeClick(page.getByTestId('json-tab-record'));
    await expect(page.getByTestId('json-tab-record')).toHaveClass(/json-tab-btn--active/);

    // Switch back to schema tab
    await safeClick(page.getByTestId('json-tab-schema'));
    await expect(page.getByTestId('json-tab-schema')).toHaveClass(/json-tab-btn--active/);

    // Close drawer via close button
    await safeClick(page.getByTestId('json-close-btn'));
    await expect(drawer).not.toBeVisible();

    errorMonitor.assertNoErrors();
  });
});
