import { test, expect, type Page } from '@playwright/test';
import { DEMO_MASK, fieldById, fieldPart, gotoDemo, safeClick, safeSelect } from './test-helpers';
import { INSURANCE_CLAIMS_RECORDS } from '../src/app/mock/seed-records';

/**
 * The demo seeds every entity, so a claims list is never empty to begin with. Deriving the
 * baseline from the fixture keeps these counts honest when the fixture changes; a literal
 * would quietly need editing twice.
 */
const SEEDED_CLAIMS = INSURANCE_CLAIMS_RECORDS.length;

/**
 * Hostile paths on `insuranceClaims`: the same config the happy-path suite drives, but
 * every assertion here is something going wrong — invalid input, a cascade that must
 * drop a now-illegal child, a copy that must not fire twice, a row that poisons Save,
 * Reset wiping a half-built record, and roles that may look but not author.
 *
 * It is order-dependent on purpose. A step that leaves the form in the wrong state will
 * take the rest of the gauntlet with it; that is the point.
 */

async function openNewClaim(page: Page): Promise<void> {
  await gotoDemo(page);
  await safeSelect(page.locator('#entitySelect'), 'insuranceClaims');
  await safeClick(page.getByRole('button', { name: /^\+ Add/ }));
  await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const save = (page: Page) => page.getByTestId('form-submit');

async function unlockClaimRef(page: Page): Promise<void> {
  await safeClick(page.getByTestId('lock-claimRef'));
  await expect(fieldPart(page, 'claimRef', 'input')).toBeVisible();
}

async function fillRequired(page: Page, ref: string): Promise<void> {
  await unlockClaimRef(page);
  await fieldPart(page, 'claimRef', 'input').fill(ref);
  await fieldPart(page, 'claimantEmail', 'input').fill('edge@example.com');
  await safeClick(tab(page, 'Policy'));
  await fieldPart(page, 'sumInsured', 'input').fill('48000');
  await safeClick(tab(page, 'Incident'));
  await fieldPart(page, 'incidentDate', 'input').fill('2026-04-01');
}

test.describe('insuranceClaims — hostile edge cases', () => {
  test.describe.configure({ timeout: 90_000 });

  test('rejects invalid input on every validated field, then recovers', async ({ page }) => {
    await openNewClaim(page);

    await expect(save(page)).toBeDisabled();

    // claimRef is locked: there is no input to type into, and Save stays blocked.
    await expect(fieldPart(page, 'claimRef', 'input')).toHaveCount(0);
    await unlockClaimRef(page);

    // Too short for minLength: 4.
    await fieldPart(page, 'claimRef', 'input').fill('AB');
    await fieldPart(page, 'claimRef', 'input').blur();
    await expect(fieldPart(page, 'claimRef', 'error')).toBeVisible();
    await expect(save(page)).toBeDisabled();

    // Over maxLength: 24.
    await fieldPart(page, 'claimRef', 'input').fill(`CLM-${'X'.repeat(30)}`);
    await fieldPart(page, 'claimRef', 'input').blur();
    await expect(fieldPart(page, 'claimRef', 'error')).toBeVisible();
    await expect(save(page)).toBeDisabled();

    await fieldPart(page, 'claimRef', 'input').fill('CLM-EDGE-1');
    await expect(fieldPart(page, 'claimRef', 'error')).toHaveCount(0);

    // Relock: the business key is text again, not an input.
    await safeClick(page.getByTestId('lock-claimRef'));
    await expect(fieldPart(page, 'claimRef', 'input')).toHaveCount(0);
    await expect(fieldPart(page, 'claimRef', 'value')).toHaveText('CLM-EDGE-1');

    // Email: required empty still blocks; a non-address is an error once touched.
    await fieldPart(page, 'claimantEmail', 'input').fill('not-an-email');
    await fieldPart(page, 'claimantEmail', 'input').blur();
    await expect(fieldPart(page, 'claimantEmail', 'error')).toContainText(/valid email/i);
    await expect(save(page)).toBeDisabled();
    await fieldPart(page, 'claimantEmail', 'input').fill('edge@example.com');
    await expect(fieldPart(page, 'claimantEmail', 'error')).toHaveCount(0);

    // Pattern: NI number is AA999999A. Junk must not sneak through just because it is optional.
    await fieldPart(page, 'nationalId', 'input').fill('12');
    await fieldPart(page, 'nationalId', 'input').blur();
    await expect(fieldPart(page, 'nationalId', 'error')).toBeVisible();
    await fieldPart(page, 'nationalId', 'input').fill('QQ123456C');
    await expect(fieldPart(page, 'nationalId', 'error')).toHaveCount(0);

    // A shown required field deadlocks Save; hiding it must release the form (already
    // covered in isolation — here it is stacked on the other errors).
    const staff = fieldById(page, 'isEmployee').locator('input[type="checkbox"]');
    await staff.check();
    await expect(fieldById(page, 'staffId')).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await staff.uncheck();
    await expect(fieldById(page, 'staffId')).toHaveCount(0);

    await safeClick(tab(page, 'Policy'));

    // Currency bounds: min 0, max 10_000_000. Empty required still blocks.
    await fieldPart(page, 'sumInsured', 'input').fill('-1');
    await fieldPart(page, 'sumInsured', 'input').blur();
    await expect(save(page)).toBeDisabled();
    await fieldPart(page, 'sumInsured', 'input').fill('10000001');
    await fieldPart(page, 'sumInsured', 'input').blur();
    await expect(save(page)).toBeDisabled();
    await fieldPart(page, 'sumInsured', 'input').fill('48000');

    await fieldPart(page, 'excess', 'input').fill('-5');
    await fieldPart(page, 'excess', 'input').blur();
    await expect(fieldPart(page, 'excess', 'error')).toBeVisible();
    await fieldPart(page, 'excess', 'input').fill('250');
    await expect(fieldPart(page, 'excess', 'error')).toHaveCount(0);

    await safeClick(tab(page, 'Incident'));
    await expect(save(page)).toBeDisabled();
    await fieldPart(page, 'incidentDate', 'input').fill('2026-04-01');

    await expect(save(page)).toBeEnabled();
  });

  test('cascade, autoPatch and patchOnTrue refuse the stale and the double-copy', async ({ page }) => {
    await openNewClaim(page);
    await unlockClaimRef(page);
    await fieldPart(page, 'claimRef', 'input').fill('CLM-EDGE-2');

    // patchOnTrue copies on the false→true edge only. While the flag stays true, a later
    // edit of the source must not overwrite a manual target.
    await fieldById(page, 'copyRefToPolicy').locator('input[type="checkbox"]').check();
    await safeClick(tab(page, 'Policy'));
    await expect(fieldPart(page, 'policyNote', 'input')).toHaveValue('CLM-EDGE-2');
    await fieldPart(page, 'policyNote', 'input').fill('hand-edited note');
    await safeClick(tab(page, 'Claimant'));
    await fieldPart(page, 'claimRef', 'input').fill('CLM-EDGE-2B');
    await safeClick(tab(page, 'Policy'));
    await expect(fieldPart(page, 'policyNote', 'input')).toHaveValue('hand-edited note');

    // Uncheck → check is a new false→true edge, so the copy is allowed to run again.
    await safeClick(tab(page, 'Claimant'));
    await fieldById(page, 'copyRefToPolicy').locator('input[type="checkbox"]').uncheck();
    await fieldById(page, 'copyRefToPolicy').locator('input[type="checkbox"]').check();
    await safeClick(tab(page, 'Policy'));
    await expect(fieldPart(page, 'policyNote', 'input')).toHaveValue('CLM-EDGE-2B');

    // autoPatch follows the selected record. Clearing the select must not invent a VAT.
    await fieldById(page, 'insurer').locator('select').selectOption({ label: 'Acme' });
    await expect(fieldPart(page, 'insurerVat', 'value')).toHaveText('DE111111');
    await fieldById(page, 'insurer').locator('select').selectOption({ label: 'Globex' });
    await expect(fieldPart(page, 'insurerVat', 'value')).toHaveText('FR222222');

    const city = fieldById(page, 'city').locator('select');
    const cityOptions = async () => (await city.locator('option').allTextContents()).slice(1);

    expect(await cityOptions()).toEqual([]);
    await expect(fieldPart(page, 'city', 'hint')).toBeVisible();

    await fieldById(page, 'country').locator('select').selectOption({ label: 'Germany' });
    await expect.poll(cityOptions).toEqual(['Berlin', 'Munich']);
    await city.selectOption({ label: 'Berlin' });
    await expect(city).toHaveValue('ber');

    // A parent switch must drop the child that no longer belongs, and not offer Berlin for France.
    await fieldById(page, 'country').locator('select').selectOption({ label: 'France' });
    await expect(city).toHaveValue('');
    await expect.poll(cityOptions).toEqual(['Paris', 'Lyon']);
    await expect(city).not.toContainText('Berlin');

    // Clearing the parent puts the child back on hold.
    await fieldById(page, 'country').locator('select').selectOption({ label: 'Select...' });
    await expect.poll(cityOptions).toEqual([]);
    await expect(fieldPart(page, 'city', 'hint')).toBeVisible();
  });

  test('nested tabs, a poisonous array row, Reset, and a round-trip that keeps the survivors', async ({
    page,
  }) => {
    await openNewClaim(page);
    await fillRequired(page, 'CLM-EDGE-3');

    await safeClick(tab(page, 'Incident'));
    await fieldById(page, 'severity').getByLabel('High').check();
    await fieldPart(page, 'damageTypes', 'input').selectOption([
      { label: 'Fire' },
      { label: 'Flood' },
    ]);
    await fieldPart(page, 'street', 'input').fill('12 Roof Lane');
    await fieldPart(page, 'postcode', 'input').fill('10115');
    await fieldPart(page, 'narrative', 'input').fill('Short.');

    // Sub-tab and module tab must not drop values sitting on a sibling panel.
    await safeClick(page.getByTestId('subtab-incidentAttachments'));
    await expect(fieldById(page, 'claimantPhoto')).toBeVisible();
    await expect(fieldPart(page, 'incidentDate', 'input')).toHaveCount(0);
    await safeClick(page.getByTestId('subtab-incidentDetails'));
    await expect(fieldPart(page, 'incidentDate', 'input')).toHaveValue('2026-04-01');

    await safeClick(tab(page, 'Documents'));
    await expect(page.getByTestId('module-panel')).toBeVisible();
    await safeClick(tab(page, 'Incident'));
    await expect(fieldPart(page, 'incidentDate', 'input')).toHaveValue('2026-04-01');
    await expect(fieldPart(page, 'street', 'input')).toHaveValue('12 Roof Lane');

    await safeClick(tab(page, 'Policy'));
    await fieldPart(page, 'coverStart', 'month').selectOption({ label: 'March' });
    await fieldPart(page, 'coverStart', 'year').selectOption({ label: String(new Date().getFullYear()) });

    await safeClick(tab(page, 'Settlement'));
    await expect(fieldPart(page, 'lineItems', 'empty')).toBeVisible();
    await expect(save(page)).toBeEnabled();

    // An empty required column on a new row is a silent Save-killer if it is not on screen
    // as an error the tester can see. Adding the row must block; removing it must unblock.
    await fieldById(page, 'lineItems').getByTestId('field-lineItems-add').click();
    await expect(page.getByTestId('field-lineItems-row')).toHaveCount(1);
    await expect(save(page)).toBeDisabled();
    await fieldById(page, 'lineItems').locator('[data-testid="field-itemDescription-input"]').fill('Roof tiles');
    await fieldById(page, 'lineItems').locator('[data-testid="field-itemAmount-input"]').fill('1200');
    await expect(save(page)).toBeEnabled();

    await fieldById(page, 'lineItems').getByTestId('field-lineItems-add').click();
    await expect(page.getByTestId('field-lineItems-row')).toHaveCount(2);
    await expect(save(page)).toBeDisabled();
    await fieldById(page, 'lineItems').getByTestId('field-lineItems-remove-1').click();
    await expect(page.getByTestId('field-lineItems-row')).toHaveCount(1);
    await expect(save(page)).toBeEnabled();

    await fieldPart(page, 'auditorPin', 'input').fill('9988');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(fieldPart(page, 'auditorPin', 'input')).toHaveAttribute('type', 'text');
    await expect(fieldPart(page, 'auditorPin', 'input')).toHaveValue('9988');

    await fieldPart(page, 'settlementTotal', 'input').fill('-1');
    await fieldPart(page, 'settlementTotal', 'input').blur();
    await expect(save(page)).toBeDisabled();
    await fieldPart(page, 'settlementTotal', 'input').fill('1200');
    await expect(save(page)).toBeEnabled();

    // The demo wires `(formReset)` to cancel: Reset must dump the half-built claim, not
    // persist it. A Reset that saved would show CLM-EDGE-3 in the list with 1 record.
    await safeClick(page.getByTestId('form-reset'));
    await expect(page.getByRole('button', { name: /^\+ Add/ })).toBeVisible();
    await expect(page.getByText('CLM-EDGE-3')).toHaveCount(0);
    await expect(
      page.getByText(new RegExp(`Showing ${SEEDED_CLAIMS} of ${SEEDED_CLAIMS} records`)),
    ).toBeVisible();

    await safeClick(page.getByRole('button', { name: /^\+ Add/ }));
    await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();
    await fillRequired(page, 'CLM-EDGE-3');
    await safeClick(tab(page, 'Incident'));
    await fieldPart(page, 'street', 'input').fill('12 Roof Lane');
    await fieldById(page, 'severity').getByLabel('High').check();
    await safeClick(tab(page, 'Settlement'));
    await fieldById(page, 'lineItems').getByTestId('field-lineItems-add').click();
    await fieldById(page, 'lineItems').locator('[data-testid="field-itemDescription-input"]').fill('Roof tiles');
    await fieldById(page, 'lineItems').locator('[data-testid="field-itemAmount-input"]').fill('1200');
    await fieldPart(page, 'auditorPin', 'input').fill('9988');

    await safeClick(save(page));
    await expect(page.getByText('CLM-EDGE-3').first()).toBeVisible();

    await safeClick(page.getByRole('button', { name: /CLM-EDGE-3/i }).first());
    await expect(fieldPart(page, 'claimRef', 'value')).toHaveText('CLM-EDGE-3');
    await safeClick(tab(page, 'Incident'));
    await expect(fieldPart(page, 'street', 'input')).toHaveValue('12 Roof Lane');
    await safeClick(tab(page, 'Settlement'));
    await expect(page.getByTestId('field-lineItems-row')).toHaveCount(1);
    await expect(fieldById(page, 'lineItems').locator('[data-testid="field-itemDescription-input"]')).toHaveValue(
      'Roof tiles',
    );
  });

  test('viewer and IT_SUPPORT cannot author; manager can, and the pin stays masked', async ({ page }) => {
    await openNewClaim(page);
    await fieldPart(page, 'nationalId', 'input').fill('QQ123456C');
    await fillRequired(page, 'CLM-EDGE-4');
    await safeClick(tab(page, 'Settlement'));
    await fieldPart(page, 'auditorPin', 'input').fill('9988');
    await safeClick(save(page));
    await expect(page.getByText('CLM-EDGE-4').first()).toBeVisible();

    // Viewer: view granted, edit denied — the actions block is absent, not disabled.
    await safeClick(page.getByRole('button', { name: 'Viewer (Readonly)' }));
    await safeClick(page.getByRole('button', { name: /CLM-EDGE-4/i }).first());
    await expect(page.getByTestId('form-actions')).toHaveCount(0);
    // Readable, and read-only: without edit rights the fields render as values, not inputs.
    await expect(fieldPart(page, 'claimantEmail', 'value')).toHaveText('edge@example.com');
    await expect(fieldPart(page, 'claimantEmail', 'input')).toHaveCount(0);

    await safeClick(page.getByRole('button', { name: /Back to List/i }));
    await safeClick(page.getByRole('button', { name: 'IT Support (Masked Salary)' }));
    await safeClick(page.getByRole('button', { name: /CLM-EDGE-4/i }).first());
    await expect(page.getByTestId('form-actions')).toHaveCount(0);
    await expect(fieldPart(page, 'nationalId', 'masked')).toHaveText(DEMO_MASK);
    await safeClick(tab(page, 'Settlement'));
    await expect(fieldPart(page, 'auditorPin', 'masked')).toHaveText(DEMO_MASK);

    await safeClick(page.getByRole('button', { name: /Back to List/i }));
    await safeClick(page.getByRole('button', { name: 'Manager', exact: true }));
    await safeClick(page.getByRole('button', { name: /CLM-EDGE-4/i }).first());
    await expect(page.getByTestId('form-actions')).toBeVisible();
    await expect(save(page)).toBeEnabled();
    await expect(fieldPart(page, 'nationalId', 'input')).toHaveValue('QQ123456C');
    await safeClick(tab(page, 'Settlement'));
    await expect(fieldPart(page, 'auditorPin', 'input')).toHaveValue('9988');
  });
});
