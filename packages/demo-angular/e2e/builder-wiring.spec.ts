import { expect, test } from '@playwright/test';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

/**
 * Two capabilities that existed but were unreachable: the builder could not open an entity
 * anyone had authored, and `moveFieldToTab` was a store method with nothing calling it.
 */
test.describe('the builder can open and restructure an existing entity', () => {
  async function openBuilderWith(page: import('@playwright/test').Page, entity: string): Promise<void> {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await safeSelect(page.getByTestId('builder-entity-select'), entity);
  }

  /**
   * `insuranceClaims` keeps nine of its fields on sub-tabs. The canvas used to stop at
   * top-level tabs, so those were invisible — and until now no config with sub-tabs could be
   * loaded into the builder at all, so it could not be seen either way.
   */
  test('shows fields that live on a sub-tab, grouped by the tab that owns them', async ({ page }) => {
    await openBuilderWith(page, 'insuranceClaims');

    const rows = page.locator('[data-testid="builder-field-row"]');
    await expect(rows.first()).toBeVisible();

    // The Incident tab keeps its fields on the `incidentDetails` sub-tab.
    await expect(page.getByTestId('builder-group-incidentDetails')).toBeVisible();
    await expect(page.getByTestId('builder-field-list-incidentDetails')).toBeVisible();
    await expect(page.getByTestId('row-id-incidentTime')).toBeVisible();

    // A field nested two levels down is reachable as well.
    await expect(page.getByTestId('builder-field-list-incidentAttachments')).toBeVisible();
  });

  test('starts blank again when New entity is chosen', async ({ page }) => {
    await openBuilderWith(page, 'insuranceClaims');
    await expect(page.locator('[data-testid="builder-field-row"]').first()).toBeVisible();

    await safeSelect(page.getByTestId('builder-entity-select'), '');
    await expect(page.locator('[data-testid="builder-field-row"]')).toHaveCount(0);
  });

  /**
   * Moving a field used to mean deleting and rebuilding it, losing its validators, options
   * and every rule aimed at it.
   */
  test('moves a field to another tab, and its path follows', async ({ page }) => {
    await openBuilderWith(page, 'insuranceClaims');

    await safeClick(page.getByTestId('row-id-incidentTime'));
    const tabPicker = page.getByTestId('field-tab');
    await expect(tabPicker).toBeVisible();
    await expect(tabPicker).toContainText(/Details/i);

    await safeClick(tabPicker);
    await safeClick(page.getByRole('option', { name: /^Claimant$/i }));
    await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);

    // It now sits under the tab it was moved to, and no longer under the one it left.
    await expect(page.getByTestId('builder-field-list-claimant').getByTestId('row-id-incidentTime')).toBeVisible();
    await expect(page.getByTestId('builder-field-list-incidentDetails').getByTestId('row-id-incidentTime')).toHaveCount(0);
  });
});
