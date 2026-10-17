// Round 3, case b: the same server flows as a CommonJS Jest suite, run with no Node flags.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createImportRouter } = require('@dynamic-entity/server/express');
const { readSheet } = require('@dynamic-entity/server');

const bytes = fs.readFileSync(path.join(process.env.R3_FILES, 'case1_1904_dates.xlsx'));
const employees = {
  entity: 'employees',
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [
    { id: 'name', type: 'text', label: { en: 'Name' }, validators: { required: true } },
    { id: 'birthDate', type: 'date', label: { en: 'BirthDate' } },
    { id: 'joinDate', type: 'date', label: { en: 'JoinDate' } },
  ] }],
};
const plan = { planVersion: 2, target: 'employees', entries: [
  { ref: 'name', column: 0 }, { ref: 'birthDate', column: 1 }, { ref: 'joinDate', column: 2 },
] };
const strip = r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));

let server;
let base;
const written = [];
beforeAll(() => {
  const app = express();
  app.use('/api/import', createImportRouter({ configs: { employees }, onImport: async records => { written.push(...records); } }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/import/employees`;
});
afterAll(() => server.close());

const form = withPlan => {
  const fd = new FormData();
  if (withPlan) fd.append('plan', JSON.stringify(plan));
  fd.append('file', new Blob([bytes]), 'case1_1904_dates.xlsx');
  return fd;
};

test('reads an xlsx with readSheet', async () => {
  const sheet = await readSheet({ stream: (async function* () { yield bytes; })(), filename: 'case1.xlsx' });
  expect(sheet.format).toBe('xlsx');
  expect(sheet.headers).toEqual(['Name', 'BirthDate', 'JoinDate']);
});

test('serves an xlsx template', async () => {
  const res = await fetch(`${base}/template?format=xlsx`);
  expect(res.status).toBe(200);
  expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString('latin1')).toBe('PK');
});

test('previews an upload', async () => {
  const res = await fetch(`${base}/preview`, { method: 'POST', body: form(false) });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.rowCount).toBe(2);
});

test('validates without writing', async () => {
  const res = await fetch(`${base}/validate`, { method: 'POST', body: form(true) });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.written).toBe(false);
  expect(written).toHaveLength(0);
});

test('imports', async () => {
  const res = await fetch(`${base}/import`, { method: 'POST', body: form(true) });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.imported).toBe(2);
  expect(written.map(strip)).toEqual([
    { name: 'Alice Mac', birthDate: '2026-05-15', joinDate: '1904-01-02' },
    { name: 'Bob Mac', birthDate: '1985-10-26', joinDate: '2020-03-01' },
  ]);
});
