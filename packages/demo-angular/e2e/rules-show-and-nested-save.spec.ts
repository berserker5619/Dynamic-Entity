import { expect, test, type Page } from '@playwright/test';
import { fieldById, fieldPart, gotoDemo, recordButton, safeClick, safeSelect } from './test-helpers';

/**
 * The two rule behaviours that only a round trip can prove.
 *
 * 1. **A rule that shows.** `{ type: 'visibility', value: true }` was read and then
 *    discarded, so a show action was a documented no-op. `terminationReason` carries
 *    `visibility: false` in the demo's employees config, which means a rule is the only
 *    thing that can put it on screen.
 *
 * 2. **A per-section save that a rule on a nested field refuses.** Per-tab save filters the
 *    rules down to the tab being saved, and that filter compared *bare ids* against a tab's
 *    *top-level fields* — while the builder writes bracketed paths. For every
 *    builder-authored config it matched nothing, so section save applied no rule validation
 *    whatsoever. The rule here targets `[personal.contact.email]`, inside a `group`: before
 *    2.0.0 it could not have fired on a section save at all.
 *
 * See `src/app/mock/demo-rules.ts` for the two rules this drives.
 */
test.describe('a rule that shows, and one that blocks a nested section save', () => {
  const panel = '[data-testid="form-panel"]';

  async function openJohn(page: Page): Promise<void> {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'employees');
    await safeClick(recordButton(page, 'John'));
    await expect(page.locator(panel)).toBeVisible();
  }

  const statusSelect = (page: Page) => fieldPart(page, 'status', 'input');

  test('a show rule reveals a field the config hides', async ({ page }) => {
    await openJohn(page);

    // Hidden by the config, and nothing has said otherwise yet.
    await expect(fieldById(page, 'terminationReason')).toHaveCount(0);

    await safeSelect(statusSelect(page), 'Terminated');

    await expect(fieldById(page, 'terminationReason')).toBeVisible();

    // And it goes away again when the rule stops firing — a show is a rule's answer for as
    // long as its conditions hold, not a one-way door.
    await safeSelect(statusSelect(page), 'Active');
    await expect(fieldById(page, 'terminationReason')).toHaveCount(0);
  });

  test('a rule on a field inside a group blocks that tab’s section save', async ({ page }) => {
    await openJohn(page);
    await safeClick(page.getByTestId('toggle-record-view'));

    // Edit the tab the rule's trigger and target both live on.
    await safeClick(page.getByTestId('edit-section'));

    // Clear the nested email the rule demands. The rule's trigger *and* its target are this
    // field, two levels down — which is the shape that used to be invisible to a section save.
    await fieldPart(page, 'email', 'input').fill('');

    await safeClick(page.getByTestId('save-section'));

    // The rule's message, raised against a field two levels down.
    await expect(page.getByTestId('section-errors')).toContainText(
      'An employee needs a contact email.',
    );
    // The section stays open: the save was refused, not performed.
    await expect(page.getByTestId('save-section')).toBeVisible();
  });

  test('the same section saves once the rule is satisfied', async ({ page }) => {
    await openJohn(page);
    await safeClick(page.getByTestId('toggle-record-view'));
    await safeClick(page.getByTestId('edit-section'));

    await fieldPart(page, 'email', 'input').fill('john@x.com');

    await safeClick(page.getByTestId('save-section'));

    // Back to the read view for that tab, with no error banner: the save went through.
    await expect(page.getByTestId('edit-section')).toBeVisible();
    await expect(page.getByTestId('section-errors')).toHaveCount(0);
  });
});
