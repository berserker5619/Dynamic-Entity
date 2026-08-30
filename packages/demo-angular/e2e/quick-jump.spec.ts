import { expect, test } from '@playwright/test';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

/**
 * The record editor's summary panel is the only place `jumpToField` is reachable, and nothing
 * in the demo rendered that component until now — so the quick-jump links had unit coverage
 * and no end-to-end coverage at all.
 *
 * `incidentTime` is marked `showOnMinimize` and lives on the `incidentDetails` sub-tab, which
 * is the case the jump used to miss entirely: the walk searched top-level `fields` only, so a
 * sub-tab field was never found and the click did nothing.
 */
test.describe('quick-jump from the summary panel', () => {
  async function openRecordView(page: import('@playwright/test').Page): Promise<void> {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'insuranceClaims');
    await safeClick(page.getByRole('button', { name: /Add/i }));
    await safeClick(page.getByTestId('toggle-record-view'));
    await expect(page.getByTestId('summary-panel')).toBeVisible();
  }

  test('lists every field marked for the summary', async ({ page }) => {
    await openRecordView(page);

    await expect(page.getByTestId('summary-claimRef')).toBeVisible();
    await expect(page.getByTestId('summary-incidentTime')).toBeVisible();
    await expect(page.getByTestId('summary-settlementTotal')).toBeVisible();
  });

  test('jumps to a field on a sub-tab and focuses it', async ({ page }) => {
    await openRecordView(page);

    await safeClick(page.getByTestId('summary-incidentTime'));

    // The field is on a sub-tab of Incident: reaching it means the walk descended, and the
    // slot took focus rather than the click scrolling and leaving focus behind.
    const slot = page.locator('#field-container-incidentTime');
    await expect(slot).toBeVisible();
    await expect(slot).toBeFocused();
  });

  test('jumps to a top-level field too', async ({ page }) => {
    await openRecordView(page);

    await safeClick(page.getByTestId('summary-settlementTotal'));

    const slot = page.locator('#field-container-settlementTotal');
    await expect(slot).toBeVisible();
    await expect(slot).toBeFocused();
  });
});
