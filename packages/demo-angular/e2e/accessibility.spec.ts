import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

/**
 * Automated accessibility checks. axe finds roughly a third of WCAG issues — it cannot judge
 * whether a label is meaningful — so the keyboard specs below cover what it cannot: that the
 * form is operable without a mouse, and that switching tabs tells a screen reader something
 * changed.
 */
test.describe('Accessibility', () => {
  const scan = (page: import('@playwright/test').Page) =>
    new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

  test('the record form has no detectable violations', async ({ page }) => {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'clients');
    await safeClick(page.getByRole('button', { name: /Add/i }));
    await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();

    const results = await scan(page);
    expect(results.violations.map(v => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test('the builder has no detectable violations', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await expect(page.locator('ngx-entity-builder')).toBeVisible();

    const results = await scan(page);
    expect(results.violations.map(v => `${v.id}: ${v.help}`)).toEqual([]);
  });

  /**
   * Activating a tab replaces everything below it while focus stays on the tab button, so a
   * keyboard or screen-reader user gets no indication the content changed and has to tab
   * back through the whole strip to reach it.
   */
  test('switching tabs moves focus into the new panel', async ({ page }) => {
    await gotoDemo(page);
    // `insuranceClaims` has five tabs. This used to load `clients`, which has exactly one,
    // and then skip itself — so the guarantee below was never once checked. A precondition
    // the fixture is supposed to satisfy belongs in an expect, not a skip.
    await safeSelect(page.locator('#entitySelect'), 'insuranceClaims');
    await safeClick(page.getByRole('button', { name: /Add/i }));

    const tabs = page.getByRole('tab');
    expect(await tabs.count()).toBeGreaterThan(1);

    await tabs.nth(1).click();

    // The tabpanel wraps both the fields grid and a module tab's content, so focus lands on
    // the wrapper rather than on the fields div specifically.
    const panel = page.locator('[role="tabpanel"]');
    await expect(panel).toBeFocused();
  });

  /**
   * Reordering was drag-only in appearance. The move buttons are the keyboard path, and each
   * needs an accessible name — an icon button with only a tooltip announces as "button".
   */
  test('builder rows are reachable and reorderable by keyboard', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));

    // The builder opens empty, so this used to skip itself on every run — the same silent
    // pass as the tab test above. A spec that needs two rows should create two rows rather
    // than hope the fixture has them.
    await safeClick(page.getByTestId('palette-text'));
    await safeClick(page.getByTestId('palette-number'));

    const rows = page.locator('[data-testid="builder-field-row"]');
    await expect(rows).toHaveCount(2);

    // The row itself is operable, not just clickable.
    const first = rows.first();
    await expect(first).toHaveAttribute('tabindex', '0');
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');

    // Every move/duplicate control is named for its field, so "Move up" is unambiguous.
    const named = page.getByRole('button', { name: /^Move .+ (up|down)$/ });
    expect(await named.count()).toBeGreaterThan(0);
  });
});
