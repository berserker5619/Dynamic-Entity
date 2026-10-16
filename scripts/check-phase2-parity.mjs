#!/usr/bin/env node
/**
 * check-phase2-parity.mjs — the parts of the Phase 2 gate a test runner does not hold
 * (docs/phase2-plan.md, "The gate").
 *
 * Phase 2 moved Dynamic Entity's import engine into sheet-to-schema and put Dynamic Entity on
 * top of it. The claim is that nothing changed for a 2.x user. Jest holds most of that. This
 * holds what Jest cannot see from inside one package:
 *
 *   1. **The parity suites are still there and still run.** A suite that proves the browser
 *      and the server agree is worth nothing once it is skipped, marked `failing`, or no
 *      longer reads the shared fixture. Each is checked by name.
 *   2. **What ships to a browser has no Node in it.** The built main entry of sheet-to-schema,
 *      the built `@dynamic-entity/core` and the built `ngx-dynamic-entity` import no workbook
 *      library, no upload parser and no Node built-in.
 *   3. **No import cycle**, between the built packages or between the source modules of the
 *      three that hold the engine. And sheet-to-schema imports nothing of Dynamic Entity's.
 *
 * Read from the built files where it says built, because that is what ships. Run after every
 * package is built: `npm run build && npm run check:parity`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const at = (...parts) => join(ROOT, ...parts);
const read = path => readFileSync(at(path), 'utf8');
const problems = [];
const report = [];

// ─── 1. The parity suites ────────────────────────────────────────────────────

/** A test that is written down and does not run. `it.failing` is the one the plan names. */
const NOT_RUNNING = /\b(?:it|test|describe)\.(?:failing|skip|todo|only)\b|\bx(?:it|describe|test)\s*\(/;

/**
 * Each parity prerequisite: where it is, and the words that make it that test. If a suite is
 * renamed or rewritten, change the line here in the same commit, so the move is seen.
 */
const SUITES = [
  // The shared preview fixture: one set of files, previewed by the server and by the browser.
  { file: 'packages/core/test-fixtures/preview-parity.ts', has: ['PREVIEW_PARITY_CASES', 'expectedCommit'] },
  { file: 'packages/server/src/run-import.spec.ts', has: ['PREVIEW_PARITY_CASES', 'previewSheet, against the shared parity cases', 'runImport, against the shared parity cases'] },
  { file: 'packages/ngx-dynamic-entity/src/lib/import/local-import-transport.spec.ts', has: ['PREVIEW_PARITY_CASES', 'LocalImportTransport.preview, against the shared parity cases'] },
  // The decimal comma: a `;` file means `1,5` is one and a half, on both sides.
  { file: 'packages/server/src/run-import.spec.ts', has: ['imports it with a decimal comma, so 1,500 is one and a half'] },
  { file: 'packages/core/test-fixtures/preview-parity.ts', has: ['semicolon CSV with decimal commas'] },
  // The moved-container snapshots.
  { file: 'packages/core/src/import-moved-containers.spec.ts', has: ['toMatchSnapshot'] },
  { file: 'packages/core/src/__snapshots__/import-moved-containers.spec.ts.snap', has: ['exports['] },
  // The browser's typed-parser tests, which the timezone gate runs in every zone.
  { file: 'packages/ngx-dynamic-entity/src/lib/import/local-import-transport.spec.ts', has: ['LocalImportTransport with a typed parser'] },
  { file: 'scripts/check-timezones.mjs', has: ['NGX', 'IMPORTER', 'local-import-transport'] },
  // One workbook, through the browser and through the server.
  { file: 'packages/core/test-fixtures/xlsx-parity.ts', has: ['PARITY_XLSX_EXPECTED'] },
  { file: 'packages/server/src/xlsx-parity.spec.ts', has: ['PARITY_XLSX_EXPECTED'] },
  { file: 'packages/ngx-dynamic-entity/src/lib/import/xlsx-parity.spec.ts', has: ['PARITY_XLSX_EXPECTED'] },
  // What 2.5.0 imported, which the 3.x engine is compared with.
  { file: 'packages/core/src/entity-form-config-adapter.spec.ts', has: ['import-golden-2.5.0.json', 'a v2 suggestion and the equivalent stored v1 plan'] },
  // The acceptance test against the prototype's fixtures.
  { file: 'packages/sheet-to-schema/src/acceptance.spec.ts', has: ['describe('] },
];

for (const { file, has } of SUITES) {
  if (!existsSync(at(file))) {
    problems.push(`${file} is gone. It is a parity prerequisite.`);
    continue;
  }
  const text = read(file);
  for (const words of has) {
    if (!text.includes(words)) problems.push(`${file} no longer contains "${words}". If the suite moved, say where in scripts/check-phase2-parity.mjs.`);
  }
  if (file.endsWith('.spec.ts')) {
    const line = text.split('\n').findIndex(source => NOT_RUNNING.test(source));
    if (line >= 0) problems.push(`${file}:${line + 1} has a test that is written and does not run. A parity suite has none.`);
  }
}
report.push(`${new Set(SUITES.map(suite => suite.file)).size} parity files present, none skipped`);

// The record of 2.5.0 is of 2.5.0.
{
  const golden = JSON.parse(read('packages/core/test-fixtures/import-golden-2.5.0.json'));
  if (golden.from !== '@dynamic-entity/core@2.5.0, the published package') problems.push(`import-golden-2.5.0.json says it is from "${golden.from}". It is a record of the published 2.5.0 and of nothing else.`);
  if (!Array.isArray(golden.cases) || golden.cases.length < 31) problems.push(`import-golden-2.5.0.json holds ${golden.cases?.length} cases; it was committed with 31. A record does not shrink.`);
}

// ─── 2. What ships to a browser ───────────────────────────────────────────────

const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const NODE_ONLY = ['exceljs', 'busboy', 'express'];

/** Every module a built or source file imports at run time, by specifier. `import type` is not one. */
function importsOf(text) {
  const found = new Set();
  const patterns = [
    /^\s*(?:import|export)\s+(?!type\b)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

const BROWSER_BUNDLES = [
  'packages/sheet-to-schema/dist/index.js',
  'packages/sheet-to-schema/dist/index.mjs',
  'packages/core/dist/index.js',
  'packages/core/dist/index.mjs',
  'packages/ngx-dynamic-entity/dist/fesm2022/ngx-dynamic-entity.mjs',
];
for (const file of BROWSER_BUNDLES) {
  if (!existsSync(at(file))) {
    problems.push(`${file} is missing: build every package first.`);
    continue;
  }
  const specifiers = importsOf(read(file));
  for (const specifier of specifiers) {
    if (BUILTINS.has(specifier) || NODE_ONLY.some(lib => specifier === lib || specifier.startsWith(`${lib}/`))) {
      problems.push(`${file} imports "${specifier}". It ships to a browser.`);
    }
    if (specifier === 'sheet-to-schema/node') problems.push(`${file} imports "sheet-to-schema/node", the entry that needs Node. It ships to a browser.`);
  }
  report.push(`${file.replace('packages/', '')}: ${specifiers.length} imports, none of Node`);
}

// ─── 3. No import cycle ──────────────────────────────────────────────────────

/** The first cycle in a graph of `node -> [nodes]`, as the path that closes it, or null. */
function cycleIn(graph) {
  const state = new Map();
  const path = [];
  const visit = node => {
    if (state.get(node) === 'done') return null;
    if (state.get(node) === 'open') return [...path.slice(path.indexOf(node)), node];
    state.set(node, 'open');
    path.push(node);
    for (const next of graph.get(node) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    state.set(node, 'done');
    return null;
  };
  for (const node of graph.keys()) {
    const found = visit(node);
    if (found) return found;
  }
  return null;
}

// Between packages, from what each one's built entries import.
const PACKAGES = {
  'sheet-to-schema': ['packages/sheet-to-schema/dist/index.js', 'packages/sheet-to-schema/dist/index.mjs'],
  'sheet-to-schema/node': ['packages/sheet-to-schema/dist/node/index.js', 'packages/sheet-to-schema/dist/node/index.mjs'],
  '@dynamic-entity/core': ['packages/core/dist/index.js', 'packages/core/dist/index.mjs', 'packages/core/dist/cli.js', 'packages/core/dist/cli.mjs'],
  '@dynamic-entity/server': ['packages/server/dist/index.js', 'packages/server/dist/index.mjs'],
  '@dynamic-entity/server/express': ['packages/server/dist/express.js', 'packages/server/dist/express.mjs'],
  'ngx-dynamic-entity': ['packages/ngx-dynamic-entity/dist/fesm2022/ngx-dynamic-entity.mjs'],
  'ngx-dynamic-entity-builder': ['packages/ngx-dynamic-entity-builder/dist/fesm2022/ngx-dynamic-entity-builder.mjs'],
};
const packageGraph = new Map();
for (const [name, files] of Object.entries(PACKAGES)) {
  const imports = new Set();
  for (const file of files) {
    if (!existsSync(at(file))) {
      problems.push(`${file} is missing: build every package first.`);
      continue;
    }
    for (const specifier of importsOf(read(file))) if (specifier in PACKAGES && specifier !== name) imports.add(specifier);
  }
  packageGraph.set(name, [...imports]);
}
{
  const cycle = cycleIn(packageGraph);
  if (cycle) problems.push(`the built packages import each other in a circle: ${cycle.join(' -> ')}.`);
  // The direction of the whole extraction: Dynamic Entity is built on the importer, never the reverse.
  for (const name of ['sheet-to-schema', 'sheet-to-schema/node']) {
    const upward = packageGraph.get(name).filter(dependency => !dependency.startsWith('sheet-to-schema'));
    if (upward.length) problems.push(`${name} imports ${upward.join(', ')}. It must import nothing of Dynamic Entity's.`);
  }
  if (!packageGraph.get('@dynamic-entity/core').includes('sheet-to-schema')) problems.push('@dynamic-entity/core does not import sheet-to-schema. Its import engine is supposed to be that one.');
  if (!packageGraph.get('@dynamic-entity/server').includes('sheet-to-schema/node')) problems.push('@dynamic-entity/server does not import sheet-to-schema/node. Its runner is supposed to be that one.');
  report.push(`packages: ${[...packageGraph].map(([name, imports]) => `${name} -> [${imports.join(', ')}]`).join('; ')}`);
}

// Between the source modules of the packages that hold the engine. A bundler hides a cycle
// inside one file, where it becomes a question of which module is evaluated first.
function sourceFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.(spec|fixtures|d)\.ts$/.test(name) ? [path] : [];
  });
}
for (const src of ['packages/sheet-to-schema/src', 'packages/core/src', 'packages/server/src']) {
  const files = sourceFiles(at(src));
  const known = new Set(files);
  const graph = new Map();
  for (const file of files) {
    const imports = importsOf(readFileSync(file, 'utf8'))
      .filter(specifier => specifier.startsWith('.'))
      .map(specifier => {
        const base = resolve(dirname(file), specifier);
        return [`${base}.ts`, join(base, 'index.ts')].find(candidate => known.has(candidate));
      })
      .filter(Boolean);
    graph.set(file, imports);
  }
  const cycle = cycleIn(graph);
  if (cycle) problems.push(`${src} has an import cycle: ${cycle.map(file => relative(at(src), file).replace(/\\/g, '/')).join(' -> ')}.`);
  report.push(`${src}: ${files.length} modules, no cycle`);
}

// ─── 4. Publishable package repository metadata ──────────────────────────────

const PUBLISHABLE = [
  { name: 'sheet-to-schema', dir: 'packages/sheet-to-schema' },
  { name: '@dynamic-entity/core', dir: 'packages/core' },
  { name: 'ngx-dynamic-entity', dir: 'packages/ngx-dynamic-entity' },
  { name: 'ngx-dynamic-entity-builder', dir: 'packages/ngx-dynamic-entity-builder' },
  { name: '@dynamic-entity/server', dir: 'packages/server' },
];

const EXPECTED_REPO_URL = 'git+https://github.com/berserker5619/Dynamic-Entity.git';

for (const { dir } of PUBLISHABLE) {
  const pkgPath = `${dir}/package.json`;
  const pkg = JSON.parse(read(pkgPath));
  if (pkg.repository?.url !== EXPECTED_REPO_URL) {
    problems.push(`${pkgPath} must declare repository.url = '${EXPECTED_REPO_URL}', was '${pkg.repository?.url}'.`);
  }
  if (pkg.repository?.directory !== dir) {
    problems.push(`${pkgPath} must declare repository.directory = '${dir}', was '${pkg.repository?.directory}'.`);
  }
}
report.push(`repository metadata: all ${PUBLISHABLE.length} publishable packages point to ${EXPECTED_REPO_URL} with matching directory`);

// ─── Verdict ─────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error('The Phase 2 parity gate failed. Stop and report; do not adjust an expectation to pass it.\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
for (const line of report) console.log(`  ${line}`);
console.log('The Phase 2 parity gate holds.');
