import { test, expect } from '@playwright/test';
import {
  capturePageErrors,
  gotoDemo,
  openInspectorSection,
  safeClick,
  safeFill,
} from './test-helpers';

test.describe('Referenced fields and drift detection', () => {
  test('links a field to a source entity field, detects drift on source change, and syncs', async ({ page }) => {
    const errorMonitor = capturePageErrors(page);

    await gotoDemo(page);

    // 1. Open Form Builder
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    const builder = page.locator('ngx-entity-builder');
    await expect(builder).toBeVisible();

    // 2. Add a field and select it
    await safeClick(page.locator('[data-testid^="palette-"]').filter({ hasText: 'Text' }).first());
    const fieldRow = page.locator('[data-testid="builder-field-row"]').last();
    await safeClick(fieldRow);

    // 3. Toggle Referenced Field Link on. The Reference section opens itself once a field
    //    is linked, but this one is not linked yet, so it starts closed.
    await openInspectorSection(page, 'Reference');
    const toggle = page
      .locator(
        '[data-testid="toggle-referenced"] label, [data-testid="toggle-referenced"] button, [data-testid="toggle-referenced"]',
      )
      .first();
    await safeClick(toggle);

    // 4. Fill Source Entity Key and Source Field ID with an existing entity and field
    const entityKeyInput = page.getByTestId('referenced-entity-key');
    const fieldIdInput = page.getByTestId('referenced-field-id');

    await safeFill(entityKeyInput, 'clients');
    await safeFill(fieldIdInput, 'name');

    // 5. Verify drift is detected: newly created field has label "Text 1", whereas
    //    source field "clients.name" has label "Name" and required validator.
    const driftBanner = page.getByTestId('drift-banner');
    await expect(driftBanner).toBeVisible();
    await expect(driftBanner).toContainText(/has drifted/i);

    // 6. Click sync button and verify the field takes the source field's label
    //    and drift banner is cleared.
    const syncBtn = page.getByTestId('sync-source-btn');
    await safeClick(syncBtn);

    await expect(driftBanner).toHaveCount(0);
    await expect(page.getByTestId('field-label')).toHaveValue('Name');

    // 7. Verify no unexpected errors occurred
    errorMonitor.assertNoErrors();
  });
});
