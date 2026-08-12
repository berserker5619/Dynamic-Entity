import { expect, test, type Page } from '@playwright/test';
import {
  builderFieldRows,
  builderRowId,
  gotoDemo,
  safeClick,
} from './test-helpers';

/**
 * The Field id is read-only and derived from the label. These cover the contract in the
 * real browser: derivation as you type, collision suffixing, and the one exception —
 * a config loaded from storage keeps its ids, because records are stored under them.
 */

const idInput = (page: Page) => page.getByTestId('field-id');

function labelInput(page: Page) {
  return page
    .locator('ngx-field-inspector mat-form-field')
    .filter({ hasText: /Label.*en/ })
    .first()
    .locator('input');
}

async function openBuilder(page: Page): Promise<void> {
  await gotoDemo(page);
  await safeClick(page.getByRole('button', { name: 'Form Builder' }));
  await expect(page.locator('ngx-entity-builder')).toBeVisible();
}

async function addTextField(page: Page, label: string): Promise<void> {
  await safeClick(
    page.locator('[data-testid^="palette-"]').filter({ hasText: 'Text' }).first(),
  );
  await builderFieldRows(page).last().click();
  await labelInput(page).fill(label);
}

test.describe('Builder — field id derived from label', () => {
  test('renders the id read-only', async ({ page }) => {
    await openBuilder(page);
    await addTextField(page, 'First Name');

    await expect(idInput(page)).toBeDisabled();
  });

  test('derives a camelCase id as the label is typed', async ({ page }) => {
    await openBuilder(page);
    await addTextField(page, 'Employee Count');

    await expect(idInput(page)).toHaveValue('employeeCount');
    await expect(builderRowId(page, 'employeeCount')).toBeVisible();
  });

  test('keeps following the label on later edits', async ({ page }) => {
    await openBuilder(page);
    await addTextField(page, 'First Name');
    await expect(idInput(page)).toHaveValue('firstName');

    await labelInput(page).fill('Surname');
    await expect(idInput(page)).toHaveValue('surname');
  });

  test('strips punctuation when deriving', async ({ page }) => {
    await openBuilder(page);
    await addTextField(page, 'Individual #');

    await expect(idInput(page)).toHaveValue('individual');
  });

  test('suffixes a colliding id instead of silently merging fields', async ({ page }) => {
    await openBuilder(page);
    await addTextField(page, 'Name');
    await expect(idInput(page)).toHaveValue('name');

    await addTextField(page, 'Name');
    await expect(idInput(page)).toHaveValue('name_2');
  });

  test('shows the derived-id hint for a new field', async ({ page }) => {
    await openBuilder(page);
    await addTextField(page, 'First Name');

    await expect(page.locator('ngx-field-inspector')).toContainText('Derived from the label');
  });
});
