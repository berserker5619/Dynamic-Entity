#!/usr/bin/env node
/**
 * check-xlsx-entry.mjs — `ngx-dynamic-entity/xlsx` is the only door to `exceljs` (docs/3.1-spec.md, A1).
 *
 * Angular's `ng build` fails on sheet-to-schema/browser's `import('exceljs')` when `exceljs` is not
 * installed (Step 0), so a DE app that never reads a workbook must never reach that module.
 * This holds the boundary three ways:
 *
 * 1. The built primary entry imports neither `exceljs` nor `sheet-to-schema/browser`, and the
 *    xlsx entry does import `sheet-to-schema/browser` (or this proves nothing).
 * 2. No source in any package imports `sheet-to-schema/browser` or `exceljs` outside the xlsx
 *    entry, specs and fixtures aside.
 * 3. The published manifest lists `exceljs` as an optional peer and `sheet-to-schema` as a
 *    dependency, and exports `./xlsx`.
 *
 * That an app really builds is `scripts/verify-xlsx-entry.mjs`'s, which runs `ng build`.
 * Run after `npm run build`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'packages/ngx-dynamic-entity/dist');
const problems = [];

/** Every module specifier a built ES module imports, statically or with `import()`. */
const importsOf = text => [...text.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^import\s*['"]([^'"]+)['"]/gm)].map(m => m[1] ?? m[2] ?? m[3]);
const reachesExcel = s => s === 'exceljs' || s.startsWith('exceljs/') || s === 'sheet-to-schema/browser';

// 1. The built entries.
const primary = path.join(DIST, 'fesm2022/ngx-dynamic-entity.mjs');
const xlsx = path.join(DIST, 'fesm2022/ngx-dynamic-entity-xlsx.mjs');
for (const file of [primary, xlsx]) if (!existsSync(file)) problems.push(`${path.relative(ROOT, file)} is missing: run npm run build.`);
if (!problems.length) {
  const fromPrimary = importsOf(readFileSync(primary, 'utf8'));
  for (const s of fromPrimary.filter(reachesExcel)) problems.push(`the primary entry imports "${s}". Only ngx-dynamic-entity/xlsx may: a CSV-only app must build without exceljs.`);
  const fromXlsx = importsOf(readFileSync(xlsx, 'utf8'));
  if (!fromXlsx.includes('sheet-to-schema/browser')) problems.push('the xlsx entry does not import sheet-to-schema/browser, so this check proves nothing about it.');
  if (fromXlsx.some(s => s === 'exceljs' || s.startsWith('exceljs/'))) problems.push('the xlsx entry imports exceljs itself. sheet-to-schema/browser loads it, lazily, on the first workbook.');
  console.log(`primary entry: ${[...new Set(fromPrimary)].filter(s => s.includes('sheet-to-schema')).join(', ')}; xlsx entry: ${[...new Set(fromXlsx)].join(', ')}`);
}

// 2. Every package's sources.
const XLSX_SOURCES = path.join(ROOT, 'packages/ngx-dynamic-entity/xlsx/src');
const SKIP = new Set(['node_modules', 'dist', 'coverage', 'e2e', 'test-fixtures', 'out-tsc']);
const sources = [];
const walk = dir => {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.ts$/.test(entry) && !/\.(spec|fixtures)\.ts$/.test(entry)) sources.push(full);
  }
};
walk(path.join(ROOT, 'packages'));
for (const file of sources) {
  if (file.startsWith(XLSX_SOURCES)) continue;
  const text = readFileSync(file, 'utf8');
  for (const s of [...text.matchAll(/from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1] ?? m[2])) {
    // The server reads workbooks on Node, through sheet-to-schema/node, and exceljs is its own
    // dependency; only browser code is held to this.
    if (file.includes(`${path.sep}server${path.sep}`)) continue;
    if (reachesExcel(s)) problems.push(`${path.relative(ROOT, file)} imports "${s}". Only ngx-dynamic-entity/xlsx may.`);
  }
}
console.log(`${sources.length} sources outside the xlsx entry, none reaching exceljs`);

// 3. The manifest that ships.
const manifest = JSON.parse(readFileSync(path.join(DIST, 'package.json'), 'utf8'));
if (manifest.peerDependencies?.exceljs === undefined || manifest.peerDependenciesMeta?.exceljs?.optional !== true) problems.push('the published manifest does not list exceljs as an optional peer.');
if (manifest.dependencies?.exceljs !== undefined) problems.push('the published manifest lists exceljs as a dependency: every app would install it.');
if (manifest.dependencies?.['sheet-to-schema'] === undefined) problems.push('the published manifest does not depend on sheet-to-schema, which the default parser imports.');
if (!manifest.exports?.['./xlsx']) problems.push('the published manifest does not export ./xlsx.');

// 4. Secondary entry points must be mapped in typesVersions for TS Node10 resolution.
const NGX_DIR = path.join(ROOT, 'packages/ngx-dynamic-entity');
const secondaryEntries = readdirSync(NGX_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && !SKIP.has(d.name))
  .filter(d => existsSync(path.join(NGX_DIR, d.name, 'ng-package.json')))
  .map(d => d.name);

for (const entry of secondaryEntries) {
  const mapped = manifest.typesVersions?.['*']?.[entry];
  if (!mapped || !Array.isArray(mapped) || mapped.length === 0) {
    problems.push(`the published manifest typesVersions["*"] does not map secondary entry "${entry}".`);
  } else {
    for (const target of mapped) {
      if (!existsSync(path.join(DIST, target))) {
        problems.push(`the published manifest typesVersions["*"]["${entry}"] target "${target}" does not exist in dist.`);
      }
    }
  }
}

if (problems.length) {
  console.error('\nThe xlsx entry boundary does not hold:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('ngx-dynamic-entity/xlsx is the only door to exceljs; exceljs is an optional peer.');
