import { test, expect } from '@playwright/test';
import {
  DEMO_MASK,
  builderFieldRows,
  builderPaletteButton,
  fieldByLabel,
  gotoDemo,
  recordButton,
  safeClick,
  safeSelect,
} from './test-helpers';

test.describe('Dynamic Entity Demo E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('renders seeded client records and applies search filtering', async ({ page }) => {
    await expect(recordButton(page, 'Acme Corp')).toBeVisible();
    await expect(recordButton(page, 'Globex')).toBeVisible();

    const searchInput = page.getByPlaceholder('Search clients…');
    await searchInput.fill('Stark');

    await expect(recordButton(page, 'Stark Industries')).toBeVisible();
    await expect(recordButton(page, 'Globex')).toHaveCount(0);

    await searchInput.fill('');
    await expect(recordButton(page, 'Globex')).toBeVisible();
  });

  test('creates a client record through the dynamic form', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: '+ Add Client' }));

    await expect(page.getByRole('heading', { level: 2, name: 'New Client' })).toBeVisible();
    await expect(page.locator('ngx-dynamic-form')).toBeVisible();

    await fieldByLabel(page, 'Name').locator('input').fill('Acme Global');
    await fieldByLabel(page, 'Email').locator('input').fill('info@acmeglobal.com');
    await fieldByLabel(page, 'Company').locator('input').fill('Acme');
    await safeSelect(fieldByLabel(page, 'Status').locator('select'), 'Active');
    await fieldByLabel(page, 'Salary').locator('input').fill('185000');
    await fieldByLabel(page, 'Notes').locator('textarea').fill('New client added via Playwright E2E test.');

    await safeClick(page.getByRole('button', { name: 'Save' }));

    await expect(recordButton(page, 'Acme Global')).toBeVisible();
  });

  test('applies RBAC masking when the role changes', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'IT Support (Masked Salary)' }));
    await safeClick(recordButton(page, 'Acme Corp'));

    await expect(page.getByRole('heading', { level: 2, name: 'Edit Client' })).toBeVisible();
    await expect(fieldByLabel(page, 'Salary').locator('[data-testid$="-masked"]')).toHaveText(DEMO_MASK);

    await safeClick(page.getByRole('button', { name: /Back to List/i }));
    await safeClick(page.getByRole('button', { name: 'Admin' }));
    await safeClick(recordButton(page, 'Acme Corp'));

    await expect(fieldByLabel(page, 'Salary').locator('input')).toHaveValue('120000');
  });

  test('builder adds a text field and updates the live preview', async ({ page }) => {
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));

    const builder = page.locator('ngx-entity-builder');
    const preview = page.getByTestId('builder-preview');
    await expect(builder).toBeVisible();
    await expect(preview).toBeVisible();

    await safeClick(builderPaletteButton(page, 'Text'));

    await expect(builderFieldRows(page)).toHaveCount(1);
    await expect(preview.locator('[data-field-type]')).toContainText('Text 1');
  });
});
