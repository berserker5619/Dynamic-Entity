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

  test('matches visual snapshot for Dark Mode Records List view', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    await safeClick(page.getByTestId('theme-dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const recordList = page.locator('.record-list');
    await expect(recordList).toBeVisible();

    await page.evaluate(() => document.fonts.ready);

    await expect(recordList).toHaveScreenshot('dark-mode-record-list.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    });

    errorMonitor.assertNoErrors();
  });

  test('matches visual snapshot for Dark Mode Form view', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    await safeClick(page.getByTestId('theme-dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await safeClick(page.getByRole('button', { name: '+ Add Client' }));
    const formWrapper = page.locator('.form-wrapper');
    await expect(formWrapper).toBeVisible();

    await page.evaluate(() => document.fonts.ready);

    await expect(formWrapper).toHaveScreenshot('dark-mode-form.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    });

    errorMonitor.assertNoErrors();
  });

  test('matches visual snapshot for Live JSON Inspector drawer', async ({ page }) => {
    test.setTimeout(60000);
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);
    await safeClick(page.getByTestId('json-inspector-btn'));
    const drawer = page.getByTestId('json-inspector-drawer');
    await expect(drawer).toBeVisible();

    await page.evaluate(() => document.fonts.ready);

    await expect(drawer).toHaveScreenshot('json-inspector-drawer.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    });

    errorMonitor.assertNoErrors();
  });
});
