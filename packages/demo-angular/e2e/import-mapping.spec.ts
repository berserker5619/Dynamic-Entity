import { expect, test, type Page } from '@playwright/test';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

/**
 * The 2.3 import features, driven through the wizard.
 *
 * Numbered headers mapping themselves, the sheet sizing the array slots, adding a slot,
 * the required-field warning, semicolon and tab-separated text, server parity, a refused
 * Word file, and rules addressed by `[ref]` relaxing a row. Each test asserts what was
 * stored — the demo's localStorage for the in-browser transport, the import server's rows
 * for `?transport=http` — not only what the wizard said.
 *
 * **Not reachable from the demo:** the mapper keeping fixed values (`constant` entries) and
 * entries for fields the config no longer has. Both only apply to a plan passed *in*, and
 * `ngx-entity-import` takes no plan input, so no user of this wizard can reach them.
 * `import-mapper.component.spec.ts` covers them. If the wizard ever gains a stored-plan
 * input, the e2e belongs here.
 *
 * **Header grammar.** `employees.addresses` is labelled "Addresses", and the singular the
 * matcher derives is a trailing-`s` strip — "Addresse", not "Address" (see `withSingular` in
 * core's array-headers.ts). So `Addresses 1 Street` and `Street (3)` map; `Address 1 Street`
 * does not. The headers below stay inside that documented grammar.
 */

type Row = Record<string, unknown>;
const SERVER_STORE = '/api/imported';
const ADDRESSES = 'addressesTab.addresses';

async function openWizard(page: Page, entity: string): Promise<void> {
  await gotoDemo(page);
  await safeSelect(page.locator('#entitySelect'), entity);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import records' })).toBeVisible();
}

async function openServerWizard(page: Page, entity: string): Promise<void> {
  await page.addInitScript(() => {
    Object.keys(window.localStorage)
      .filter(key => key.startsWith('de_demo_'))
      .forEach(key => window.localStorage.removeItem(key));
  });
  await page.goto('/?transport=http');
  await expect(page.getByRole('heading', { level: 1, name: 'Dynamic Entity Demo' })).toBeVisible();
  await page.locator('#entitySelect').selectOption(entity);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import records' })).toBeVisible();
}

async function choose(page: Page, name: string, body: string | Buffer, mimeType = 'text/csv'): Promise<void> {
  await page.getByTestId('import-file').setInputFiles({
    name,
    mimeType,
    buffer: typeof body === 'string' ? Buffer.from(body, 'utf8') : body,
  });
}

async function commit(page: Page, expected: number): Promise<void> {
  await safeClick(page.getByTestId('import-to-review'));
  await safeClick(page.getByTestId('import-commit'));
  await expect(page.getByTestId('import-succeeded')).toContainText(String(expected));
}

async function localRecords(page: Page, entity: string): Promise<Row[]> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]') as Row[], `de_demo_records_${entity}`);
}

/** The employee stored under `firstName`, wherever the store put it. */
async function employee(page: Page, firstName: string): Promise<Row> {
  const found = (await localRecords(page, 'employees')).find(
    r => (r['personal'] as Row | undefined)?.['firstName'] === firstName,
  );
  if (!found) throw new Error(`no imported employee ${firstName}`);
  return found;
}

const addresses = (record: Row) =>
  ((record['addressesTab'] as Row | undefined)?.['addresses'] ?? []) as Row[];

/** Line endings as a spreadsheet writes them. */
const sheet = (...lines: string[]) => lines.map(line => `${line}\r\n`).join('');

