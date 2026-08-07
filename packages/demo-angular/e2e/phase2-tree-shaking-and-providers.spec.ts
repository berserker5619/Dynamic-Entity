import { test, expect } from '@playwright/test';
import { gotoDemo, safeClick } from './test-helpers';

test.describe('Dynamic Entity E2E - Phase 2 Packaging, Providers & Registration', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('switches views seamlessly between Clients Data, Entity Manager, and Form Builder', async ({ page }) => {
    // Navigate to Entity Manager
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));
    await expect(page.getByRole('heading', { level: 2, name: 'Manage Entities' })).toBeVisible();

    // Navigate to Form Builder
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await expect(page.locator('ngx-entity-builder')).toBeVisible();

    // Navigate back to Clients Data
    await safeClick(page.getByRole('button', { name: 'Clients Data' }));
    await expect(page.getByPlaceholder('Search clients…')).toBeVisible();
  });
});
