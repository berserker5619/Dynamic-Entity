// The rc.1 round, in Chromium, Firefox and WebKit, against the published packages
// (docs/3.1-rc-feedback.md). Needs `node server/server.mjs` running. Screenshots go to SCREENS.
// Usage: node drive.mjs <screens dir>
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { deriveImportColumns } from '@dynamic-entity/core';
import { readSheet } from 'sheet-to-schema/node';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = path.resolve(process.argv[2] ?? path.join(HERE, 'screens'));
fs.mkdirSync(SCREENS, { recursive: true });
const FIXTURES = path.join(HERE, 'fixtures');
const FULL = 'http://127.0.0.1:4611';
const CSV_APP = 'http://127.0.0.1:4612';
const CONFIGS = path.join(HERE, 'server/configs.json');

// ─── Configs ──────────────────────────────────────────────────────────────────

const text = (id, label, extra = {}) => ({ id, type: 'text', label: { en: label }, ...extra });
const PEOPLE = { entity: 'people', version: 1, tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [text('name', 'Name'), text('city', 'City')] }] };
const ORDERS = {
  entity: 'orders',
  version: 1,
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [text('orderId', 'Order'), { id: 'items', type: 'array', label: { en: 'Item' }, children: [text('sku', 'SKU', { validators: { required: true } }), { id: 'qty', type: 'number', label: { en: 'Qty' } }] }] }],
};
/** A grouped order sheet: the headers the wizard suggests a mapping for, one item per row. */
const orderSheet = rows => {
  const headers = deriveImportColumns(ORDERS, { lang: 'en', maxArrayRows: 1 }).columns.map(column => column.header);
  return [headers, ...rows].map(row => row.join(',')).join('\r\n') + '\r\n';
};
// Row 2 and 3 are order A-1; row 3's item has no SKU, which is required. Row 4 is B-2.
const ORDER_ROWS = [['A-1', 'PEN', '2'], ['A-1', '', '3'], ['B-2', 'PAD', '1']];

const NUMBER = /^-?\d+(?:[.,]\d+)?$/;
async function fixtureConfig(name, bytes, entity) {
  const sheet = await readSheet({ stream: Readable.from([bytes]), filename: name });
  const rows = [];
  for await (const row of sheet.rows) rows.push(row);
  const kind = values => {
    const present = values.filter(v => v !== '' && v !== null && v !== undefined);
    if (present.length && present.every(v => v instanceof Date)) return 'date';
    if (present.length && present.every(v => typeof v === 'number' || (typeof v === 'string' && NUMBER.test(v.trim())))) return 'number';
    return 'text';
  };
  return { entity, version: 1, tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: sheet.headers.map((h, i) => ({ id: `c${i}`, type: kind(rows.map(r => r[i])), label: { en: h || `Column ${i + 1}` } })) }] };
}

const WORKBOOKS = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.xlsx')).sort();
const registry = { people: PEOPLE, orders: ORDERS };
for (const [i, file] of WORKBOOKS.entries()) registry[`fixture${i}`] = await fixtureConfig(file, fs.readFileSync(path.join(FIXTURES, file)), `fixture${i}`);
fs.writeFileSync(CONFIGS, JSON.stringify(registry));

// ─── The page ─────────────────────────────────────────────────────────────────

