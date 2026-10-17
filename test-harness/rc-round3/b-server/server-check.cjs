// Round 3, case b: a CommonJS Express server on the published @dynamic-entity/server@next.
// Run from a project that has @dynamic-entity/server@next and one major of express installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createImportRouter } = require('@dynamic-entity/server/express');
const { readSheet } = require('@dynamic-entity/server');

const FILES = process.env.R3_FILES;
const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false, detail: String(error && error.stack || error).split('\n').slice(0, 4).join(' | ') });
    console.log(`FAIL ${name} — ${String(error && error.message || error)}`);
  }
};

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
const EXPECTED = [
  { name: 'Alice Mac', birthDate: '2026-05-15', joinDate: '1904-01-02' },
  { name: 'Bob Mac', birthDate: '1985-10-26', joinDate: '2020-03-01' },
];
const strip = r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));

(async () => {
  const expressVersion = require('express/package.json').version;
  const serverVersion = require('@dynamic-entity/server/package.json').version;
  console.log(`express ${expressVersion}, @dynamic-entity/server ${serverVersion}, node ${process.version}`);
  const bytes = fs.readFileSync(path.join(FILES, 'case1_1904_dates.xlsx'));

  await check('xlsx read (readSheet)', async () => {
    const sheet = await readSheet({ stream: (async function* () { yield bytes; })(), filename: 'case1.xlsx' });
    assert.equal(sheet.format, 'xlsx');
    assert.deepEqual(sheet.headers, ['Name', 'BirthDate', 'JoinDate']);
    let n = 0;
    for await (const _ of sheet.rows) n++;
    assert.equal(n, 2);
    return `headers ${JSON.stringify(sheet.headers)}, ${n} rows`;
  });

  const written = [];
  const app = express();
  app.use('/api/import', createImportRouter({ configs: { employees }, onImport: async records => { written.push(...records); } }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/import/employees`;
  const form = withPlan => {
    const fd = new FormData();
    if (withPlan) fd.append('plan', JSON.stringify(plan));
    fd.append('file', new Blob([bytes]), 'case1_1904_dates.xlsx');
    return fd;
  };

  try {
    await check('template (GET /template?format=xlsx)', async () => {
      const res = await fetch(`${base}/template?format=xlsx`);
      assert.equal(res.status, 200);
      const body = Buffer.from(await res.arrayBuffer());
      assert.equal(body.subarray(0, 2).toString('latin1'), 'PK');
      return `${body.length} bytes, ${res.headers.get('content-disposition')}`;
    });
    await check('upload + preview (POST /preview)', async () => {
      const res = await fetch(`${base}/preview`, { method: 'POST', body: form(false) });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.deepEqual(body.headers, ['Name', 'BirthDate', 'JoinDate']);
      assert.equal(body.rowCount, 2);
      return `rowCount ${body.rowCount}, engineVersion ${body.engineVersion}, sample[0] ${JSON.stringify(body.sample[0])}`;
    });
    await check('validate (POST /validate) writes nothing', async () => {
      const res = await fetch(`${base}/validate`, { method: 'POST', body: form(true) });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.written, false);
      assert.equal(body.imported, 2);
      assert.equal(written.length, 0);
      return `written ${body.written}, imported ${body.imported}, errors ${body.errorCount}`;
    });
    await check('import (POST /import)', async () => {
      const res = await fetch(`${base}/import`, { method: 'POST', body: form(true) });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.written, true);
      assert.equal(body.imported, 2);
      assert.deepEqual(written.map(strip), EXPECTED);
      return `imported ${body.imported}, records ${JSON.stringify(written.map(strip))}`;
    });
  } finally {
    server.close();
  }

  fs.writeFileSync(path.join(process.cwd(), 'results.json'), JSON.stringify({ expressVersion, serverVersion, results }, null, 2));
  process.exitCode = results.every(r => r.ok) ? 0 : 1;
})();
