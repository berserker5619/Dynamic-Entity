#!/usr/bin/env node
/**
 * check-importer-bundle.mjs — what each entry of sheet-to-schema is allowed to pull in.
 *
 * The main entry runs in a browser. `@dynamic-entity/core` re-exports it, and every Dynamic
 * Entity browser app imports core, so one stray import of a Node built-in or of a workbook
 * library there breaks every one of them at build time, a long way from the line at fault.
 *
 * The `/node` entry may use Node and its optional peers, but must not carry its own copy of
 * the main entry: two copies means two `ImportFailure` classes, and an `instanceof` across
 * them is false.
 *
 * Read from the built files, because that is what ships. Run after the package is built.
 */
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'packages', 'sheet-to-schema', 'dist');
const NODE_ONLY = ['exceljs', 'busboy', 'express'];
const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

/** Every module a built file imports or requires, by specifier. */
function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const found = new Set();
  for (const pattern of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*import\s*['"]([^'"]+)['"]/gm]) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return { text, specifiers: [...found] };
}

const problems = [];
const report = [];

// ── The main entry: nothing but itself ──────────────────────────────────────────
for (const name of ['index.js', 'index.mjs']) {
  const file = join(DIST, name);
  if (!existsSync(file)) {
    problems.push(`${name} is missing: build sheet-to-schema first.`);
    continue;
  }
  const { specifiers } = importsOf(file);
  const forbidden = specifiers.filter(s => BUILTINS.has(s) || NODE_ONLY.some(lib => s === lib || s.startsWith(`${lib}/`)));
  const other = specifiers.filter(s => !forbidden.includes(s));
  for (const specifier of forbidden) problems.push(`the main entry (${name}) imports "${specifier}". It must run in a browser.`);
  // Zero runtime dependencies: a relative import would be a second file, and anything else a package.
  for (const specifier of other) problems.push(`the main entry (${name}) imports "${specifier}". It must have no runtime dependencies.`);
  report.push(`${name}: ${specifiers.length} imports`);
}

// ── The /node entry: Node and its peers, and the main entry by name only ────────
for (const name of ['node/index.js', 'node/index.mjs']) {
  const file = join(DIST, name);
  if (!existsSync(file)) {
    problems.push(`${name} is missing: build sheet-to-schema first.`);
    continue;
  }
  const { text, specifiers } = importsOf(file);
  const allowed = s => BUILTINS.has(s) || s === 'sheet-to-schema' || NODE_ONLY.some(lib => s === lib || s.startsWith(`${lib}/`));
  for (const specifier of specifiers.filter(s => !allowed(s))) {
    problems.push(`the /node entry (${name}) imports "${specifier}", which is neither Node, an optional peer, nor the main entry.`);
  }
  // An optional peer is loaded when first needed, never when the entry is. A static import of
  // one would make reading a CSV depend on a package for reading workbooks or uploads. Only
  // the ES module shows the difference: there a static import is `from`, and a lazy one `import()`.
  if (name.endsWith('.mjs')) {
    for (const match of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      if (NODE_ONLY.some(lib => match[1] === lib || match[1].startsWith(`${lib}/`))) {
        problems.push(`the /node entry (${name}) imports the optional peer "${match[1]}" when it loads. Load it with loadOptional, when it is first needed.`);
      }
    }
  }
  // One marker from the main entry's own code. If it is here, the engine was bundled twice.
  if (/class ImportFailure\b/.test(text)) {
    problems.push(`the /node entry (${name}) carries its own copy of the main entry (it defines ImportFailure). Import the main entry as "sheet-to-schema".`);
  }
  report.push(`${name}: ${specifiers.sort().join(', ') || 'no imports'}`);
}

if (problems.length) {
  console.error('sheet-to-schema ships something it must not:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`sheet-to-schema's entries import only what they may (${report.join('; ')}).`);
