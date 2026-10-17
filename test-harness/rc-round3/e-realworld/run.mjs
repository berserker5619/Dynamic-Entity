// Round 3, case e: Round 2's real-world files through both paths, against the published @next
// packages. The browser path does what LocalImportTransport does (file.text() -> parseCsv, or the
// SheetJS parser EXTENDING.md documents, then suggestMapping / applyMapping with the delimiter's
// decimal mark). The server path posts to @dynamic-entity/server's router.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as XLSX from 'xlsx';
import { applyMapping, suggestMapping, deriveImportColumns, decimalMarkFor, cellText } from '@dynamic-entity/core';
import { parseCsv } from 'sheet-to-schema';
import { createImportRouter } from '@dynamic-entity/server/express';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = process.env.R3_FILES ?? path.resolve(HERE, '../files');
const ROUND2 = JSON.parse(fs.readFileSync(process.env.R2_SUMMARY ?? path.join(HERE, 'round2-summary.json'), 'utf8'));
const versions = Object.fromEntries(['@dynamic-entity/core', '@dynamic-entity/server', 'sheet-to-schema', 'ngx-dynamic-entity', 'express'].map(p => [p, require(`${p}/package.json`).version]));
console.log(JSON.stringify(versions));

// The parser EXTENDING.md documents for .xlsx, verbatim in its options.
async function sheetJsParser(bytes) {
  const workbook = XLSX.read(bytes, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: '', UTC: true });
  return { headers: (rows[0] ?? []).map(cellText), rows: rows.slice(1) };
}
async function browserRead(file) {
  const bytes = fs.readFileSync(path.join(FILES, file));
  if (file.endsWith('.xlsx')) return sheetJsParser(bytes);
  return parseCsv(new Blob([bytes]).size >= 0 ? await new Blob([bytes]).text() : '');
}

