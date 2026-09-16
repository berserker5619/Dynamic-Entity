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

  /**
   * Click a tab and wait for *that tab* to report itself selected.
   *
   * `safeClick` returns once the click is dispatched, and the assertions below read
   * "whichever `address` input is currently in the DOM". The outgoing tab's panel is still on
   * screen the instant the click lands, so a click that had not yet swapped the panel was read
   * as the other tab's value rather than as a wait that needed to be longer — the assertion
   * then retried against a locator that resolved to the same stale input every time.
   *
   * This is the failure `sweepTabs` in `ui-text-i18n-widgets.spec.ts` documents: `aria-selected`
   * flips in the same change-detection pass that renders the panel, so it is the signal that
   * the DOM being sampled is the one that was asked for. It went green for eleven consecutive
   * runs and then failed in CI here, on a machine slow enough to separate the two.
   */
  async function selectTab(page: import('@playwright/test').Page, name: string): Promise<void> {
    const target = tab(page, name);
    await safeClick(target);
    await expect(target).toHaveAttribute('aria-selected', 'true');
  }

  test('each address keeps its own value across a save and reload', async ({ page }) => {
    await openPeople(page);

    await safeFill(fieldPart(page, 'fullName', 'input'), 'Ada Lovelace');
    await safeFill(fieldPart(page, 'address', 'input'), 'Home Street 1');

    await selectTab(page, 'Work Details');
    await safeFill(fieldPart(page, 'address', 'input'), 'Office Road 2');

    await safeClick(page.getByRole('button', { name: /^Save$/i }));
    await safeClick(recordButton(page, 'Ada Lovelace'));
    await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();

    // The two addresses must not have collapsed into one another.
    //
    // Both tabs are selected explicitly. `fieldPart` resolves whichever `address` input is
    // currently in the DOM, so reading it without choosing a tab first quietly asserted
    // *which tab the form reopens on* as well — and that is a separate question, covered by
    // the unit specs on `activeTab`. Under CI load this test failed on that incidental
    // coupling rather than on the values it exists to check.
    await selectTab(page, 'Personal Details');
    await expect(fieldPart(page, 'address', 'input')).toHaveValue('Home Street 1');
    await selectTab(page, 'Work Details');
    await expect(fieldPart(page, 'address', 'input')).toHaveValue('Office Road 2');
  });

  test('renders one address per tab, not both on either', async ({ page }) => {
    await openPeople(page);

    await expect(fieldById(page, 'address')).toHaveCount(1);
    await selectTab(page, 'Work Details');
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
    await selectTab(page, 'Work Details');
    await expect(fieldById(page, 'deskNumber')).toHaveCount(0);

    await safeFill(fieldPart(page, 'address', 'input'), 'HQ');
    await expect(fieldById(page, 'deskNumber')).toHaveCount(1);

    await safeFill(fieldPart(page, 'address', 'input'), 'Branch');
    await expect(fieldById(page, 'deskNumber')).toHaveCount(0);
  });
});
