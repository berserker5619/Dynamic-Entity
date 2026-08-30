import { expect, test } from '@playwright/test';
import { fieldById, fieldPart, gotoDemo, recordButton, safeClick, safeFill, safeSelect } from './test-helpers';

/**
 * Field ids are unique per scope, not across a config. `people` has an `address` on Personal
 * Details and another on Work Details — two different fields that nest as
 * `{ personal: { address }, work: { address } }`.
 *
 * The runtime always supported this; only `validateConfig` refused such a config. These specs
 * hold the whole path down: both render, both keep their own value, and a `showWhen` that
 * names one of them by path watches that one and not the other.
 */
test.describe('two fields sharing an id', () => {
  async function openPeople(page: import('@playwright/test').Page): Promise<void> {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'people');
    await safeClick(page.getByRole('button', { name: /^\+ Add/ }));
    await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();
  }

  const tab = (page: import('@playwright/test').Page, name: string) =>
    page.getByRole('tab', { name: new RegExp(name, 'i') });

  test('each address keeps its own value across a save and reload', async ({ page }) => {
    await openPeople(page);

    await safeFill(fieldPart(page, 'fullName', 'input'), 'Ada Lovelace');
    await safeFill(fieldPart(page, 'address', 'input'), 'Home Street 1');

    await safeClick(tab(page, 'Work Details'));
    await safeFill(fieldPart(page, 'address', 'input'), 'Office Road 2');

    await safeClick(page.getByRole('button', { name: /^Save$/i }));
    await safeClick(recordButton(page, 'Ada Lovelace'));
    await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();

    // The two addresses must not have collapsed into one another.
    await expect(fieldPart(page, 'address', 'input')).toHaveValue('Home Street 1');
    await safeClick(tab(page, 'Work Details'));
    await expect(fieldPart(page, 'address', 'input')).toHaveValue('Office Road 2');
  });

  test('renders one address per tab, not both on either', async ({ page }) => {
    await openPeople(page);

    await expect(fieldById(page, 'address')).toHaveCount(1);
    await safeClick(tab(page, 'Work Details'));
    await expect(fieldById(page, 'address')).toHaveCount(1);
  });

  /**
   * `deskNumber` is `showWhen: { "[work.address]": "HQ" }`. A bare `address` could not have
   * said which of the two it meant — the runtime would have resolved it by search order.
   */
  test('a showWhen keyed by path watches that field and not its namesake', async ({ page }) => {
    await openPeople(page);

    // Typing HQ into the *personal* address must not reveal the desk number.
    await safeFill(fieldPart(page, 'address', 'input'), 'HQ');
    await safeClick(tab(page, 'Work Details'));
    await expect(fieldById(page, 'deskNumber')).toHaveCount(0);

    await safeFill(fieldPart(page, 'address', 'input'), 'HQ');
    await expect(fieldById(page, 'deskNumber')).toHaveCount(1);

    await safeFill(fieldPart(page, 'address', 'input'), 'Branch');
    await expect(fieldById(page, 'deskNumber')).toHaveCount(0);
  });
});
