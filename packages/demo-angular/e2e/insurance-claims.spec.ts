import { test, expect, type Page } from '@playwright/test';
import { fieldById, fieldPart, gotoDemo, safeClick, safeSelect } from './test-helpers';

/**
 * The `insuranceClaims` config is the most demanding one in the dataset: five tabs including
 * a sub-tab pair and a module tab, a group nested inside a sub-tab, an array with typed row
 * columns, an entity-ref cascade, a named lookup, two masked fields, a conditional field, a
 * patchOnTrue, an autoPatch, a drifted reference, and `flatData` on one tab while the rest
 * nest by tab id.
 *
 * It exists because each of those works in isolation in a unit test; this asserts they still
 * work together, in a browser, in one record.
 */

async function openNewClaim(page: Page): Promise<void> {
  await gotoDemo(page);
  await safeSelect(page.locator('#entitySelect'), 'insuranceClaims');
  await safeClick(page.getByRole('button', { name: /Add/i }));
  await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name });

/**
 * `claimRef` is a criticalField, so it renders locked and read-only until the lock is
 * toggled — the guard against editing a business key by accident. Every test that types
 * into it has to unlock it first, which also exercises the lock.
 */
async function unlockClaimRef(page: Page): Promise<void> {
  await safeClick(page.getByTestId('lock-claimRef'));
  await expect(fieldPart(page, 'claimRef', 'input')).toBeVisible();
}

/** Fill the four required fields and save. Returns once the list is showing again. */
async function createClaim(page: Page, ref: string): Promise<void> {
  await unlockClaimRef(page);
  await fieldPart(page, 'claimRef', 'input').fill(ref);
  await fieldPart(page, 'claimantEmail', 'input').fill('dana@example.com');

  await safeClick(tab(page, 'Policy'));
  await fieldPart(page, 'sumInsured', 'input').fill('48000');

  await safeClick(tab(page, 'Incident'));
  await fieldPart(page, 'incidentDate', 'input').fill('2026-02-11');

  await safeClick(page.getByTestId('form-submit'));
  await expect(page.getByText(ref).first()).toBeVisible();
}

