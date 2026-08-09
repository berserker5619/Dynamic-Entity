import { expect, test, type Page } from '@playwright/test';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

/**
 * End-to-end coverage for the runtime features that were model-only until now:
 * entity-ref cascades, autoPatch, patchOnTrue, and the criticalField lock.
 * Driven through the seeded `orders` entity (see sample-data.ts / app.config.ts).
 */

async function openOrdersForm(page: Page): Promise<void> {
  await gotoDemo(page);
  await safeSelect(page.locator('#entitySelect'), 'orders');
  await safeClick(page.getByRole('button', { name: /Add Record/i }));
  await expect(page.locator('ngx-dynamic-form')).toBeVisible();
}

function control(page: Page, fieldId: string) {
  return page.locator(`#field-container-${fieldId}`).locator('input, select').first();
}

async function openTab(page: Page, name: string): Promise<void> {
  await safeClick(page.getByRole('tab', { name }));
}

test.describe('Runtime features — cascade, autoPatch, patchOnTrue, criticalField', () => {
  test('cascades city options from the selected country and clears a stale selection', async ({ page }) => {
    await openOrdersForm(page);
    await openTab(page, 'Delivery');

    const city = control(page, 'city');

    // No country picked yet — the child offers nothing but a placeholder.
    await expect(city.locator('option')).toHaveCount(1);
    await expect(page.locator('#field-container-city')).toContainText('Select country first');

    await safeSelect(control(page, 'country'), 'de');
    await expect(city.locator('option')).toHaveCount(3); // placeholder + Berlin + Munich
    await expect(city).toContainText('Berlin');
    await expect(city).toContainText('Munich');
    await expect(city).not.toContainText('Paris');

    await safeSelect(city, 'ber');
    await expect(city).toHaveValue('ber');

    // Switching the parent invalidates the child selection and reloads its options.
    await safeSelect(control(page, 'country'), 'fr');
    await expect(city).toHaveValue('');
    await expect(city).toContainText('Paris');
    await expect(city).not.toContainText('Berlin');
  });

  test('autoPatch copies fields from the selected company record', async ({ page }) => {
    await openOrdersForm(page);

    await expect(control(page, 'taxId')).toHaveValue('');
    await safeSelect(control(page, 'company'), 'acme');

    await expect(control(page, 'taxId')).toHaveValue('DE111111');
    await expect(control(page, 'billingCity')).toHaveValue('Berlin');

    // Re-selecting patches from the new record.
    await safeSelect(control(page, 'company'), 'globex');
    await expect(control(page, 'taxId')).toHaveValue('FR222222');
    await expect(control(page, 'billingCity')).toHaveValue('Paris');
  });

  test('patchOnTrue copies billing city into shipping on the false→true transition only', async ({ page }) => {
    await openOrdersForm(page);

    await control(page, 'billingCity').fill('Hamburg');
    await expect(control(page, 'shippingCity')).toHaveValue('');

    await safeClick(control(page, 'sameAsBilling'));
    await expect(control(page, 'shippingCity')).toHaveValue('Hamburg');

    // A later manual edit must survive further changes while the flag stays true.
    await control(page, 'shippingCity').fill('Bremen');
    await control(page, 'billingCity').fill('Cologne');
    await expect(control(page, 'shippingCity')).toHaveValue('Bremen');
  });

  test('criticalField renders locked, unlocks on demand, and announces the change', async ({ page }) => {
    await openOrdersForm(page);

    const lock = page.getByTestId('lock-iban');
    await expect(lock).toBeVisible();
    await expect(lock).toHaveAttribute('aria-pressed', 'false');

    // Locked: the field renders read-only, so there is no editable input.
    await expect(page.locator('#field-container-iban input')).toHaveCount(0);

    await safeClick(lock);
    await expect(lock).toHaveAttribute('aria-pressed', 'true');

    const iban = control(page, 'iban');
    await expect(iban).toBeEditable();

    await expect(page.getByTestId('critical-change-banner')).toHaveCount(0);
    await iban.fill('DE99999999');
    await expect(page.getByTestId('critical-change-banner')).toContainText('IBAN');
  });
});