test.describe('array columns', () => {
  test('numbered headers map themselves to their slots, marked Guessed', async ({ page }) => {
    await openWizard(page, 'employees');
    await choose(
      page,
      'addresses.csv',
      sheet(
        'First Name,Email,Addresses 1 Street,addresses_2_street,Street (3)',
        'Ada,ada@example.com,1 Analytical Way,2 Engine Row,3 Difference Lane',
      ),
    );

    for (const slot of [0, 1, 2]) {
      await expect(page.getByTestId(`import-guess-${ADDRESSES}.${slot}.street`)).toBeVisible();
    }
    await expect(page.getByTestId(`import-select-${ADDRESSES}.0.street`)).toHaveValue(/.+/);

    await commit(page, 1);
    expect(addresses(await employee(page, 'Ada')).map(a => a['street'])).toEqual([
      '1 Analytical Way',
      '2 Engine Row',
      '3 Difference Lane',
    ]);
  });

  test('the sheet sizes the slots: a sixth-row header offers six rows and no seventh', async ({ page }) => {
    await openWizard(page, 'employees');
    await choose(
      page,
      'six.csv',
      sheet('First Name,Email,Addresses 1 Street,Addresses 6 City', 'Grace,grace@example.com,1 Navy Yard,Arlington'),
    );

    for (const child of ['street', 'city', 'zip']) {
      await expect(page.getByTestId(`import-map-${ADDRESSES}.5.${child}`)).toBeVisible();
      await expect(page.getByTestId(`import-map-${ADDRESSES}.6.${child}`)).toHaveCount(0);
    }
    await expect(page.getByTestId(`import-guess-${ADDRESSES}.5.city`)).toBeVisible();

    await commit(page, 1);
    // Slots are where a value is read from, not where it is stored: empty rows are dropped,
    // so the sixth slot's city is the record's second address.
    expect(addresses(await employee(page, 'Grace'))).toEqual([{ street: '1 Navy Yard' }, { city: 'Arlington' }]);
  });

  test('Add a row adds one slot per child, and a value mapped there is imported', async ({ page }) => {
    await openWizard(page, 'employees');
    await choose(page, 'extra.csv', sheet('First Name,Email,Extra Street', 'Hedy,hedy@example.com,9 Frequency Hop'));

    // Three rows when the sheet names none.
    await expect(page.getByTestId(`import-map-${ADDRESSES}.2.street`)).toBeVisible();
    await expect(page.getByTestId(`import-map-${ADDRESSES}.3.street`)).toHaveCount(0);

    await safeClick(page.getByTestId(`import-add-slot-${ADDRESSES}`));
    for (const child of ['street', 'city', 'zip']) {
      await expect(page.getByTestId(`import-map-${ADDRESSES}.3.${child}`)).toBeVisible();
    }
    await expect(page.getByTestId(`import-map-${ADDRESSES}.4.street`)).toHaveCount(0);

    await page.getByTestId(`import-select-${ADDRESSES}.3.street`).selectOption({ label: 'Extra Street' });
    await commit(page, 1);
    expect(addresses(await employee(page, 'Hedy'))).toEqual([{ street: '9 Frequency Hop' }]);
  });
});

test.describe('the mapper', () => {
  test('warns while a required field is unmapped, and stops once it is mapped', async ({ page }) => {
    await openWizard(page, 'clients');
    // `Full name` does not normalise to `name`, so Name — the one required field — starts unmapped.
    await choose(page, 'clients.csv', sheet('Full name,Email', 'Katherine Johnson,kj@example.com'));

    const warning = page.getByTestId('import-required-unmapped');
    await expect(warning).toBeVisible();

    await page.getByTestId('import-select-name').selectOption({ label: 'Full name' });
    await expect(warning).toHaveCount(0);

    // And unmapping it brings the warning back.
    await page.getByTestId('import-select-name').selectOption({ index: 0 });
    await expect(warning).toBeVisible();
    await page.getByTestId('import-select-name').selectOption({ label: 'Full name' });

    await commit(page, 1);
    const saved = (await localRecords(page, 'clients')).find(r => r['name'] === 'Katherine Johnson');
    expect(saved).toMatchObject({ email: 'kj@example.com' });
  });
});

/** A semicolon file with a quoted separator and a decimal comma: the two things that break a naive reader. */
const SEMICOLON = sheet('First Name;Email;Salary', '"Rao; Jr.";rao@example.com;1,5');

test.describe('delimited text', () => {
  test('a semicolon CSV keeps a quoted semicolon and reads a decimal comma', async ({ page }) => {
    await openWizard(page, 'employees');
    await choose(page, 'semicolon.csv', SEMICOLON);
    await safeClick(page.getByTestId('import-to-review'));

    await expect(page.getByTestId('import-delimiter')).toHaveText(
      'Columns are separated by semicolons, and numbers use a decimal comma.',
    );
    await safeClick(page.getByTestId('import-commit'));
    await expect(page.getByTestId('import-succeeded')).toContainText('1');

    const saved = await employee(page, 'Rao; Jr.');
    expect(saved['salary']).toBe(1.5);
  });

  test('a .tsv lands in the right columns with no custom parser', async ({ page }) => {
    await openWizard(page, 'employees');
    await choose(
      page,
      'people.tsv',
      sheet('First Name\tLast Name\tEmail\tSalary', 'Mary\tJackson, PE\tmj@example.com\t72000'),
      'text/tab-separated-values',
    );
    await safeClick(page.getByTestId('import-to-review'));
    await expect(page.getByTestId('import-delimiter')).toHaveText('Columns are separated by tabs.');
    await safeClick(page.getByTestId('import-commit'));
    await expect(page.getByTestId('import-succeeded')).toContainText('1');

    const saved = await employee(page, 'Mary');
    // The comma inside a tab-separated field is data, not a separator.
    expect((saved['personal'] as Row)['lastName']).toBe('Jackson, PE');
    expect(saved['salary']).toBe(72000);
  });
});

