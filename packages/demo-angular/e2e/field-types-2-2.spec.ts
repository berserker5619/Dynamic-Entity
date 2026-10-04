import { expect, test, type Page } from '@playwright/test';
import { fieldPart, gotoDemo, recordButton, safeClick, safeFill, safeSelect } from './test-helpers';

/**
 * The seven field types 2.2 added, each edited, saved and read back in a browser.
 *
 * The unit specs mount each component alone. What only a round trip shows is what reaches
 * storage, what the control renders when the record is opened again, and what the read-only
 * presentations make of the stored value. So every test asserts the stored record as well as
 * the screen.
 *
 * - `clients` carries url, phone, color and tags (flat at the record root);
 * - `patientIntake` carries slider and rating;
 * - `insuranceClaims` (from test_data.json) carries time, two levels down.
 */

type Row = Record<string, unknown>;

async function stored(page: Page, entity: string, id: string): Promise<Row> {
  const row = await page.evaluate(
    ([key, recordId]) => {
      const raw = localStorage.getItem(key);
      const rows = raw ? (JSON.parse(raw) as Record<string, unknown>[]) : [];
      return rows.find(r => r['_id'] === recordId) ?? null;
    },
    [`de_demo_records_${entity}`, id] as const,
  );
  if (!row) throw new Error(`no stored ${entity} record ${id}`);
  return row;
}

/**
 * Write values into a stored record, then reload the list so the demo reads them.
 *
 * The only way to put a value in front of the form that the form itself would refuse — a
 * `javascript:` URL, or a colour written `#ABC` — which is exactly what a record from an API
 * or an older version can hold.
 */
async function seed(page: Page, entity: string, id: string, values: Row): Promise<void> {
  await page.evaluate(
    ([key, recordId, patch]) => {
      const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as Record<string, unknown>[];
      const row = rows.find(r => r['_id'] === recordId);
      if (!row) throw new Error(`no record ${recordId}`);
      Object.assign(row, patch);
      localStorage.setItem(key, JSON.stringify(rows));
    },
    [`de_demo_records_${entity}`, id, values] as const,
  );
  // Switching entity away and back re-reads the store.
  await safeSelect(page.locator('#entitySelect'), entity === 'clients' ? 'employees' : 'clients');
  await safeSelect(page.locator('#entitySelect'), entity);
}

const save = (page: Page) => safeClick(page.getByTestId('form-submit'));

/** Acme Corp is `client_001`. */
async function openAcme(page: Page): Promise<void> {
  await safeClick(recordButton(page, 'Acme Corp'));
  await expect(page.getByTestId('form-panel')).toBeVisible();
}

