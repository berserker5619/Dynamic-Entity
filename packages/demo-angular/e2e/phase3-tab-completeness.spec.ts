import { test, expect } from '@playwright/test';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

test.describe('Dynamic Entity E2E - Phase 3 Tab Model Completeness', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('renders consumer module tab registered in COMMON_MODULES_REGISTRY', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));
    await expect(page.getByRole('heading', { level: 2, name: 'New Client' })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'General' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Documents' })).toBeVisible();

    await safeClick(page.getByRole('tab', { name: 'Documents' }));
    await expect(page.getByTestId('sample-module-tab')).toBeVisible();
    await expect(page.getByText('Consumer Custom Module Tab')).toBeVisible();
  });
});