test.describe('through the server', () => {
  test.beforeEach(async ({ request }) => {
    await request.delete(SERVER_STORE);
  });

  test('the same semicolon file stores the same record on the server as in the browser', async ({ page, request }) => {
    await openServerWizard(page, 'employees');
    await choose(page, 'semicolon.csv', SEMICOLON);
    await safeClick(page.getByTestId('import-to-review'));
    await expect(page.getByTestId('import-delimiter')).toContainText('semicolons');
    await safeClick(page.getByTestId('import-commit'));
    await expect(page.getByTestId('import-succeeded')).toContainText('1');

    const response = await request.get(`${SERVER_STORE}/employees`);
    const fromServer = (await response.json()) as Row[];

    await openWizard(page, 'employees');
    await choose(page, 'semicolon.csv', SEMICOLON);
    await commit(page, 1);
    const fromBrowser = await employee(page, 'Rao; Jr.');

    // `_id` is the demo store's stamp, not something the import decided.
    const shape = (record: Row) => {
      const copy = { ...record };
      delete copy['_id'];
      return copy;
    };
    expect(fromServer).toHaveLength(1);
    expect(shape(fromServer[0])).toEqual(shape(fromBrowser));
    expect(fromServer[0]['salary']).toBe(1.5);
  });

  test('a Word file is refused as not an Excel workbook', async ({ page, request }) => {
    await openServerWizard(page, 'employees');
    await choose(
      page,
      'letter.docx',
      storedZip({
        '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
        'word/document.xml': '<?xml version="1.0"?><document/>',
      }),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    await expect(page.getByTestId('import-problem')).toContainText('not an Excel workbook');
    await expect(page.getByTestId('import-mapper')).toHaveCount(0);
    expect(await (await request.get(`${SERVER_STORE}/employees`)).json()).toEqual([]);
  });
});

test.describe('rules addressed by [ref]', () => {
  /*
   * `hide-consent-for-minors` hides the consentSignoff tab by DATE_AFTER on
   * `[demographics.dateOfBirth]`. Import must relax the tab's three required fields exactly
   * as the form does, so a minor's row with no consent imports and an adult's is refused.
   */
  const HEADERS = [
    'Demographics & Vitals / Full Name',
    'Demographics & Vitals / Date of Birth',
    'Demographics & Vitals / Triage Acuity',
    'Demographics & Vitals / Emergency Contact & Phone',
    'Clinical History & Allergies / Chief Medical Complaint',
    'Insurance & Coverage / Coverage Type',
  ].join(',');

  const yearsAgo = (years: number) => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear() - years}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const row = (name: string, dob: string) =>
    `${name},${dob},4 - Less Urgent,Guardian - 555 0100,Sprained wrist,Self-Pay / Uninsured`;

  test('a row leaving a rule-hidden required field blank imports; the same row shown is refused', async ({ page }) => {
    await openWizard(page, 'patientIntake');
    const before = (await localRecords(page, 'patientIntake')).length;
    await choose(page, 'intake.csv', sheet(HEADERS, row('Young Patient', yearsAgo(10)), row('Older Patient', yearsAgo(40))));

    await safeClick(page.getByTestId('import-to-review'));
    await safeClick(page.getByTestId('import-commit'));
    await expect(page.getByTestId('import-succeeded')).toContainText('1');
    await expect(page.getByTestId('import-failed')).toContainText('1');

    const rows = await localRecords(page, 'patientIntake');
    expect(rows).toHaveLength(before + 1);
    const names = rows.map(r => (r['demographics'] as Row | undefined)?.['fullName']);
    expect(names).toContain('Young Patient');
    expect(names).not.toContain('Older Patient');
  });

  test('the server relaxes the same row, and refuses the same row', async ({ page, request }) => {
    await request.delete(SERVER_STORE);
    await openServerWizard(page, 'patientIntake');
    await choose(page, 'intake.csv', sheet(HEADERS, row('Young Patient', yearsAgo(10)), row('Older Patient', yearsAgo(40))));
    await safeClick(page.getByTestId('import-to-review'));
    await safeClick(page.getByTestId('import-commit'));
    await expect(page.getByTestId('import-succeeded')).toContainText('1');
    await expect(page.getByTestId('import-failed')).toContainText('1');

    const fromServer = (await (await request.get(`${SERVER_STORE}/patientIntake`)).json()) as Row[];
    expect(fromServer.map(r => (r['demographics'] as Row)['fullName'])).toEqual(['Young Patient']);
  });
});

/**
 * A zip with every entry stored uncompressed — enough of a container for the server's zip
 * guard to open and find no workbook in. Hand-built so the spec needs no zip dependency.
 */
function storedZip(entries: Record<string, string>): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