test.describe('clients: url, phone, color, tags', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('url refuses an address that is not one, and stores one that is', async ({ page }) => {
    await openAcme(page);
    const input = fieldPart(page, 'website', 'input');

    await safeFill(input, 'acme dot com');
    await save(page);
    await expect(page.getByTestId('error-summary-website')).toBeVisible();
    await expect(fieldPart(page, 'website', 'error')).toHaveText(
      'Please enter a full web address, starting with https://.',
    );
    expect((await stored(page, 'clients', 'client_001'))['website'] ?? null).not.toBe('acme dot com');

    await safeFill(input, 'https://acme.example/about');
    await save(page);
    expect((await stored(page, 'clients', 'client_001'))['website']).toBe('https://acme.example/about');

    await openAcme(page);
    await expect(fieldPart(page, 'website', 'input')).toHaveValue('https://acme.example/about');
  });

  test('url read-only is a link for https: and plain text for javascript:', async ({ page }) => {
    await seed(page, 'clients', 'client_001', { website: 'https://acme.example' });
    await openAcme(page);
    await safeClick(page.getByTestId('mode-data'));
    const link = fieldPart(page, 'website', 'value').locator('a');
    await expect(link).toHaveAttribute('href', 'https://acme.example');

    await seed(page, 'clients', 'client_001', { website: 'javascript:alert(1)' });
    await openAcme(page);
    await safeClick(page.getByTestId('mode-data'));
    const value = fieldPart(page, 'website', 'value');
    await expect(value).toContainText('javascript:alert(1)');
    await expect(value.locator('a')).toHaveCount(0);
  });

  test('phone refuses a number that is not one, and keeps separators as typed', async ({ page }) => {
    await openAcme(page);
    const input = fieldPart(page, 'phone', 'input');

    await safeFill(input, '12');
    await save(page);
    await expect(fieldPart(page, 'phone', 'error')).toHaveText('Please enter a valid phone number.');

    await safeFill(input, '+1 (555) 010-2030');
    await save(page);
    expect((await stored(page, 'clients', 'client_001'))['phone']).toBe('+1 (555) 010-2030');

    await openAcme(page);
    await expect(fieldPart(page, 'phone', 'input')).toHaveValue('+1 (555) 010-2030');
    await safeClick(page.getByTestId('mode-data'));
    await expect(fieldPart(page, 'phone', 'value').locator('a')).toHaveAttribute('href', /^tel:/);
  });

  test('color stores the picked #rrggbb, and shows a stored #ABC as #aabbcc', async ({ page }) => {
    await openAcme(page);
    await fieldPart(page, 'brandColor', 'input').fill('#3366ff');
    await expect(fieldPart(page, 'brandColor', 'code')).toHaveText('#3366ff');
    await save(page);
    expect((await stored(page, 'clients', 'client_001'))['brandColor']).toBe('#3366ff');

    // A shorthand colour written by something other than the picker.
    await seed(page, 'clients', 'client_001', { brandColor: '#ABC' });
    await openAcme(page);
    await expect(fieldPart(page, 'brandColor', 'code')).toHaveText('#aabbcc');
    await expect(fieldPart(page, 'brandColor', 'input')).toHaveValue('#aabbcc');
    await safeClick(page.getByTestId('mode-data'));
    await expect(fieldPart(page, 'brandColor', 'value')).toContainText('#aabbcc');
  });

  test('color: an imported #ABC is stored as #aabbcc', async ({ page }) => {
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByTestId('import-file').setInputFiles({
      name: 'colours.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Name,Brand colour\r\nHue Industries,#ABC\r\n', 'utf8'),
    });
    await safeClick(page.getByTestId('import-to-review'));
    await safeClick(page.getByTestId('import-commit'));
    await expect(page.getByTestId('demo-import-saved')).toContainText('1');

    const colour = await page.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('de_demo_records_clients') ?? '[]') as Record<string, unknown>[];
      return rows.find(r => r['name'] === 'Hue Industries')?.['brandColor'];
    });
    expect(colour).toBe('#aabbcc');
  });

  test('tags: Enter, comma and semicolon add; Backspace removes; a repeat is dropped', async ({ page }) => {
    await openAcme(page);
    const input = fieldPart(page, 'labels', 'input');
    const tags = fieldPart(page, 'labels', 'tag');

    await input.fill('alpha');
    await input.press('Enter');
    await input.fill('beta');
    await input.press(',');
    await input.fill('gamma');
    await input.press(';');
    await expect(tags).toHaveText(['alpha', 'beta', 'gamma'].map(t => new RegExp(`^\\s*${t}`)));

    // normalizeTags keeps the first occurrence, so a repeat changes nothing.
    await input.fill('alpha');
    await input.press('Enter');
    await expect(tags).toHaveCount(3);

    // Backspace in an empty box takes the last one.
    await input.press('Backspace');
    await expect(tags).toHaveCount(2);

    await save(page);
    expect((await stored(page, 'clients', 'client_001'))['labels']).toEqual(['alpha', 'beta']);

    await openAcme(page);
    await expect(fieldPart(page, 'labels', 'tag')).toHaveCount(2);
  });

  test('every value reads back in Data only and in the record view', async ({ page }) => {
    await seed(page, 'clients', 'client_001', {
      website: 'https://acme.example',
      phone: '+44 20 7946 0000',
      brandColor: '#3366ff',
      labels: ['key', 'renewal'],
    });
    await openAcme(page);

    for (const mode of ['mode-data', 'toggle-record-view']) {
      await safeClick(page.getByTestId(mode));
      await expect(fieldPart(page, 'website', 'value').locator('a')).toHaveText('https://acme.example');
      await expect(fieldPart(page, 'phone', 'value')).toContainText('+44 20 7946 0000');
      await expect(fieldPart(page, 'brandColor', 'value')).toContainText('#3366ff');
      await expect(fieldPart(page, 'labels', 'value')).toContainText('key');
      await expect(fieldPart(page, 'labels', 'value')).toContainText('renewal');
    }
  });
});

