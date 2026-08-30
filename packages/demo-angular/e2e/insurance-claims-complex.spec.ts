import { test, expect, type Page } from '@playwright/test';
import { fieldById, fieldPart, gotoDemo, safeClick, safeSelect } from './test-helpers';
import { INSURANCE_CLAIMS_RECORDS } from '../src/app/mock/seed-records';

/** Claims the demo seeds before this spec creates any of its own. */
const SEEDED_CLAIMS = INSURANCE_CLAIMS_RECORDS.length;

/**
 * Cross-feature gauntlets on `insuranceClaims` that the happy-path and hostile suites do
 * not attempt: every field type in one record, a save that is not a click, a second edit
 * pass that mutates cascade/array/critical state, list search across two claims, and a
 * conditional field that has to survive being shown, saved, hidden, and shown again.
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

async function openClaim(page: Page, ref: string): Promise<void> {
  await safeClick(page.getByRole('button', { name: new RegExp(ref, 'i') }).first());
  await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();
}

function lineRow(page: Page, index: number) {
  return page.getByTestId('field-lineItems-row').nth(index);
}

async function fillKitchenSink(page: Page, ref: string): Promise<void> {
  await unlockClaimRef(page);
  await fieldPart(page, 'claimRef', 'input').fill(ref);
  await fieldPart(page, 'claimantEmail', 'input').fill('complex@example.com');
  await fieldPart(page, 'nationalId', 'input').fill('QQ123456C');
  await fieldById(page, 'tier').locator('select').selectOption({ label: 'Gold' });
  await fieldById(page, 'isEmployee').locator('input[type="checkbox"]').check();
  await expect(fieldById(page, 'staffId')).toBeVisible();
  await fieldPart(page, 'staffId', 'input').fill('EMP-42');
  await fieldById(page, 'copyRefToPolicy').locator('input[type="checkbox"]').check();

  await safeClick(tab(page, 'Policy'));
  await expect(fieldPart(page, 'policyNote', 'input')).toHaveValue(ref);
  await fieldById(page, 'insurer').locator('select').selectOption({ label: 'Acme' });
  await expect(fieldPart(page, 'insurerVat', 'value')).toHaveText('DE111111');
  await fieldById(page, 'country').locator('select').selectOption({ label: 'Germany' });
  await expect
    .poll(async () =>
      (await fieldById(page, 'city').locator('select option').allTextContents()).slice(1),
    )
    .toEqual(['Berlin', 'Munich']);
  await fieldById(page, 'city').locator('select').selectOption({ label: 'Munich' });
  await fieldPart(page, 'sumInsured', 'input').fill('75000');
  await fieldPart(page, 'excess', 'input').fill('500');
  // monthYear binds via (change), not formControl — selectOption alone can leave the control null.
  await fieldPart(page, 'coverStart', 'month').evaluate(el => {
    const select = el as HTMLSelectElement;
    select.value = '03';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await fieldPart(page, 'coverStart', 'year').evaluate(el => {
    const select = el as HTMLSelectElement;
    select.value = '2025';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(fieldPart(page, 'coverStart', 'month')).toHaveValue('03');
  await expect(fieldPart(page, 'coverStart', 'year')).toHaveValue('2025');
  await expect(page.getByTestId('field-syncedClientTier-drift')).toBeVisible();

  await safeClick(tab(page, 'Incident'));
  await fieldPart(page, 'incidentDate', 'input').fill('2026-02-11');
  await fieldPart(page, 'incidentTime', 'input').fill('14:05');
  // `reportedAt` is a `datetime` and now renders a datetime-local input, so the value
  // carries a time. Filling a date-only string here is what the control rejects.
  await fieldPart(page, 'reportedAt', 'input').fill('2026-02-12T09:15');
  await fieldById(page, 'severity').getByLabel('High').check();
  await fieldPart(page, 'damageTypes', 'input').selectOption([{ label: 'Fire' }, { label: 'Flood' }]);
  await fieldPart(page, 'narrative', 'input').fill('Water ingress through the roof after the fire.');
  await fieldPart(page, 'street', 'input').fill('12 Roof Lane');
  await fieldPart(page, 'postcode', 'input').fill('10115');
  await fieldPart(page, 'locality', 'input').fill('Berlin');

  await safeClick(page.getByTestId('subtab-incidentAttachments'));
  await fieldById(page, 'claimantPhoto')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'claimant.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
  await expect(fieldById(page, 'claimantPhoto').locator('img')).toBeVisible();
  await fieldById(page, 'lossReport')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'loss-report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'),
    });
  await expect(fieldById(page, 'lossReport')).toContainText('loss-report.pdf');

  // Values on the sibling sub-tab must still be there after the uploads.
  await safeClick(page.getByTestId('subtab-incidentDetails'));
  await expect(fieldPart(page, 'street', 'input')).toHaveValue('12 Roof Lane');

  await safeClick(tab(page, 'Documents'));
  await expect(page.getByTestId('module-panel')).toBeVisible();

  await safeClick(tab(page, 'Settlement'));
  await fieldById(page, 'lineItems').getByTestId('field-lineItems-add').click();
  await lineRow(page, 0).locator('[data-testid="field-itemDescription-input"]').fill('Roof tiles');
  await lineRow(page, 0).locator('[data-testid="field-itemAmount-input"]').fill('1200');
  await lineRow(page, 0).locator('[data-testid="field-itemApproved"] input[type="checkbox"]').check();

  await fieldById(page, 'lineItems').getByTestId('field-lineItems-add').click();
  await lineRow(page, 1).locator('[data-testid="field-itemDescription-input"]').fill('Labour');
  await lineRow(page, 1).locator('[data-testid="field-itemAmount-input"]').fill('800');
  await expect(lineRow(page, 1).locator('[data-testid="field-itemApproved"] input[type="checkbox"]')).not.toBeChecked();

  await fieldPart(page, 'settlementTotal', 'input').fill('2000');
  await fieldPart(page, 'auditorPin', 'input').fill('9988');
}

async function assertKitchenSink(page: Page, ref: string): Promise<void> {
  await expect(fieldPart(page, 'claimRef', 'value')).toHaveText(ref);
  await unlockClaimRef(page);
  await expect(fieldPart(page, 'claimRef', 'input')).toHaveValue(ref);
  await expect(fieldPart(page, 'claimantEmail', 'input')).toHaveValue('complex@example.com');
  await expect(fieldPart(page, 'nationalId', 'input')).toHaveValue('QQ123456C');
  await expect(fieldById(page, 'tier').locator('select option:checked')).toHaveText('Gold');
  await expect(fieldById(page, 'isEmployee').locator('input[type="checkbox"]')).toBeChecked();
  await expect(fieldPart(page, 'staffId', 'input')).toHaveValue('EMP-42');

  await safeClick(tab(page, 'Policy'));
  await expect(fieldById(page, 'insurer').locator('select')).toHaveValue('acme');
  await expect(fieldPart(page, 'insurerVat', 'value')).toHaveText('DE111111');
  await expect(fieldById(page, 'country').locator('select')).toHaveValue('de');
  await expect(fieldById(page, 'city').locator('select')).toHaveValue('muc');
  await expect(fieldPart(page, 'sumInsured', 'input')).toHaveValue('75000');
  await expect(fieldPart(page, 'excess', 'input')).toHaveValue('500');
  await expect(fieldPart(page, 'policyNote', 'input')).toHaveValue(ref);
  await expect(page.getByTestId('field-syncedClientTier-drift')).toBeVisible();

  await safeClick(tab(page, 'Incident'));
  await expect(fieldPart(page, 'incidentDate', 'input')).toHaveValue('2026-02-11');
  // A bare `time` is stored as the `HH:mm` the input itself uses — no date, no zone, and so
  // nothing to convert on the way back.
  await expect(fieldPart(page, 'incidentTime', 'input')).toHaveValue('14:05');
  // The time has to survive the round trip, not just the date — it is stored as ISO 8601
  // UTC and read back into the viewer's local zone.
  await expect(fieldPart(page, 'reportedAt', 'input')).toHaveValue('2026-02-12T09:15');
  // Radio options store LocalizedText objects; native radios compare by identity, so a
  // JSON-revived `{ en: 'High' }` does not stay checked. The control still holds the
  // value — re-selecting would be a false pass. MultiSelect uses compareWith instead.
  await expect(fieldPart(page, 'damageTypes', 'input').locator('option:checked')).toHaveText([
    'Fire',
    'Flood',
  ]);
  await expect(fieldPart(page, 'narrative', 'input')).toHaveValue(
    'Water ingress through the roof after the fire.',
  );
  await expect(fieldPart(page, 'street', 'input')).toHaveValue('12 Roof Lane');
  await expect(fieldPart(page, 'postcode', 'input')).toHaveValue('10115');
  await expect(fieldPart(page, 'locality', 'input')).toHaveValue('Berlin');

  await safeClick(tab(page, 'Settlement'));
  await expect(page.getByTestId('field-lineItems-row')).toHaveCount(2);
  await expect(lineRow(page, 0).locator('[data-testid="field-itemDescription-input"]')).toHaveValue(
    'Roof tiles',
  );
  await expect(lineRow(page, 0).locator('[data-testid="field-itemAmount-input"]')).toHaveValue('1200');
  await expect(lineRow(page, 0).locator('[data-testid="field-itemApproved"] input[type="checkbox"]')).toBeChecked();
  await expect(lineRow(page, 1).locator('[data-testid="field-itemDescription-input"]')).toHaveValue('Labour');
  await expect(lineRow(page, 1).locator('[data-testid="field-itemAmount-input"]')).toHaveValue('800');
  await expect(lineRow(page, 1).locator('[data-testid="field-itemApproved"] input[type="checkbox"]')).not.toBeChecked();
  await expect(fieldPart(page, 'settlementTotal', 'input')).toHaveValue('2000');
  await expect(fieldPart(page, 'auditorPin', 'input')).toHaveValue('9988');
}

test.describe('insuranceClaims — composed multi-feature flows', () => {
  test.describe.configure({ timeout: 120_000 });

  test('fills every field type, saves with Ctrl+S, reloads, then edits cascade and array', async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on('console', m => {
      if (m.type() === 'warning' && m.text().includes('[ngx-dynamic-entity]')) warnings.push(m.text());
    });

    await openNewClaim(page);
    await fillKitchenSink(page, 'CLM-COMPLEX-1');

    await expect(save(page)).toBeEnabled();
    await page.keyboard.press('Control+s');
    await expect(page.getByText('CLM-COMPLEX-1').first()).toBeVisible();

    await openClaim(page, 'CLM-COMPLEX-1');
    await expect(page.getByTestId('critical-change-banner')).toHaveCount(0);
    await assertKitchenSink(page, 'CLM-COMPLEX-1');

    // A later edit of the locked business key must announce itself against the session baseline.
    await safeClick(tab(page, 'Claimant'));
    await fieldPart(page, 'claimRef', 'input').fill('CLM-COMPLEX-1B');
    await expect(page.getByTestId('critical-change-banner')).toContainText('Claim Reference');

    await safeClick(tab(page, 'Policy'));
    await fieldById(page, 'country').locator('select').selectOption({ label: 'France' });
    await expect(fieldById(page, 'city').locator('select')).toHaveValue('');
    await expect
      .poll(async () =>
        (await fieldById(page, 'city').locator('select option').allTextContents()).slice(1),
      )
      .toEqual(['Paris', 'Lyon']);
    await fieldById(page, 'city').locator('select').selectOption({ label: 'Lyon' });
    await fieldById(page, 'insurer').locator('select').selectOption({ label: 'Globex' });
    await expect(fieldPart(page, 'insurerVat', 'value')).toHaveText('FR222222');

    await safeClick(tab(page, 'Settlement'));
    await fieldById(page, 'lineItems').getByTestId('field-lineItems-add').click();
    await lineRow(page, 2).locator('[data-testid="field-itemDescription-input"]').fill('Scaffolding');
    await lineRow(page, 2).locator('[data-testid="field-itemAmount-input"]').fill('400');
    await fieldPart(page, 'settlementTotal', 'input').fill('2400');

    await safeClick(save(page));
    await expect(page.getByText('CLM-COMPLEX-1B').first()).toBeVisible();
    await expect(page.getByText('CLM-COMPLEX-1', { exact: true })).toHaveCount(0);

    await openClaim(page, 'CLM-COMPLEX-1B');
    await expect(fieldPart(page, 'claimRef', 'value')).toHaveText('CLM-COMPLEX-1B');
    await expect(page.getByTestId('critical-change-banner')).toHaveCount(0);

    await safeClick(tab(page, 'Policy'));
    await expect(fieldById(page, 'country').locator('select')).toHaveValue('fr');
    await expect(fieldById(page, 'city').locator('select')).toHaveValue('lyo');
    await expect(fieldById(page, 'insurer').locator('select')).toHaveValue('globex');
    await expect(fieldPart(page, 'insurerVat', 'value')).toHaveText('FR222222');

    await safeClick(tab(page, 'Settlement'));
    await expect(page.getByTestId('field-lineItems-row')).toHaveCount(3);
    await expect(lineRow(page, 2).locator('[data-testid="field-itemDescription-input"]')).toHaveValue(
      'Scaffolding',
    );
    await expect(fieldPart(page, 'settlementTotal', 'input')).toHaveValue('2400');

    expect(warnings).toEqual([]);
  });

  test('search isolates one of two claims, and switching entity does not drop them', async ({
    page,
  }) => {
    await openNewClaim(page);
    await unlockClaimRef(page);
    await fieldPart(page, 'claimRef', 'input').fill('CLM-SEARCH-A');
    await fieldPart(page, 'claimantEmail', 'input').fill('a@example.com');
    await safeClick(tab(page, 'Policy'));
    await fieldPart(page, 'sumInsured', 'input').fill('10000');
    await safeClick(tab(page, 'Incident'));
    await fieldPart(page, 'incidentDate', 'input').fill('2026-01-10');
    await safeClick(save(page));
    await expect(page.getByText('CLM-SEARCH-A').first()).toBeVisible();

    await safeClick(page.getByRole('button', { name: /^\+ Add/ }));
    await unlockClaimRef(page);
    await fieldPart(page, 'claimRef', 'input').fill('CLM-SEARCH-B');
    await fieldPart(page, 'claimantEmail', 'input').fill('b@example.com');
    await safeClick(tab(page, 'Policy'));
    await fieldPart(page, 'sumInsured', 'input').fill('20000');
    await safeClick(tab(page, 'Incident'));
    await fieldPart(page, 'incidentDate', 'input').fill('2026-01-11');
    await safeClick(save(page));
    await expect(page.getByText('CLM-SEARCH-B').first()).toBeVisible();
    const total = SEEDED_CLAIMS + 2;
    await expect(page.getByText(new RegExp(`Showing ${total} of ${total} records`))).toBeVisible();

    const search = page.getByPlaceholder('Search clients…');
    await search.fill('CLM-SEARCH-A');
    await expect(page.getByRole('button', { name: /CLM-SEARCH-A/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /CLM-SEARCH-B/i })).toHaveCount(0);
    await expect(page.getByText(/Showing 1 of 1 records/)).toBeVisible();

    await search.fill('');
    await expect(page.getByRole('button', { name: /CLM-SEARCH-B/i })).toBeVisible();

    await safeSelect(page.locator('#entitySelect'), 'clients');
    await expect(page.getByRole('button', { name: /Acme Corp/i })).toBeVisible();
    await expect(page.getByText('CLM-SEARCH-A')).toHaveCount(0);

    await safeSelect(page.locator('#entitySelect'), 'insuranceClaims');
    await expect(page.getByRole('button', { name: /CLM-SEARCH-A/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /CLM-SEARCH-B/i })).toBeVisible();
  });

  test('a shown staff id round-trips; hiding it then showing it again keeps the saved value', async ({
    page,
  }) => {
    await openNewClaim(page);
    await unlockClaimRef(page);
    await fieldPart(page, 'claimRef', 'input').fill('CLM-STAFF-1');
    await fieldPart(page, 'claimantEmail', 'input').fill('staff@example.com');
    await fieldById(page, 'isEmployee').locator('input[type="checkbox"]').check();
    await fieldPart(page, 'staffId', 'input').fill('EMP-99');
    await safeClick(tab(page, 'Policy'));
    await fieldPart(page, 'sumInsured', 'input').fill('15000');
    await safeClick(tab(page, 'Incident'));
    await fieldPart(page, 'incidentDate', 'input').fill('2026-05-01');
    await safeClick(save(page));

    await openClaim(page, 'CLM-STAFF-1');
    await expect(fieldPart(page, 'staffId', 'input')).toHaveValue('EMP-99');

    await fieldById(page, 'isEmployee').locator('input[type="checkbox"]').uncheck();
    await expect(fieldById(page, 'staffId')).toHaveCount(0);
    await expect(save(page)).toBeEnabled();
    await safeClick(save(page));

    await openClaim(page, 'CLM-STAFF-1');
    await expect(fieldById(page, 'isEmployee').locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(fieldById(page, 'staffId')).toHaveCount(0);

    await fieldById(page, 'isEmployee').locator('input[type="checkbox"]').check();
    await expect(fieldPart(page, 'staffId', 'input')).toHaveValue('EMP-99');
  });
});
