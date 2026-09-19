#!/usr/bin/env node
/**
 * verify-server-consumer.mjs — prove @dynamic-entity/server works for someone who installs it.
 *
 * `verify-consumer.mjs` installs into an *Angular* project and compiles a component with ngc.
 * That is the wrong shape entirely for a Node package: there is no template to compile, and
 * the things that can be wrong are different ones — a `main` that resolves nowhere, an
 * `exports` map missing the `./express` subpath, a dependency left in `devDependencies`, a
 * peer that is not declared. So this is a second script rather than a flag on the first.
 *
 * What it does, and why each step is here rather than trusted:
 *
 *   1. Packs the tarballs exactly as `npm publish` would.
 *   2. Installs them into a throwaway Node project alongside a real Express.
 *   3. Imports the package **as CommonJS and as ESM**, because the manifest claims both and
 *      a wrong `module`/`main` only shows up from the side that is not being used.
 *   4. Mounts the router on a real listener and drives all four routes over real HTTP.
 *   5. Compiles every ```ts snippet in the package README against the installed tarballs, so
 *      the documented Quick Start is proven rather than proofread.
 *
 * The workspace cannot show any of this: inside the repo everything resolves through
 * symlinks, so a broken manifest still looks fine right up until somebody installs it.
 *
 * Usage:
 *   node scripts/verify-server-consumer.mjs
 *   node scripts/verify-server-consumer.mjs --keep     leave the project on disk
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');

// npm is a .cmd shim on Windows, so it needs a shell — which in turn means any argument
// containing a space (this repo lives under "Dynamic Entity") must be quoted by hand.
const useShell = process.platform === 'win32';
const quote = a => (useShell && /\s/.test(a) && !a.startsWith('"') ? `"${a}"` : a);

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, useShell ? args.map(quote) : args, {
    encoding: 'utf8',
    shell: useShell,
    ...opts,
  });

const step = msg => console.log(`\n→ ${msg}`);

// ─── Build and pack ─────────────────────────────────────────────────────────

step('Building workspace packages');
run('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'de-server-consumer-'));
const tarballs = path.join(work, 'tarballs');
fs.mkdirSync(tarballs);

step(`Packing tarballs into ${tarballs}`);
// Both publish their build output: each `dist/package.json` is written by that package's
// build-manifest.mjs, so scripts and devDependencies never ship.
for (const dir of ['packages/core/dist', 'packages/server/dist']) {
  run('npm', ['pack', path.join(ROOT, dir)], { cwd: tarballs });
  console.log(`  packed ${dir}`);
}

const tgz = name => {
  const match = fs.readdirSync(tarballs).find(f => f.startsWith(name) && f.endsWith('.tgz'));
  if (!match) throw new Error(`no tarball found for ${name}`);
  return `file:${path.join(tarballs, match).replace(/\\/g, '/')}`;
};

// ─── Consumer project ───────────────────────────────────────────────────────

const proj = path.join(work, 'consumer');
fs.mkdirSync(proj);

fs.writeFileSync(
  path.join(proj, 'package.json'),
  JSON.stringify(
    {
      name: 'server-consumer',
      private: true,
      // Deliberately not `"type": "module"`. The CommonJS entry point is the one a plain
      // `require` reaches, and it is the half that a wrong `main` breaks silently.
      version: '1.0.0',
      dependencies: {
        '@dynamic-entity/core': tgz('dynamic-entity-core'),
        '@dynamic-entity/server': tgz('dynamic-entity-server'),
        express: '^5.0.0',
      },
      devDependencies: {
        '@types/express': '^5.0.0',
        '@types/node': '^20.14.0',
        typescript: '~5.9.3',
      },
    },
    null,
    2,
  ) + '\n',
);

step('Installing the tarballs next to a real Express');
run('npm', ['install', '--no-audit', '--no-fund'], { cwd: proj, stdio: 'inherit' });

// ─── The consumer itself ────────────────────────────────────────────────────

const CONFIG = {
  entity: 'employee',
  version: 1,
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal' },
      fields: [
        { id: 'firstName', type: 'text', label: { en: 'First Name' } },
        { id: 'age', type: 'number', label: { en: 'Age' } },
        { id: 'status', type: 'dropdown', label: { en: 'Status' }, listName: 'statuses' },
      ],
    },
  ],
};

const CHECK = `
'use strict';
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

// 1. CommonJS. A wrong \`main\` fails here and nowhere else.
const server = require('@dynamic-entity/server');
const { createImportRouter } = require('@dynamic-entity/server/express');
const core = require('@dynamic-entity/core');

for (const name of ['runImport', 'previewSheet', 'readSheet', 'writeTemplate', 'guardZip', 'ImportError']) {
  assert.strictEqual(typeof server[name], 'function', name + ' is missing from the CJS entry');
}
assert.strictEqual(typeof createImportRouter, 'function', 'createImportRouter is missing');
assert.ok(server.DEFAULT_LIMITS.maxBytes > 0, 'DEFAULT_LIMITS did not survive packaging');
assert.strictEqual(typeof core.CORE_VERSION, 'string', 'CORE_VERSION is missing from core');

const CONFIG = ${JSON.stringify(CONFIG, null, 2)};
const LOOKUPS = { statuses: [{ en: 'Active' }, { en: 'Inactive' }] };

const PLAN = {
  entity: 'employee',
  entries: [
    { ref: 'personal.firstName', column: 0 },
    { ref: 'personal.age', column: 1 },
    { ref: 'personal.status', column: 2 },
  ],
};

const CSV = 'First Name,Age,Status\\r\\nAlice,34,Active\\r\\nBob,41,Inactive\\r\\n';

const written = [];
const app = express();
app.use(
  '/api/import',
  createImportRouter({
    configs: { employee: CONFIG },
    lookups: LOOKUPS,
    onImport: records => {
      written.push(...records);
    },
  }),
);

// 2. A real listener and real requests, because a router that is never mounted proves
//    nothing about a router.
function multipart(parts) {
  const boundary = '----verify' + Date.now();
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from('--' + boundary + '\\r\\n'));
    chunks.push(
      Buffer.from(
        part.filename
          ? 'Content-Disposition: form-data; name="' + part.name + '"; filename="' + part.filename + '"\\r\\n\\r\\n'
          : 'Content-Disposition: form-data; name="' + part.name + '"\\r\\n\\r\\n',
      ),
    );
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value)));
    chunks.push(Buffer.from('\\r\\n'));
  }
  chunks.push(Buffer.from('--' + boundary + '--\\r\\n'));
  return { body: Buffer.concat(chunks), type: 'multipart/form-data; boundary=' + boundary };
}

function request(port, method, url, payload) {
  return new Promise((resolve, reject) => {
    const options = { port, method, path: url, headers: {} };
    if (payload) {
      options.headers['Content-Type'] = payload.type;
      options.headers['Content-Length'] = payload.body.length;
    }
    const req = http.request(options, res => {
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }),
      );
    });
    req.on('error', reject);
    if (payload) req.write(payload.body);
    req.end();
  });
}

(async () => {
  const listener = app.listen(0);
  await new Promise(resolve => listener.on('listening', resolve));
  const port = listener.address().port;

  try {
    // GET /:entity/template
    const template = await request(port, 'GET', '/api/import/employee/template');
    assert.strictEqual(template.status, 200, 'template route answered ' + template.status);
    assert.match(String(template.headers['content-disposition']), /employee-template\\.csv/);
    assert.match(template.body.toString('utf8'), /First Name/);

    const xlsx = await request(port, 'GET', '/api/import/employee/template?format=xlsx');
    assert.strictEqual(xlsx.status, 200, 'xlsx template answered ' + xlsx.status);
    assert.strictEqual(xlsx.body.subarray(0, 2).toString('latin1'), 'PK', 'xlsx is not a zip');

    // POST /:entity/preview
    const preview = await request(
      port,
      'POST',
      '/api/import/employee/preview',
      multipart([{ name: 'file', filename: 'people.csv', value: Buffer.from(CSV) }]),
    );
    assert.strictEqual(preview.status, 200, 'preview answered ' + preview.status);
    const previewBody = JSON.parse(preview.body.toString('utf8'));
    assert.deepStrictEqual(previewBody.headers, ['First Name', 'Age', 'Status']);
    assert.strictEqual(previewBody.rowCount, 2);
    assert.strictEqual(previewBody.engineVersion, core.CORE_VERSION);

    // POST /:entity/validate — nothing written
    const validated = await request(
      port,
      'POST',
      '/api/import/employee/validate',
      multipart([
        { name: 'plan', value: JSON.stringify(PLAN) },
        { name: 'file', filename: 'people.csv', value: Buffer.from(CSV) },
      ]),
    );
    assert.strictEqual(validated.status, 200, 'validate answered ' + validated.status);
    assert.strictEqual(JSON.parse(validated.body.toString('utf8')).imported, 2);
    assert.strictEqual(written.length, 0, 'validate wrote records');

    // POST /:entity/import — records reach onImport
    const imported = await request(
      port,
      'POST',
      '/api/import/employee/import',
      multipart([
        { name: 'plan', value: JSON.stringify(PLAN) },
        { name: 'file', filename: 'people.csv', value: Buffer.from(CSV) },
      ]),
    );
    assert.strictEqual(imported.status, 200, 'import answered ' + imported.status);
    assert.strictEqual(JSON.parse(imported.body.toString('utf8')).imported, 2);
    assert.strictEqual(written.length, 2, 'onImport received ' + written.length + ' records');
    assert.strictEqual(written[0].personal.firstName, 'Alice');
    // The listName resolved to the option object, not the raw text — which is the whole
    // reason the router refuses to start without the lists.
    assert.deepStrictEqual(written[0].personal.status, { en: 'Active' });

    // An unknown entity 404s, and does not echo the key back.
    const unknown = await request(port, 'GET', '/api/import/nope/template');
    assert.strictEqual(unknown.status, 404);
    assert.ok(!unknown.body.toString('utf8').includes('nope'), '404 echoed the entity back');

    console.log('CommonJS entry, Express adapter and all four routes: ok');
  } finally {
    listener.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
`;

const ESM_CHECK = `
// 3. ESM. The \`module\`/\`exports\` half of the manifest, which a require() never touches.
import assert from 'node:assert';
import { runImport, previewSheet, DEFAULT_LIMITS, ImportError } from '@dynamic-entity/server';
import { createImportRouter } from '@dynamic-entity/server/express';
import { CORE_VERSION, parseCsv, applyMapping } from '@dynamic-entity/core';

assert.strictEqual(typeof runImport, 'function');
assert.strictEqual(typeof previewSheet, 'function');
assert.strictEqual(typeof createImportRouter, 'function');
assert.ok(DEFAULT_LIMITS.batchSize > 0);
assert.ok(new ImportError('NO_FILE', 'x') instanceof Error);
assert.strictEqual(typeof CORE_VERSION, 'string');

const CONFIG = ${JSON.stringify(CONFIG, null, 2)};
const LOOKUPS = { statuses: [{ en: 'Active' }, { en: 'Inactive' }] };
const PLAN = {
  entity: 'employee',
  entries: [
    { ref: 'personal.firstName', column: 0 },
    { ref: 'personal.age', column: 1 },
    { ref: 'personal.status', column: 2 },
  ],
};
const CSV = 'First Name,Age,Status\\r\\nAlice,34,Active\\r\\nBob,41,Inactive\\r\\n';

// 4. The parity claim, from a consumer's side of the packaging: the same file through the
//    in-browser path and through the streaming one must produce the same records.
const browser = applyMapping(parseCsv(CSV).rows, PLAN, CONFIG, { lookups: LOOKUPS });
const streamed = [];
const result = await runImport({
  stream: Buffer.from(CSV),
  plan: PLAN,
  config: CONFIG,
  lookups: LOOKUPS,
  limits: { batchSize: 1 },
  onBatch: records => {
    streamed.push(...records);
  },
});

assert.strictEqual(result.imported, browser.records.length);
assert.deepStrictEqual(streamed, browser.records, 'client and server disagreed about the records');

console.log('ESM entry, and client/server parity across the packed tarballs: ok');
`;

fs.writeFileSync(path.join(proj, 'check.cjs'), CHECK);
fs.writeFileSync(path.join(proj, 'check.mjs'), ESM_CHECK);

step('Driving the router over real HTTP (CommonJS)');
run('node', ['check.cjs'], { cwd: proj, stdio: 'inherit' });

step('Importing as ESM, and checking client/server parity');
run('node', ['check.mjs'], { cwd: proj, stdio: 'inherit' });

// ─── README snippets ────────────────────────────────────────────────────────

/**
 * Every ```ts block, not a hand-picked few.
 *
 * A snippet added later has to be checked too, or the guard silently stops covering the thing
 * it was added for. The server README's one Angular snippet is fenced ```typescript instead and
 * is compiled by verify-consumer.mjs, where `ngx-dynamic-entity` is what is installed.
 *
 * The **root** README is read here as well, and that is not tidiness. Its ```typescript blocks
 * go to verify-consumer.mjs, which installs the Angular packages and not this one — so a
 * server-side snippet there could be compiled by neither script and nobody would notice. That
 * is exactly what happened to the import section's `createImportRouter` example. Two fences
 * split every file by which project can actually check it; nothing may fall between them.
 */