test.describe('patientIntake: slider and rating', () => {
  async function openEleanor(page: Page): Promise<void> {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'patientIntake');
    await safeClick(recordButton(page, 'Eleanor Vance'));
    await expect(page.getByTestId('form-panel')).toBeVisible();
  }

  test('slider: untouched says unset, arrows move by step, and the value is stored', async ({ page }) => {
    await openEleanor(page);
    await safeClick(page.getByTestId('tab-clinicalHistory'));
    const slider = fieldPart(page, 'painLevel', 'input');
    const readout = fieldPart(page, 'painLevel', 'readout');

    // A range input always shows a thumb; the readout is what says there is no value.
    await expect(readout).toHaveText('—');
    await expect(slider).toHaveAttribute('aria-valuetext', '—');

    await slider.fill('4');
    await expect(readout).toHaveText('4');
    await slider.press('ArrowRight');
    await expect(readout).toHaveText('5');
    await slider.press('ArrowRight');
    await slider.press('ArrowLeft');
    await slider.press('ArrowLeft');
    await expect(readout).toHaveText('4');
    await expect(slider).not.toHaveAttribute('aria-valuetext', /./);

    await save(page);
    const clinical = (await stored(page, 'patientIntake', 'patient_001'))['clinicalHistory'] as Row;
    expect(clinical['painLevel']).toBe(4);

    await safeClick(recordButton(page, 'Eleanor Vance'));
    await safeClick(page.getByTestId('tab-clinicalHistory'));
    await expect(fieldPart(page, 'painLevel', 'readout')).toHaveText('4');
    await expect(fieldPart(page, 'painLevel', 'input')).toHaveValue('4');
  });

  test('rating: stars are radios the keyboard can move, and the star count is stored', async ({ page }) => {
    await openEleanor(page);
    await safeClick(page.getByTestId('tab-consentSignoff'));

    const star = (n: number) => fieldPart(page, 'intakeExperience', `star-${n}`);
    await star(1).focus();
    await page.keyboard.press('Space');
    await expect(star(1)).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(star(3)).toBeChecked();
    await expect(star(1)).not.toBeChecked();

    await save(page);
    const consent = (await stored(page, 'patientIntake', 'patient_001'))['consentSignoff'] as Row;
    expect(consent['intakeExperience']).toBe(3);

    await safeClick(recordButton(page, 'Eleanor Vance'));
    await safeClick(page.getByTestId('mode-data'));
    await safeClick(page.getByTestId('tab-consentSignoff'));
    await expect(fieldPart(page, 'intakeExperience', 'value')).toContainText('3 of 5');
  });

  test('slider and rating read back in Data only and in the record view', async ({ page }) => {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'patientIntake');
    await page.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('de_demo_records_patientIntake') ?? '[]') as Record<
        string,
        Record<string, unknown>
      >[];
      rows[0]['clinicalHistory']['painLevel'] = 7;
      rows[0]['consentSignoff']['intakeExperience'] = 4;
      localStorage.setItem('de_demo_records_patientIntake', JSON.stringify(rows));
    });
    await safeSelect(page.locator('#entitySelect'), 'clients');
    await safeSelect(page.locator('#entitySelect'), 'patientIntake');
    await safeClick(recordButton(page, 'Eleanor Vance'));

    for (const mode of ['mode-data', 'toggle-record-view']) {
      await safeClick(page.getByTestId(mode));
      await safeClick(page.getByTestId('tab-clinicalHistory'));
      await expect(fieldPart(page, 'painLevel', 'value')).toHaveText('7');
      await safeClick(page.getByTestId('tab-consentSignoff'));
      await expect(fieldPart(page, 'intakeExperience', 'value')).toContainText('4 of 5');
    }
  });
});

test.describe('insuranceClaims: time', () => {
  test('HH:mm round-trips with no date and no timezone shift', async ({ page }) => {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'insuranceClaims');
    await safeClick(recordButton(page, 'CLM-2026-0431'));
    await safeClick(page.getByRole('tab', { name: 'Incident' }));

    const input = fieldPart(page, 'incidentTime', 'input');
    await expect(input).toHaveValue('02:40');

    // Late evening: a value converted through UTC anywhere east or west of it would move day
    // or hour, and a Date would gain a date part.
    await input.fill('23:15');
    await save(page);

    const incident = (await stored(page, 'insuranceClaims', 'claim_001'))['incident'] as Record<string, Row>;
    expect(incident['incidentDetails']['incidentTime']).toBe('23:15');

    await safeClick(recordButton(page, 'CLM-2026-0431'));
    await safeClick(page.getByRole('tab', { name: 'Incident' }));
    await expect(fieldPart(page, 'incidentTime', 'input')).toHaveValue('23:15');

    for (const mode of ['mode-data', 'toggle-record-view']) {
      await safeClick(page.getByTestId(mode));
      await safeClick(page.getByRole('tab', { name: 'Incident' }));
      await expect(fieldPart(page, 'incidentTime', 'value')).toHaveText(/^(23:15|11:15\s?PM)$/);
    }
  });
});
