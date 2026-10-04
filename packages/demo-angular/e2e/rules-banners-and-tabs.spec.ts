import { expect, test, type Page } from '@playwright/test';
import { fieldById, fieldPart, gotoDemo, recordButton, safeClick, safeFill, safeSelect } from './test-helpers';

/**
 * The rule behaviours a person sees and the engine's unit suites cannot show: an info banner
 * that comes and goes, one that can be dismissed, a tab that leaves the form and stops
 * guarding Save, a warning that compares against the record as it was opened, and a field
 * that answers an array growing.
 *
 * Every rule here is one of the four `patientIntake` rules in `src/app/mock/demo-rules.ts`.
 * Each test asserts what lands in storage as well as what renders, so a rule that changed
 * the screen but not the save — or the reverse — fails.
 */

const ENTITY = 'patientIntake';
const PAIN_BANNER = 'info-banner-[clinicalHistory.painLevel]';
const TRIAGE_WARNING = 'rule-warning-[demographics.triageLevel]';

type Row = Record<string, Record<string, unknown> | unknown>;

async function storedRecords(page: Page): Promise<Row[]> {
  return page.evaluate(key => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Row[]) : [];
  }, `de_demo_records_${ENTITY}`);
}

async function storedRecord(page: Page, id: string): Promise<Record<string, Record<string, unknown>>> {
  const row = (await storedRecords(page)).find(r => r['_id'] === id);
  if (!row) throw new Error(`no stored ${ENTITY} record ${id}`);
  return row as Record<string, Record<string, unknown>>;
}

async function openEntity(page: Page): Promise<void> {
  await gotoDemo(page);
  await safeSelect(page.locator('#entitySelect'), ENTITY);
}

/** Eleanor Vance is `patient_001`: an adult, triage "3 - Urgent", no pain level recorded. */
async function openEleanor(page: Page): Promise<void> {
  await openEntity(page);
  await safeClick(recordButton(page, 'Eleanor Vance'));
  await expect(page.getByTestId('form-panel')).toBeVisible();
}

const saveButton = (page: Page) => page.getByTestId('form-submit');
const backToList = (page: Page) => page.getByRole('button', { name: '← Back to List' });

/** A `YYYY-MM-DD` this many years before today. */
function yearsAgo(years: number): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear() - years}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test.describe('info banners', () => {
  test('appears while pain is 8 or more, goes when it drops, and is saved with the record', async ({ page }) => {
    await openEleanor(page);
    await safeClick(page.getByTestId('tab-clinicalHistory'));
    const pain = fieldPart(page, 'painLevel', 'input');

    await expect(page.getByTestId(PAIN_BANNER)).toHaveCount(0);

    await pain.fill('8');
    // MORE_THAN_EQUAL: the boundary itself fires.
    await expect(page.getByTestId(PAIN_BANNER)).toContainText('Severe pain reported');

    await pain.fill('7');
    await expect(page.getByTestId(PAIN_BANNER)).toHaveCount(0);

    await pain.fill('9');
    await expect(page.getByTestId(PAIN_BANNER)).toBeVisible();
    await safeClick(saveButton(page));

    expect((await storedRecord(page, 'patient_001'))['clinicalHistory']['painLevel']).toBe(9);

    // Reopened, the banner comes from the stored value, not from anything typed this session.
    await safeClick(recordButton(page, 'Eleanor Vance'));
    await expect(page.getByTestId(PAIN_BANNER)).toBeVisible();
  });

  /*
   * The record view's contract (`DynamicRecordFormComponent.dismissed`): a dismissed banner
   * stays dismissed for the rest of that record's session, even if its rule stops and fires
   * again, and loading the record again re-arms it.
   */
  test('in the record view, dismissing holds for the session and reopening re-arms it', async ({ page }) => {
    await openEleanor(page);
    await safeClick(page.getByTestId('toggle-record-view'));
    await safeClick(page.getByTestId('tab-clinicalHistory'));
    await safeClick(page.getByTestId('edit-section'));

    const pain = fieldPart(page, 'painLevel', 'input');
    await pain.fill('9');

    const banner = page.getByTestId(PAIN_BANNER);
    await expect(banner).toContainText('Severe pain reported');
    // The record view draws the banner itself; the inner form's copy is switched off.
    await expect(banner).toHaveCount(1);

    await safeClick(page.getByTestId('dismiss-[clinicalHistory.painLevel]'));
    await expect(banner).toHaveCount(0);

    await pain.fill('2');
    await pain.fill('10');
    await expect(banner).toHaveCount(0);

    await safeClick(page.getByTestId('save-section'));
    await expect(page.getByTestId('edit-section')).toBeVisible();
    expect((await storedRecord(page, 'patient_001'))['clinicalHistory']['painLevel']).toBe(10);

    await safeClick(backToList(page));
    await safeClick(recordButton(page, 'Eleanor Vance'));
    await safeClick(page.getByTestId('tab-clinicalHistory'));
    await expect(page.getByTestId(PAIN_BANNER)).toBeVisible();
  });
});