async function open(browser, url, config, init) {
  const page = await browser.newPage();
  const uploads = [];
  page.on('request', request => /\/import$/.test(new URL(request.url()).pathname) && uploads.push(request.url()));
  await page.addInitScript(c => {
    window.__CONFIG__ = c;
  }, config);
  if (init) await page.addInitScript(init);
  await page.goto(url);
  await page.waitForFunction(() => document.title === 'ready' && document.querySelector('[data-testid="import-file"]'));
  return { page, uploads };
}
const choose = (page, name, buffer) => page.locator('[data-testid="import-file"]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
async function commit(page) {
  await page.locator('[data-testid="import-mapper"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="import-to-review"]').click();
  await page.locator('[data-testid="import-commit"]').click();
}
/** The committed result, or the problem the wizard shows, whichever comes first. */
async function outcome(page) {
  await page.waitForFunction(() => window.__RESULT__ || document.querySelector('[data-testid="import-problem"]')?.textContent?.trim(), null, { timeout: 120_000 });
  return page.evaluate(() => ({ result: window.__RESULT__ ?? null, problem: document.querySelector('[data-testid="import-problem"]')?.textContent?.trim() ?? null }));
}
const shot = (page, name) => page.locator('ngx-entity-import').screenshot({ path: path.join(SCREENS, `${name}.png`) });

const json = async (url, init) => (await fetch(url, init)).json();
/** The server's import of `bytes` into `entity` at `api`, with the plan its own preview suggests. */
async function serverImport(api, entity, name, bytes, plan) {
  const form = () => {
    const data = new FormData();
    if (plan) data.append('plan', JSON.stringify(plan));
    data.append('file', new Blob([bytes]), name);
    return data;
  };
  const suggestion = plan ?? (await json(`${FULL}/api/${api}/${entity}/preview`, { method: 'POST', body: form() })).suggestion;
  const body = new FormData();
  body.append('plan', JSON.stringify(suggestion));
  body.append('file', new Blob([bytes]), name);
  const response = await fetch(`${FULL}/api/${api}/${entity}/import`, { method: 'POST', body });
  return { status: response.status, body: await response.json() };
}

// ─── The cases ────────────────────────────────────────────────────────────────

const results = [];
const record = (browser, name, ok, detail = '') => {
  results.push({ browser, name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const WORKBOOK = fs.readFileSync(path.join(FIXTURES, 'real-world__case5_non_latin.xlsx'));
const strip = value => JSON.parse(JSON.stringify(value));

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();
  console.log(`\n${name} ${browser.version()}`);

  // 1. The CSV-only app: a CSV imports; a workbook is refused with UNSUPPORTED_FORMAT's message.
  {
    const { page } = await open(browser, CSV_APP, PEOPLE);
    const accept = await page.locator('[data-testid="import-file"]').getAttribute('accept');
    record(name, 'csv-app offers .csv,.tsv,.txt', accept === '.csv,.tsv,.txt', accept);
    await choose(page, 'people.csv', Buffer.from('Name,City\r\nAda,Paris\r\nBo,Rome\r\n'));
    await commit(page);
    const done = await outcome(page);
    record(name, 'csv-app imports a CSV', done.result?.records?.length === 2, done.problem ?? `${done.result?.records?.length} records`);
    await shot(page, `csv-app-imported-${name}`);
    await page.close();
    const second = await open(browser, CSV_APP, PEOPLE);
    await choose(second.page, 'book.xlsx', WORKBOOK);
    const refused = await outcome(second.page);
    record(name, 'csv-app refuses an .xlsx with the CSV-only message', /this import reads CSV files only/.test(refused.problem ?? ''), refused.problem);
    await shot(second.page, `csv-app-xlsx-refused-${name}`);
    await second.page.close();
  }

  // 2. The xlsx entry: every 1.3 workbook imports in the browser as the real server imports it.
  for (const [i, file] of WORKBOOKS.entries()) {
    const entity = `fixture${i}`;
    const bytes = fs.readFileSync(path.join(FIXTURES, file));
    const { page } = await open(browser, `${FULL}/?parser=xlsx`, registry[entity]);
    await choose(page, file.split('__')[1], bytes);
    await commit(page);
    const done = await outcome(page);
    await page.close();
    await fetch(`${FULL}/written`, { method: 'DELETE' });
    const server = await serverImport('off', entity, file.split('__')[1], bytes);
    const written = await json(`${FULL}/written/off/${entity}`);
    const same = done.result && JSON.stringify(strip(done.result.records)) === JSON.stringify(strip(written)) && JSON.stringify(strip(done.result.errors)) === JSON.stringify(strip(server.body.errors ?? []));
    record(name, `xlsx entry: ${file} matches the server`, !!same, done.problem ?? `${done.result?.records?.length} records, ${done.result?.errors?.length} errors; server ${written.length}, ${server.body.errors?.length}`);
  }

  // 3. deflate-raw stubbed off: UNSUPPORTED_RUNTIME's message, and a CSV still imports.
  {
    const stub = () => {
      const Native = window.DecompressionStream;
      window.DecompressionStream = class extends Native {
        constructor(format) {
          if (format === 'deflate-raw') throw new TypeError("Unsupported compression format: 'deflate-raw'");
          super(format);
        }
      };
    };
    const { page } = await open(browser, `${FULL}/?parser=xlsx`, PEOPLE, stub);
    await choose(page, 'book.xlsx', WORKBOOK);
    const refused = await outcome(page);
    record(name, 'no deflate-raw: UNSUPPORTED_RUNTIME message', /This browser cannot read \.xlsx files/.test(refused.problem ?? ''), refused.problem);
    await shot(page, `unsupported-runtime-${name}`);
    await choose(page, 'people.csv', Buffer.from('Name,City\r\nAda,Paris\r\n'));
    await commit(page);
    const done = await outcome(page);
    record(name, 'no deflate-raw: a CSV still imports', done.result?.records?.length === 1, done.problem ?? '');
    await page.close();
  }

  // 4. A grouped plan from code, through LocalImportTransport: one record, the item error on its own row.
  {
    const { page } = await open(browser, `${FULL}/?plan=grouped`, ORDERS);
    await choose(page, 'orders.csv', Buffer.from(orderSheet(ORDER_ROWS)));
    await commit(page);
    const done = await outcome(page);
    const errors = done.result?.errors?.map(e => `${e.row}:${(e.rows ?? []).join('/')}:${e.ref}:${e.code}`) ?? [];
    record(name, 'local grouped: B-2 imports, A-1 fails', JSON.stringify(done.result?.records?.map(r => [r.orderId, r.items?.length])) === '[["B-2",1]]', JSON.stringify(done.result?.records?.map(r => r.orderId)));
    record(name, 'local grouped: the item error is on row 3, its own', JSON.stringify(errors) === JSON.stringify(['3:3:items.1.sku:RECORD_REQUIRED']), errors.join(' '));
    await shot(page, `grouped-local-${name}`);
    await page.close();
  }

  // 5. Through HttpImportTransport, against the real DE 3.1 server with grouping on.
  {
    await fetch(`${FULL}/written`, { method: 'DELETE' });
    const { page, uploads } = await open(browser, `${FULL}/?transport=http&api=/api/on&plan=grouped`, ORDERS);
    await choose(page, 'orders.csv', Buffer.from(orderSheet(ORDER_ROWS)));
    await commit(page);
    const done = await outcome(page);
    const written = await json(`${FULL}/written/on/orders`);
    const errors = done.result?.errors?.map(e => `${e.row}:${(e.rows ?? []).join('/')}:${e.ref}:${e.code}`) ?? [];
    record(name, 'server, grouping on: uploaded, and B-2 written with its item', uploads.length === 1 && JSON.stringify(written.map(r => [r.orderId, r.items?.length])) === '[["B-2",1]]', done.problem ?? JSON.stringify(written.map(r => r.orderId)));
    record(name, 'server, grouping on: the item error is on row 3, its own', JSON.stringify(errors) === JSON.stringify(['3:3:items.1.sku:RECORD_REQUIRED']), errors.join(' '));
    await shot(page, `grouped-server-on-${name}`);
    await page.close();
  }

  // 6. Grouping off: refused (by the wizard before upload; by the server with reason grouping-disabled).
  {
    const { page, uploads } = await open(browser, `${FULL}/?transport=http&api=/api/off&plan=grouped`, ORDERS);
    await choose(page, 'orders.csv', Buffer.from(orderSheet(ORDER_ROWS)));
    await commit(page);
    const done = await outcome(page);
    record(name, 'server, grouping off: the wizard says the server does not group, nothing uploaded', /the import server does not do that/.test(done.problem ?? '') && uploads.length === 0, done.problem);
    await shot(page, `grouped-server-off-${name}`);
    await page.close();
  }

  // 7. The published DE 3.0.0 server: refused before upload.
  {
    const { page, uploads } = await open(browser, `${FULL}/?transport=http&api=/api/v30&plan=grouped`, ORDERS);
    await choose(page, 'orders.csv', Buffer.from(orderSheet(ORDER_ROWS)));
    await commit(page);
    const done = await outcome(page);
    record(name, 'DE 3.0.0 server: refused before upload', /the import server does not do that/.test(done.problem ?? '') && uploads.length === 0, done.problem);
    await shot(page, `grouped-server-v30-${name}`);
    await page.close();
  }

  await browser.close();
}

// The server's own answer with grouping off, to a grouped plan sent anyway (not by the wizard).
{
  const suggestion = (await json(`${FULL}/api/off/orders/preview`, { method: 'POST', body: (() => { const d = new FormData(); d.append('file', new Blob([orderSheet(ORDER_ROWS)]), 'orders.csv'); return d; })() })).suggestion;
  const SLOT = /^(.+?)\.(\d+)\.(.+)$/;
  const entries = suggestion.entries.filter(e => !SLOT.test(e.ref) || SLOT.exec(e.ref)[2] === '0').map(e => (SLOT.test(e.ref) ? { ...e, ref: e.ref.replace(SLOT, '$1.$3') } : e));
  const grouped = { ...suggestion, entries, group: { key: [0], collect: ['items'] } };
  const off = await serverImport('off', 'orders', 'orders.csv', Buffer.from(orderSheet(ORDER_ROWS)), grouped);
  const reason = off.body.error?.details?.find(d => d.code === 'PLAN_GROUP')?.reason;
  record('server', 'grouping off, a grouped plan sent anyway: 400 INVALID_PLAN, reason grouping-disabled', off.status === 400 && off.body.error?.code === 'INVALID_PLAN' && reason === 'grouping-disabled', `${off.status} ${off.body.error?.code} ${reason}`);
}

fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
