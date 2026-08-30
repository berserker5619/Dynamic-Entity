import { expect, test } from '@playwright/test';
import { fieldById, fieldPart, gotoDemo, recordButton, safeClick, safeSelect } from '../e2e/test-helpers';
import { beat, toTop, typeInto } from './helpers';
import { clearCaption, installOverlay, say } from './overlay';

/**
 * Clip 2 — the same config, rendered and filled in.
 *
 * The story: tabs and sub-tabs from the schema, validation that blocks a save, a field that
 * appears only when a rule says so, and a record that round-trips — reopened with every value
 * where it was left.
 */
test('render and fill a form', async ({ page }) => {
  await installOverlay(page);
  await gotoDemo(page);

  await say(page, 'The same config, rendered as a working form', 2000);
  await safeSelect(page.locator('#entitySelect'), 'insuranceClaims');
  await safeClick(page.getByRole('button', { name: /Add/i }));
  await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();
  await toTop(page);
  await beat(page, 900);

  const tab = (name: string) => page.getByRole('tab', { name: new RegExp(name, 'i') });

  // Save stays disabled until the schema's required fields are satisfied — the form will not
  // let an invalid record be stored in the first place.
  const save = page.getByRole('button', { name: /^Save$/i });
  await expect(save).toBeDisabled();
  await say(page, 'Save is blocked until the schema is satisfied', 2000);

  // The claim reference is a `criticalField`: it renders locked, and has to be unlocked on
  // purpose before it can be edited.
  await say(page, 'A critical field renders locked — unlock it on purpose', 2200);
  await safeClick(page.getByTestId('lock-claimRef'));
  await beat(page, 800);
  await typeInto(fieldPart(page, 'claimRef', 'input'), 'CLM-2026-118');
  await typeInto(fieldPart(page, 'claimantEmail', 'input'), 'ada@example.com');
  await beat(page, 1300);

  // A conditional field: the staff id only exists once the claimant is an employee.
  await expect(fieldById(page, 'staffId')).toHaveCount(0);
  await say(page, 'A rule reveals the staff id only for employees', 2000);
  await fieldById(page, 'isEmployee').locator('input[type="checkbox"]').check();
  await expect(fieldById(page, 'staffId')).toHaveCount(1);
  await typeInto(fieldPart(page, 'staffId', 'input'), 'EMP-4471');
  await beat(page, 1600);

  // Tabs come straight from the schema, and one of them nests a sub-tab.
  await say(page, 'Tabs come from the schema. City cascades from country.', 2200);
  await safeClick(tab('Policy'));
  await beat(page, 700);
  await safeSelect(fieldById(page, 'country').locator('select'), 'de');
  await beat(page, 900);
  // The city list is cascaded from the country above it.
  await safeSelect(fieldById(page, 'city').locator('select'), 'muc');
  await typeInto(fieldPart(page, 'sumInsured', 'input'), '75000');
  await beat(page, 1400);

  await say(page, 'This tab keeps its fields on a sub-tab', 1900);
  await safeClick(tab('Incident'));
  await beat(page, 700);
  await fieldPart(page, 'incidentDate', 'input').fill('2026-02-11');
  await fieldPart(page, 'incidentTime', 'input').fill('14:05');
  await typeInto(fieldPart(page, 'narrative', 'input'), 'Water ingress after the storm.');
  await beat(page, 1600);

  // Every required field across every tab is satisfied, so the save unlocks.
  await expect(save).toBeEnabled();
  await say(page, 'Every required field is satisfied — save unlocks', 2000);
  await safeClick(save);
  await beat(page, 1400);

  // Reopened from storage: every value is where it was left.
  await say(page, 'Reopened from storage, exactly as it was left', 2000);
  await safeClick(recordButton(page, 'CLM-2026-118'));
  await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();
  // Locked again on reopen, so it reads as a value rather than an editable box.
  await expect(fieldPart(page, 'claimRef', 'value')).toHaveText('CLM-2026-118');
  await beat(page, 1200);
  await safeClick(tab('Incident'));
  await expect(fieldPart(page, 'incidentTime', 'input')).toHaveValue('14:05');
  await beat(page, 2200);
  await clearCaption(page);
  await beat(page, 600);
});
