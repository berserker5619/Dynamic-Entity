import { expect, test, type Page } from '@playwright/test';
import { fieldPart, gotoDemo, recordButton, safeClick, safeSelect } from './test-helpers';

/**
 * The builder → host → renderer round trip for a rule on a field inside a `group`.
 *
 * This was the one verification step left to a person, and the reason was worse than
 * "untested": `EntityBuilderComponent` provides `BuilderStore` itself and emitted only an
 * `EntityFormConfig`, so a rule authored in the builder **could not leave the component**.
 * A host had no supported way to persist one, and therefore no way to hand it back to the
 * renderer as `[rules]` — which made per-section rule validation unreachable for anyone
 * using the builder as shipped. `[rules]` in and `(rulesChange)` out are what close it.
 *
 * What this drives is the wiring, not the rule editor: open a config in the builder, save it
 * untouched, and check the renderer still enforces the rule that came with it. That is the
 * assertion that *fails* under the old behaviour — the builder would have opened with an
 * empty rules list and written that emptiness back over a rule nobody touched. Authoring
 * inside the rule form is covered by `EntityBuilderComponent`'s own suite, which can reach
 * the store directly rather than through a sidebar whose open state persists between runs.
 */
test.describe('rules survive a trip through the builder', () => {
  const panel = '[data-testid="form-panel"]';

  /** Clear the email on John's Personal tab and try to save that section. */
  async function saveSectionWithNoEmail(page: Page): Promise<void> {
    await safeClick(page.getByRole('button', { name: 'Clients Data' }));
    await safeSelect(page.locator('#entitySelect'), 'employees');
    await safeClick(recordButton(page, 'John'));
    await expect(page.locator(panel)).toBeVisible();

    await safeClick(page.getByTestId('toggle-record-view'));
    await safeClick(page.getByTestId('edit-section'));
    await fieldPart(page, 'email', 'input').fill('');
    await safeClick(page.getByTestId('save-section'));
  }

  test('a config saved untouched keeps the rule that came with it', async ({ page }) => {
    await gotoDemo(page);

    // The rule is in force to begin with. Its trigger and its target are both
    // `[personal.contact.email]`, two levels down — the shape a per-section save could not
    // see before 2.0.0.
    await saveSectionWithNoEmail(page);
    await expect(page.getByTestId('section-errors')).toContainText('An employee needs a contact email.');

    // Open the same config in the builder and save it without editing anything.
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await safeSelect(page.locator('#builderEntitySelect'), 'employees');
    await safeClick(page.getByRole('button', { name: /^Save/ }).first());
    await expect(page.getByTestId('builder-toast')).toHaveAttribute('data-error', 'false');

    // Still enforced. Without `[rules]` the builder would have opened with none, and
    // `(rulesChange)` would have handed the host an empty list to write back — quietly
    // deleting a rule the user never touched.
    await saveSectionWithNoEmail(page);
    await expect(page.getByTestId('section-errors')).toContainText('An employee needs a contact email.');
  });
});
