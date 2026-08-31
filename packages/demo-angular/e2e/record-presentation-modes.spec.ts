import { expect, test, type Page } from '@playwright/test';
import { fieldPart, gotoDemo, recordButton, safeClick, safeSelect } from './test-helpers';

/**
 * The three ways the renderer can present one record, and the differences that matter.
 *
 *   Form        — `ngx-dynamic-form`: editable controls plus the actions block.
 *   Record view — `ngx-dynamic-record-form` at its `viewMode` default: values, with a
 *                 per-tab "Edit section" flow to edit one tab at a time.
 *   Data only   — the same component with `isReadOnly`: values and nothing else.
 *
 * Data only had no route to it before. A role that could edit always got the Edit section
 * button, so the presentation was reachable only by switching to a role that could not edit
 * anyway — which is a different thing being demonstrated.
 */
test.describe('record presentation modes', () => {
  const panel = '[data-testid="form-panel"]';

  async function openAcme(page: Page): Promise<void> {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'clients');
    await safeClick(recordButton(page, 'Acme Corp'));
    await expect(page.locator(panel)).toBeVisible();
  }

  const inputs = (page: Page) =>
    page.locator(`${panel} input, ${panel} select, ${panel} textarea`);
  const values = (page: Page) => page.locator(`${panel} .ngx-field__value`);
  const editSection = (page: Page) => page.getByRole('button', { name: /Edit section/i });

  test('Form is editable for a role that may edit', async ({ page }) => {
    await openAcme(page);
    await expect(inputs(page).first()).toBeVisible();
    await expect(page.getByTestId('form-actions')).toBeVisible();
  });

  test('Record view shows values with a per-tab edit flow', async ({ page }) => {
    await openAcme(page);
    await safeClick(page.getByTestId('toggle-record-view'));

    await expect(inputs(page)).toHaveCount(0);
    await expect(values(page).first()).toBeVisible();
    // The affordance that separates this from Data only.
    await expect(editSection(page)).toBeVisible();
  });

  test('Data only shows values and offers no way to edit them', async ({ page }) => {
    await openAcme(page);
    await safeClick(page.getByTestId('mode-data'));

    await expect(inputs(page)).toHaveCount(0);
    await expect(values(page).first()).toBeVisible();
    await expect(editSection(page)).toHaveCount(0);
    await expect(page.getByTestId('form-actions')).toHaveCount(0);

    // Read-only is not the same as empty: the record must still be legible.
    await expect(page.locator(panel)).toContainText('Acme Corp');
    await expect(page.locator(panel)).toContainText('ops@acme.com');
  });

  test('modes switch back and forth without losing the record', async ({ page }) => {
    await openAcme(page);
    await safeClick(page.getByTestId('mode-data'));
    await expect(inputs(page)).toHaveCount(0);

    await safeClick(page.getByTestId('mode-form'));
    await expect(inputs(page).first()).toBeVisible();
    // Back in Form mode the record lives in input *values*, not text nodes, so
    // toContainText would look right and assert nothing — it passes in Data only for
    // exactly the reason it cannot work here.
    await expect(fieldPart(page, 'name', 'input')).toHaveValue('Acme Corp');
  });
});