const serverConfigs = {};
let collected = [];
const app = express();
app.use('/api/import', createImportRouter({ configs: entity => serverConfigs[entity], onImport: async records => { collected.push(...records); } }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/import`;

const makeConfig = (entity, fields) => ({
  entity,
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: fields.map(f => ({ id: f.id, type: f.type || 'text', label: { en: f.label || f.id }, ...(f.required ? { required: true } : {}) })) }],
});
const planOf = (target, refs) => ({ planVersion: 2, target, schemaVersion: 1, entries: refs.map(([ref, column]) => ({ ref, column })) });
const strip = r => JSON.parse(JSON.stringify(r, (k, v) => (k.startsWith('_') ? undefined : v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const unicode = makeConfig('unicodedata', [{ id: 'name', required: true }, { id: 'email' }, { id: 'orderId' }, { id: 'amount', type: 'number' }, { id: 'status' }]);
const unicodePlan = planOf('unicodedata', [['name', 0], ['email', 1], ['orderId', 2], ['amount', 3], ['status', 4]]);
const SCENARIOS = [
  ['1. 1904 Date System (Mac Excel)', 'case1_1904_dates.xlsx', makeConfig('employees', [{ id: 'name', required: true }, { id: 'birthDate', type: 'date', required: true }, { id: 'joinDate', type: 'date', required: true }]), planOf('employees', [['name', 0], ['birthDate', 1], ['joinDate', 2]])],
  ['2. Numeric cells holding phone, 16-digit ID, pincode, count mapped to string fields', 'case2_numeric_identifiers.xlsx', makeConfig('identifiers', [{ id: 'name', required: true }, { id: 'phone' }, { id: 'nationalId' }, { id: 'postalCode' }, { id: 'itemCount' }]), planOf('identifiers', [['name', 0], ['phone', 1], ['nationalId', 2], ['postalCode', 3], ['itemCount', 4]])],
  ['3a. Excel CSV UTF-8 (BOM)', 'case3_excel_utf8_bom.csv', makeConfig('salaries', [{ id: 'name', required: true }, { id: 'department' }, { id: 'salary', type: 'number' }]), planOf('salaries', [['name', 0], ['department', 1], ['salary', 2]])],
  ['3b. Excel Semicolon CSV (comma decimals)', 'case3_excel_semicolon.csv', makeConfig('products', [{ id: 'product', required: true }, { id: 'price', type: 'number' }, { id: 'rating', type: 'number' }]), planOf('products', [['product', 0], ['price', 1], ['rating', 2]])],
  ['3c. Google Sheets CSV export (multiline & quotes)', 'case3_google_sheets.csv', makeConfig('orders', [{ id: 'orderId', required: true }, { id: 'customer' }, { id: 'address' }, { id: 'notes' }]), planOf('orders', [['orderId', 0], ['customer', 1], ['address', 2], ['notes', 3]])],
  ['3d. LibreOffice Calc xlsx', 'case3_libreoffice.xlsx', makeConfig('inventory', [{ id: 'sku', required: true }, { id: 'title' }, { id: 'stock', type: 'integer' }, { id: 'price', type: 'number' }]), planOf('inventory', [['sku', 0], ['title', 1], ['stock', 2], ['price', 3]])],
  ['4. Complex xlsx (merged headers, hidden col, formulas, 2 sheets, empty rows, duplicate headers)', 'case4_complex_sheet.xlsx', makeConfig('sales', [{ id: 'customer', required: true }, { id: 'region' }, { id: 'qty', type: 'integer' }, { id: 'price', type: 'number' }, { id: 'total', type: 'number' }, { id: 'secret' }, { id: 'status' }]), planOf('sales', [['customer', 0], ['qty', 2], ['price', 3], ['total', 4], ['secret', 5], ['status', 6]])],
  ['5a. Non-Latin text (Tamil & Emoji) in XLSX', 'case5_non_latin.xlsx', unicode, unicodePlan],
  ['5b. Non-Latin text (Tamil & Emoji) in CSV', 'case5_non_latin.csv', unicode, unicodePlan],
];

const out = [];
for (const [name, file, config, plan] of SCENARIOS) {
  serverConfigs[config.entity] = config;
  collected = [];
  const sheet = await browserRead(file);
  const { columns } = deriveImportColumns(config, { lang: 'en', maxArrayRows: 5 });
  const suggestion = suggestMapping(sheet.headers, columns, config.entity);
  const b = applyMapping(sheet.rows, plan, config, { lang: 'en', decimal: decimalMarkFor(sheet.delimiter), dateOrder: undefined });

  const bytes = fs.readFileSync(path.join(FILES, file));
  const fd = withPlan => { const f = new FormData(); if (withPlan) f.append('plan', JSON.stringify(plan)); f.append('file', new Blob([bytes]), file); return f; };
  const preview = await (await fetch(`${base}/${config.entity}/preview`, { method: 'POST', body: fd(false) })).json();
  const commitRes = await fetch(`${base}/${config.entity}/import`, { method: 'POST', body: fd(true) });
  const commit = await commitRes.json();

  const browserRecords = strip(b.records ?? []);
  const serverRecords = strip(collected);
  const errKey = e => `${e.row}:${e.ref}:${e.code}`;
  const r2 = ROUND2.find(s => s.scenario === name);
  const row = {
    name, file,
    headers: { browser: sheet.headers, server: preview.headers },
    suggestionMatched: suggestion.entries.length,
    browser: { records: browserRecords, errors: (b.errors ?? []).map(e => ({ row: e.row, ref: e.ref, code: e.code, message: e.message })) },
    server: { status: commitRes.status, imported: commit.imported, skipped: commit.skipped, failed: commit.failed, rowsRead: commit.rowsRead, records: serverRecords, errors: (commit.errors ?? []).map(e => ({ row: e.row, ref: e.ref, code: e.code, message: e.message })), previewRowCount: preview.rowCount },
    parity: { records: same(browserRecords, serverRecords), errors: same((b.errors ?? []).map(errKey).sort(), (commit.errors ?? []).map(errKey).sort()), headers: same(sheet.headers, preview.headers) },
    vsRound2: { browser: r2 ? same(browserRecords, strip(r2.browser.records)) : null, server: r2 ? same(serverRecords, strip(r2.server.imported)) : null },
    round2: r2 ? { browser: strip(r2.browser.records), server: strip(r2.server.imported), browserHeaders: r2.browser.parsedHeaders } : null,
  };
  out.push(row);
  console.log(`\n== ${name}\n   parity records=${row.parity.records} errors=${row.parity.errors} headers=${row.parity.headers} | same as round 2: browser=${row.vsRound2.browser} server=${row.vsRound2.server}`);
  console.log(`   server: status ${commitRes.status}, imported ${commit.imported}, skipped ${commit.skipped}, failed ${commit.failed}, rowsRead ${commit.rowsRead}; browser: ${browserRecords.length} records, ${(b.errors ?? []).length} errors`);
  if (row.browser.errors.length || row.server.errors.length) console.log('   errors b/s:', JSON.stringify(row.browser.errors), JSON.stringify(row.server.errors));
}
server.close();
fs.writeFileSync(path.join(HERE, 'round3-e.json'), JSON.stringify({ versions, scenarios: out }, null, 2));