const SNIPPET_SOURCES = ['packages/server/README.md', 'README.md'];
const snippets = SNIPPET_SOURCES.flatMap(file =>
  [
    ...fs
      .readFileSync(path.join(ROOT, file), 'utf8')
      .matchAll(new RegExp('```ts\\n([\\s\\S]*?)```', 'g')),
  ].map(match => match[1]),
);

if (!snippets.length) {
  console.error(`error: no \`\`\`ts snippets found in ${SNIPPET_SOURCES.join(' or ')}`);
  process.exit(1);
}

const src = path.join(proj, 'snippets');
fs.mkdirSync(src);
snippets.forEach((snippet, i) => {
  // A snippet with no import/export is a *script*, so its top-level declarations share one
  // global scope and two examples both naming `result` collide. An appended empty export makes
  // each file a module without altering what it shows.
  const isModule = /^\s*(import|export)\s/m.test(snippet);
  const body = isModule ? snippet : `${snippet}\nexport {};\n`;
  // `.mts`, so tsc treats each snippet as ESM: the consumer project is CommonJS by
  // design — that is what the `require` check needs — and a top-level `await` in a README is
  // otherwise a syntax error rather than the documentation it is.
  fs.writeFileSync(path.join(src, `readme-${i}.mts`), body);
});

fs.writeFileSync(
  path.join(proj, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        // What a consumer's own project most likely looks like, and strict because a snippet
        // that only compiles with the checks off is a snippet that does not compile.
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['snippets'],
    },
    null,
    2,
  ) + '\n',
);

step(`Compiling ${snippets.length} README snippet(s) against the packed tarballs`);
run('npx', ['tsc', '--noEmit', '-p', proj], { cwd: proj, stdio: 'inherit' });

// ─── Done ───────────────────────────────────────────────────────────────────

if (keep) {
  console.log(`\nLeft the project at ${proj}`);
} else {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log('\n@dynamic-entity/server installs, imports both ways, and serves all four routes.');