test.describe('insuranceClaims — a complex config end to end', () => {
  test('renders every tab, including sub-tabs and a module tab', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', m => {
      if (m.type() === 'warning' && m.text().includes('[ngx-dynamic-entity]')) warnings.push(m.text());
    });

    await openNewClaim(page);

    // Primary tabs.
    for (const name of ['Claimant', 'Policy', 'Incident', 'Settlement', 'Documents']) {
      await expect(tab(page, name)).toBeVisible();
    }

    // A sub-tab strip appears only for a tab that has children.
    await safeClick(tab(page, 'Incident'));
    await expect(page.getByTestId('subtab-strip')).toBeVisible();
    await expect(page.getByTestId('subtab-incidentDetails')).toBeVisible();
    await expect(page.getByTestId('subtab-incidentAttachments')).toBeVisible();

    // A module tab renders a consumer component instead of generated fields.
    await safeClick(tab(page, 'Documents'));
    await expect(page.getByTestId('module-panel')).toBeVisible();

    expect(warnings).toEqual([]);
  });

  test('renders a group nested inside a sub-tab', async ({ page }) => {
    await openNewClaim(page);
    await safeClick(tab(page, 'Incident'));

    // tab -> sub-tab -> group -> fields is the deepest path the model allows.
    await expect(fieldById(page, 'location')).toBeVisible();
    await expect(fieldPart(page, 'street', 'input')).toBeVisible();
    await expect(fieldPart(page, 'postcode', 'input')).toBeVisible();
  });

  test('shows a conditional field only once its condition holds', async ({ page }) => {
    await openNewClaim(page);

    await expect(fieldById(page, 'staffId')).toHaveCount(0);

    await fieldById(page, 'isEmployee').locator('input[type="checkbox"]').check();
    await expect(fieldById(page, 'staffId')).toBeVisible();

    await fieldById(page, 'isEmployee').locator('input[type="checkbox"]').uncheck();
    await expect(fieldById(page, 'staffId')).toHaveCount(0);
  });

  /**
   * A hidden required field used to hold `form.invalid` true forever, disabling Save with
   * nothing on screen to explain it. Hiding it must release the form.
   */
  test('a hidden required field does not deadlock submission', async ({ page }) => {
    await openNewClaim(page);

    const checkbox = fieldById(page, 'isEmployee').locator('input[type="checkbox"]');
    await checkbox.check();
    await expect(fieldById(page, 'staffId')).toBeVisible();

    // staffId is required and empty, so Save is blocked while it is on screen.
    await expect(page.getByTestId('form-submit')).toBeDisabled();

    await checkbox.uncheck();
    await expect(fieldById(page, 'staffId')).toHaveCount(0);

    // Fill the remaining required fields; the hidden one must no longer count.
    await unlockClaimRef(page);
    await fieldPart(page, 'claimRef', 'input').fill('CLM-40199');
    await fieldPart(page, 'claimantEmail', 'input').fill('claimant@example.com');
    await safeClick(tab(page, 'Policy'));
    await fieldPart(page, 'sumInsured', 'input').fill('25000');
    await safeClick(tab(page, 'Incident'));
    await fieldPart(page, 'incidentDate', 'input').fill('2026-03-04');

    await expect(page.getByTestId('form-submit')).toBeEnabled();
  });

  test('cascade options wait for their parent, then filter by it', async ({ page }) => {
    await openNewClaim(page);
    await safeClick(tab(page, 'Policy'));

    const city = fieldById(page, 'city').locator('select');
    const cityOptions = async () => (await city.locator('option').allTextContents()).slice(1);

    // No country chosen: the child holds rather than offering an unfiltered list.
    expect(await cityOptions()).toEqual([]);

    await fieldById(page, 'country').locator('select').selectOption({ label: 'Germany' });
    await expect.poll(cityOptions).toEqual(['Berlin', 'Munich']);

    await fieldById(page, 'country').locator('select').selectOption({ label: 'France' });
    await expect.poll(cityOptions).toEqual(['Paris', 'Lyon']);
  });

  test('resolves a named lookup list', async ({ page }) => {
    await openNewClaim(page);

    const tier = fieldById(page, 'tier').locator('select');
    // clientTier is registered as a loader, and is sorted by sortOrder rather than input order.
    await expect
      .poll(async () => (await tier.locator('option').allTextContents()).slice(1))
      .toEqual(['Gold', 'Silver', 'Bronze']);
  });

  test('copies a value across tabs when a boolean flips true', async ({ page }) => {
    await openNewClaim(page);

    await unlockClaimRef(page);
    await fieldPart(page, 'claimRef', 'input').fill('CLM-77003');
    await fieldById(page, 'copyRefToPolicy').locator('input[type="checkbox"]').check();

    await safeClick(tab(page, 'Policy'));
    await expect(fieldPart(page, 'policyNote', 'input')).toHaveValue('CLM-77003');
  });

  test('copies fields from a selected entity-ref record', async ({ page }) => {
    await openNewClaim(page);
    await safeClick(tab(page, 'Policy'));

    await fieldById(page, 'insurer').locator('select').selectOption({ label: 'Acme' });

    // autoPatch maps the selected record's `vat` onto `insurerVat`, which is declared
    // readonly and therefore renders as text rather than an input.
    await expect(fieldPart(page, 'insurerVat', 'value')).toHaveText('DE111111');
  });

  /**
   * hasDrift was written by the builder and read by nothing at runtime, so a referenced field
   * whose source had changed looked entirely normal to the person filling the form in.
   */
  test('surfaces drift on a referenced field', async ({ page }) => {
    await openNewClaim(page);
    await safeClick(tab(page, 'Policy'));

    const drift = page.getByTestId('field-syncedClientTier-drift');

    await expect(drift).toBeVisible();
    await expect(drift).toContainText('clients');
  });

  test('adds and removes rows on an array field', async ({ page }) => {
    await openNewClaim(page);
    await safeClick(tab(page, 'Settlement'));

    const items = fieldById(page, 'lineItems');
    const rows = items.locator('.ngx-field__array-item');
    const before = await rows.count();

    await items.getByRole('button', { name: /Add/i }).first().click();
    await expect(rows).toHaveCount(before + 1);

    // Row columns come from the array field's children.
    await expect(items.locator('input').first()).toBeVisible();

    await items.getByRole('button', { name: /Remove/i }).first().click();
    await expect(rows).toHaveCount(before);
  });

  test('masks fields for a masked role and reveals them otherwise', async ({ page }) => {
    // IT_SUPPORT is granted view but not edit, so it gets no Add button — the record has to
    // exist first. That asymmetry is the point: a masked role can look, not author.
    await openNewClaim(page);
    await fieldPart(page, 'nationalId', 'input').fill('QQ123456C');
    await createClaim(page, 'CLM-MASK-1');

    await safeClick(page.getByRole('button', { name: 'IT Support (Masked Salary)' }));
    await safeClick(page.getByRole('button', { name: /CLM-MASK-1/i }).first());
    await expect(fieldPart(page, 'nationalId', 'masked')).toHaveText('XXXXXXXXX');

    await safeClick(page.getByRole('button', { name: /Back to List/i }));
    await safeClick(page.getByRole('button', { name: 'Admin' }));
    await safeClick(page.getByRole('button', { name: /CLM-MASK-1/i }).first());
    await expect(fieldPart(page, 'nationalId', 'input')).toHaveValue('QQ123456C');
  });

  /**
   * The round trip that mixes both record shapes: `claimant` is flatData so its fields sit at
   * the record root, while every other tab nests under its id. Saving and reopening is the
   * only way to prove the two directions agree.
   */
  test('saves a record across flat and nested tabs, and reloads it', async ({ page }) => {
    await openNewClaim(page);

    await unlockClaimRef(page);
    await fieldPart(page, 'claimRef', 'input').fill('CLM-90210');
    await fieldPart(page, 'claimantEmail', 'input').fill('dana@example.com');

    await safeClick(tab(page, 'Policy'));
    await fieldPart(page, 'sumInsured', 'input').fill('48000');
    await fieldPart(page, 'policyNote', 'input').fill('Renewed cover');

    await safeClick(tab(page, 'Incident'));
    await fieldPart(page, 'incidentDate', 'input').fill('2026-02-11');
    await fieldPart(page, 'narrative', 'input').fill('Water ingress through the roof.');

    await safeClick(page.getByTestId('form-submit'));

    // Back in the list, the new claim is there under its flatData field.
    await expect(page.getByText('CLM-90210').first()).toBeVisible();

    await safeClick(page.getByRole('button', { name: /CLM-90210/i }).first());

    // Flat tab. claimRef is a criticalField, so it is locked until unlocked — the same
    // as on create. The value is there either way; unlocking is how the input reappears.
    await expect(fieldPart(page, 'claimRef', 'value')).toHaveText('CLM-90210');
    await unlockClaimRef(page);
    await expect(fieldPart(page, 'claimRef', 'input')).toHaveValue('CLM-90210');
    await expect(fieldPart(page, 'claimantEmail', 'input')).toHaveValue('dana@example.com');

    // Nested tabs.
    await safeClick(tab(page, 'Policy'));
    await expect(fieldPart(page, 'sumInsured', 'input')).toHaveValue('48000');
    await expect(fieldPart(page, 'policyNote', 'input')).toHaveValue('Renewed cover');

    await safeClick(tab(page, 'Incident'));
    await expect(fieldPart(page, 'narrative', 'input')).toHaveValue('Water ingress through the roof.');
  });
});
