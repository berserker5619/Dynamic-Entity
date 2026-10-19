#!/usr/bin/env node
/**
 * check-transport-servers.mjs — this tree's HttpImportTransport against four real servers
 * (docs/3.1-spec.md, Feature C, the capability check).
 *
 * The transport decides before a byte is uploaded whether a plan may go to a server, from what
 * the server's preview says it reads (`planVersions`) and can do (`features`). A unit test can
 * only say what a preview looks like; this asks the servers themselves:
 *
 *   | Server                         | Grouped plan                          | Plan without grouping |
 *   | DE 3.1 (this tree), grouping on| sent and imported                     | sent, as v2           |
 *   | DE 3.1 (this tree), default    | refused before upload, feature group  | sent, as v2           |
 *   | DE 3.0.0 (published)           | refused before upload, feature group  | sent, as v2           |
 *   | DE 2.5.0 (published)           | refused before upload, as in 3.0      | sent, in v1 form      |
 *
 * The published servers are installed into a temp directory each, as an app would install them.
 * Run after `npm run build`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';

const ROOT = process.cwd();
const NGX = path.join(ROOT, 'packages/ngx-dynamic-entity/dist/fesm2022/ngx-dynamic-entity.mjs');
const SERVER = path.join(ROOT, 'packages/server/dist/express.js');
for (const built of [NGX, SERVER]) {
  if (!existsSync(built)) {
    console.error(`${path.relative(ROOT, built)} not found. Run npm run build first.`);
    process.exit(1);
  }
}

/** `@dynamic-entity/server@version`'s Express entry, in a directory of its own, installed once. */
function published(version) {
  const dir = path.join(os.tmpdir(), `de-published-server-${version}`);
  if (!existsSync(path.join(dir, 'node_modules/@dynamic-entity/server/package.json'))) {
    console.log(`Installing @dynamic-entity/server@${version} in ${dir}...`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: `published-server-${version}`, private: true, dependencies: { '@dynamic-entity/server': version, '@dynamic-entity/core': version, express: '^5.0.0' } }),
    );
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: dir, shell: process.platform === 'win32', stdio: 'inherit' });
  }
  // Through the package's own `exports`, as an app would import it: 2.x and 3.0 lay their files
  // out differently, and the subpath is the contract.
  return createRequire(path.join(dir, 'package.json')).resolve('@dynamic-entity/server/express');
}

const CONFIG = {
  entity: 'people',
  version: 1,
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      flatData: true,
      fields: [
        { id: 'name', type: 'text', label: { en: 'Name' } },
        { id: 'phones', type: 'array', label: { en: 'Phone' }, children: [{ id: 'number', type: 'text', label: { en: 'Number' } }] },
      ],
    },
  ],
};
const CSV = 'Name,Number\r\nAda,111\r\nAda,222\r\nBo,333\r\n';
const GROUPED = {
  planVersion: 2,
  target: 'people',
  schemaVersion: 1,
  entries: [{ ref: 'name', column: 0 }, { ref: 'phones.number', column: 1 }],
  group: { key: [0], collect: ['phones'] },
};
const FLAT = { planVersion: 2, target: 'people', schemaVersion: 1, entries: [{ ref: 'name', column: 0 }, { ref: 'phones.0.number', column: 1 }] };

/** One server, its router mounted at /import, and what it was sent and wrote. */
async function serve(createImportRouter, options) {
  const written = [];
  const app = express();
  app.use('/import', createImportRouter({ configs: { people: CONFIG }, onImport: records => void written.push(...records), ...options }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/import`, written, close: () => server.close() };
}

/** Preview then commit `plan` through this tree's transport: what was uploaded, and the outcome. */
async function through(HttpImportTransport, url, plan) {
  const uploads = [];
  const fetchSpy = async (input, init = {}) => {
    if (String(input).endsWith('/import')) uploads.push(JSON.parse(String(init.body.get('plan'))));
    return fetch(input, init);
  };
  const transport = new HttpImportTransport({ baseUrl: url, fetch: fetchSpy, warn: () => undefined });
  const file = new File([CSV], 'people.csv', { type: 'text/csv' });
  await transport.preview(file, { config: CONFIG });
  try {
    return { uploads, result: await transport.commit(file, plan, { config: CONFIG }) };
  } catch (error) {
    return { uploads, error };
  }
}

const problems = [];
const expect = (ok, what) => {
  if (!ok) problems.push(what);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

await import(pathToFileURL(path.join(ROOT, 'node_modules/@angular/compiler/fesm2022/compiler.mjs')).href);
const { HttpImportTransport } = await import(pathToFileURL(NGX).href);
const ours = (await import(pathToFileURL(SERVER).href)).createImportRouter;

const SERVERS = [
  { name: 'DE 3.1 (this tree), grouping on', router: ours, options: { grouping: true }, groups: true, readsV2: true },
  { name: 'DE 3.1 (this tree), default', router: ours, options: {}, groups: false, readsV2: true },
  { name: 'DE 3.0.0 (published)', router: (await import(pathToFileURL(published('3.0.0')).href)).createImportRouter, options: {}, groups: false, readsV2: true },
  { name: 'DE 2.5.0 (published)', router: (await import(pathToFileURL(published('2.5.0')).href)).createImportRouter, options: {}, groups: false, readsV2: false },
];

for (const s of SERVERS) {
  console.log(s.name);
  const server = await serve(s.router, s.options);
  try {
    const grouped = await through(HttpImportTransport, server.url, GROUPED);
    if (s.groups) {
      expect(!grouped.error && grouped.uploads.length === 1, 'a grouped plan is sent');
      expect(server.written.length === 2 && server.written[0].phones?.length === 2, 'and imported, one record per group');
    } else {
      expect(grouped.uploads.length === 0, 'a grouped plan is refused before upload');
      expect(grouped.error?.code === 'UNSUPPORTED_BY_SERVER', 'with code UNSUPPORTED_BY_SERVER');
      expect(grouped.error?.refused?.includes('group'), '`refused` names group');
      if (s.readsV2) {
        expect(grouped.error?.feature === 'group' && /does not import grouped plans/.test(grouped.error.message), 'saying the server does not import grouped plans (feature group)');
      } else {
        expect(grouped.error?.feature === undefined && /before mapping plan v2/.test(grouped.error?.message ?? ''), 'saying the server is from before plan v2, as in 3.0');
      }
    }
    server.written.length = 0;
    const flat = await through(HttpImportTransport, server.url, FLAT);
    expect(!flat.error && flat.uploads.length === 1, 'a plan without grouping is sent');
    const sent = flat.uploads[0] ?? {};
    expect(s.readsV2 ? sent.planVersion === 2 : sent.planVersion === undefined && sent.entity === 'people', s.readsV2 ? 'as plan v2' : 'in v1 form');
    expect(server.written.length === 3, 'and imported, one record per row');
  } finally {
    server.close();
  }
}

if (problems.length) {
  console.error(`\nHttpImportTransport does not give Feature C's outcome on ${problems.length} point(s).`);
  process.exit(1);
}
console.log("\nHttpImportTransport gives Feature C's outcome against all four servers.");