test.describe('a rule that hides a tab', () => {
  async function fillEverythingButConsent(page: Page, name: string, dateOfBirth: string): Promise<void> {
    await safeClick(page.getByRole('button', { name: '+ Add Record' }));
    await expect(page.getByTestId('form-panel')).toBeVisible();

    await safeFill(fieldPart(page, 'fullName', 'input'), name);
    await safeFill(fieldPart(page, 'dateOfBirth', 'input'), dateOfBirth);
    await safeSelect(fieldPart(page, 'triageLevel', 'input'), '4 - Less Urgent');
    await safeFill(fieldPart(page, 'emergencyContact', 'input'), 'A. Guardian - +1 555-010-0000');

    await safeClick(page.getByTestId('tab-clinicalHistory'));
    await safeFill(fieldPart(page, 'chiefComplaint', 'input'), 'Sprained wrist.');

    await safeClick(page.getByTestId('tab-billingInsurance'));
    await safeSelect(fieldPart(page, 'insuranceType', 'input'), 'Self-Pay / Uninsured');
  }

  test('the consent tab leaves for a minor and returns for an adult', async ({ page }) => {
    await openEntity(page);
    await safeClick(page.getByRole('button', { name: '+ Add Record' }));
    const consentTab = page.getByTestId('tab-consentSignoff');

    await expect(consentTab).toBeVisible();

    await safeFill(fieldPart(page, 'dateOfBirth', 'input'), yearsAgo(10));
    await expect(consentTab).toHaveCount(0);

    await safeFill(fieldPart(page, 'dateOfBirth', 'input'), yearsAgo(40));
    await expect(consentTab).toBeVisible();
  });

  test('its required fields do not block Save while it is hidden', async ({ page }) => {
    await openEntity(page);
    const before = (await storedRecords(page)).length;

    await fillEverythingButConsent(page, 'Minor Patient', yearsAgo(10));
    await expect(page.getByTestId('tab-consentSignoff')).toHaveCount(0);
    await safeClick(saveButton(page));

    // Back on the list with one more record: the save went through.
    await expect(recordButton(page, 'Minor Patient')).toBeVisible();
    const rows = await storedRecords(page);
    expect(rows).toHaveLength(before + 1);
    const saved = rows.find(r => (r['demographics'] as Record<string, unknown>)?.['fullName'] === 'Minor Patient');
    expect(saved).toBeDefined();
    const consent = (saved!['consentSignoff'] ?? {}) as Record<string, unknown>;
    expect(consent['hipaaConsent'] ?? null).not.toBe(true);
    expect(consent['admittingClinician'] ?? '').toBe('');
  });

  test('the same record as an adult is refused until consent is given', async ({ page }) => {
    await openEntity(page);
    const before = (await storedRecords(page)).length;

    await fillEverythingButConsent(page, 'Adult Patient', yearsAgo(40));
    await expect(page.getByTestId('tab-consentSignoff')).toBeVisible();
    await safeClick(saveButton(page));

    await expect(page.getByTestId('error-summary')).toBeVisible();
    await expect(page.getByTestId('error-summary-admittingClinician')).toBeVisible();
    expect(await storedRecords(page)).toHaveLength(before);
  });
});

test.describe('VALUE_CHANGED', () => {
  test('warns only while triage differs from the loaded record, and does not block Save', async ({ page }) => {
    await openEleanor(page);
    const triage = fieldPart(page, 'triageLevel', 'input');
    const warning = page.getByTestId(TRIAGE_WARNING);

    // Loaded, not changed: a VALUE_CHANGED rule that fired on open would be comparing
    // against the wrong baseline.
    await expect(warning).toHaveCount(0);

    await safeSelect(triage, '2 - Emergent');
    await expect(warning).toContainText('Triage level changed');

    // Back to the loaded value: no longer a change.
    await safeSelect(triage, '3 - Urgent');
    await expect(warning).toHaveCount(0);

    await safeSelect(triage, '2 - Emergent');
    await safeClick(saveButton(page));

    // A warning is not an error: the record saved.
    const demographics = (await storedRecord(page, 'patient_001'))['demographics'];
    expect(demographics['triageLevel']).toMatchObject({ en: '2 - Emergent' });

    // The saved value is the new baseline.
    await safeClick(recordButton(page, 'Eleanor Vance'));
    await expect(fieldPart(page, 'triageLevel', 'input')).toBeVisible();
    await expect(page.getByTestId(TRIAGE_WARNING)).toHaveCount(0);
  });
});

test.describe('HAS_ITEMS', () => {
  test('the first allergen shows the action plan and removing the last hides it', async ({ page }) => {
    await openEleanor(page);
    await safeClick(page.getByTestId('tab-clinicalHistory'));
    const plan = fieldById(page, 'allergyActionPlan');
    const tags = fieldPart(page, 'knownAllergens', 'input');

    // `visibility: false` in the config, and nothing has shown it yet.
    await expect(plan).toHaveCount(0);

    await tags.fill('Penicillin');
    await tags.press('Enter');
    await expect(plan).toBeVisible();

    await tags.press('Backspace');
    await expect(fieldPart(page, 'knownAllergens', 'tag')).toHaveCount(0);
    await expect(plan).toHaveCount(0);

    await tags.fill('Penicillin');
    await tags.press('Enter');
    await safeFill(fieldPart(page, 'allergyActionPlan', 'input'), 'EpiPen in the left pocket.');
    await safeClick(saveButton(page));

    const clinical = (await storedRecord(page, 'patient_001'))['clinicalHistory'];
    expect(clinical['knownAllergens']).toEqual(['Penicillin']);
    expect(clinical['allergyActionPlan']).toBe('EpiPen in the left pocket.');
  });
});
