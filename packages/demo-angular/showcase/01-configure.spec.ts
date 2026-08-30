import { expect, test } from '@playwright/test';
import { gotoDemo, safeClick } from '../e2e/test-helpers';
import { beat, toTop, typeInto } from './helpers';
import { clearCaption, installOverlay, say } from './overlay';

/**
 * Clip 1 — configuring an entity.
 *
 * Captions carry the narrative, since the recording has no sound and a viewer arriving from
 * a feed has no context at all.
 */
test('configure an entity', async ({ page }) => {
  await installOverlay(page);
  await gotoDemo(page);

  await say(page, 'A form is a config file. This is the editor for it.', 2200);
  await safeClick(page.getByRole('button', { name: /Form Builder/i }));
  await toTop(page);
  await beat(page);

  const label = page.getByTestId('field-label');

  await say(page, 'Pick a field type. Name it.', 1600);
  await safeClick(page.getByTestId('palette-text'));
  await typeInto(label, 'Full Name');
  await beat(page, 700);

  await safeClick(page.getByTestId('palette-email'));
  await typeInto(label, 'Work Email');
  await beat(page, 900);

  await say(page, 'Dropdown options are authored inline', 1500);
  await safeClick(page.getByTestId('palette-dropdown'));
  await typeInto(label, 'Department');
  const addOption = page.locator('ngx-field-inspector').getByRole('button', { name: /Option$/ }).first();
  await safeClick(addOption);
  await typeInto(page.getByTestId('option-0'), 'Engineering');
  await safeClick(addOption);
  await typeInto(page.getByTestId('option-1'), 'Design');
  await beat(page, 1100);

  await safeClick(page.getByTestId('palette-boolean'));
  await typeInto(label, 'Remote');
  await beat(page, 900);

  await toTop(page);
  await say(page, 'Rules pick the fields they act on — never typed by hand', 2400);
  await safeClick(page.getByTestId('add-rule'));
  await beat(page, 800);
  await safeClick(page.getByTestId('rule-trigger'));
  await beat(page, 1200);
  await page.locator('.cdk-overlay-pane').getByRole('option').last().click();
  await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
  await beat(page, 900);

  await say(page, 'The output is data. Store it, version it, ship it.', 2400);
  await safeClick(page.getByRole('button', { name: /Config JSON/i }));
  await expect(page.locator('.deb-json')).toContainText('"type": "dropdown"');
  await beat(page, 2600);
  await clearCaption(page);
  await beat(page, 600);
});
