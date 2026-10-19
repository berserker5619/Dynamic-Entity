#!/usr/bin/env node
/**
 * verify-xlsx-entry.mjs — an Angular app's `ng build`, with and without `exceljs` (docs/3.1-spec.md, A1).
 *
 * Step 0 found that Angular's application builder fails on sheet-to-schema/browser's
 * `import('exceljs')` when `exceljs` is not installed, which is why `.xlsx` is an entry of its own.
 * This builds a fresh Angular app from the packed tarballs, as a user installs them, three times:
 *
 *   1. CSV only (the wizard, `provideNgxDynamicEntity`), `exceljs` not installed: `ng build`
 *      passes, and no ExcelJS is anywhere in the output.
 *   2. The same app with `provideSheetFileParser()` from `ngx-dynamic-entity/xlsx`, `exceljs` still
 *      not installed: `ng build` fails, saying `Could not resolve "exceljs"`.
 *   3. The same, with `exceljs` installed: `ng build` passes, and ExcelJS is in a lazy chunk only,
 *      never in what the page loads up front.
 *
 * Usage: node scripts/verify-xlsx-entry.mjs [--angular 21] [--keep]. Run after `npm run build`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
};
const ANGULAR = String(arg('angular') ?? '21');
const KEEP = !!arg('keep');
const shell = process.platform === 'win32';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, shell, stdio: 'inherit' });

const DISTS = { core: 'packages/core/dist', ngx: 'packages/ngx-dynamic-entity/dist' };
for (const dir of Object.values(DISTS)) {
  if (!fs.existsSync(path.join(ROOT, dir, 'package.json'))) {
    console.error(`${dir} not found. Run npm run build first.`);
    process.exit(1);
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), `de-xlsx-entry-ng${ANGULAR}-`));
const tarballs = path.join(work, 'tarballs');
fs.mkdirSync(tarballs);
const packed = {};
for (const [key, dir] of Object.entries(DISTS)) {
  // Packed from inside the dist folder: with a shell on Windows, a path with a space in it
  // ("Dynamic Entity") would be split into two arguments.
  const out = execFileSync('npm', ['pack', '--silent', '--pack-destination', tarballs], { cwd: path.join(ROOT, dir), shell }).toString().trim().split(/\r?\n/).pop();
  packed[key] = `file:${path.join(tarballs, out).replace(/\\/g, '/')}`;
}

const app = path.join(work, 'app');
fs.mkdirSync(path.join(app, 'src'), { recursive: true });
const ng = `^${ANGULAR}.0.0`;
fs.writeFileSync(
  path.join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'xlsx-entry-app',
      private: true,
      dependencies: {
        '@angular/common': ng,
        '@angular/compiler': ng,
        '@angular/core': ng,
        '@angular/forms': ng,
        '@angular/platform-browser': ng,
        rxjs: '^7.8.0',
        tslib: '^2.3.0',
        '@dynamic-entity/core': packed.core,
        'ngx-dynamic-entity': packed.ngx,
      },
      devDependencies: { '@angular/build': ng, '@angular/cli': ng, '@angular/compiler-cli': ng, typescript: '~5.9.3' },
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(app, 'angular.json'),
  JSON.stringify({
    version: 1,
    newProjectRoot: 'projects',
    projects: {
      app: {
        projectType: 'application',
        root: '',
        sourceRoot: 'src',
        architect: {
          build: {
            builder: '@angular/build:application',
            options: { browser: 'src/main.ts', index: 'src/index.html', tsConfig: 'tsconfig.json', outputPath: 'dist' },
            configurations: { production: { optimization: true, outputHashing: 'all' } },
            defaultConfiguration: 'production',
          },
        },
      },
    },
  }),
);
fs.writeFileSync(
  path.join(app, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler', strict: true, skipLibCheck: true, lib: ['ES2022', 'dom'] }, files: ['src/main.ts'] }),
);
fs.writeFileSync(path.join(app, 'src/index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>xlsx entry</title></head><body><app-root></app-root></body></html>');

const main = withXlsx => `import { Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { EntityImportComponent, provideNgxDynamicEntity } from 'ngx-dynamic-entity';
${withXlsx ? "import { provideSheetFileParser } from 'ngx-dynamic-entity/xlsx';\n" : ''}
const config: EntityFormConfig = { entity: 'people', tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }] }] };

@Component({ selector: 'app-root', imports: [EntityImportComponent], template: '<ngx-entity-import [config]="config" />' })
class App {
  protected readonly config = config;
}

bootstrapApplication(App, { providers: [provideZonelessChangeDetection(), provideNgxDynamicEntity({})${withXlsx ? ', provideSheetFileParser()' : ''}] }).catch(console.error);
`;

console.log(`Installing Angular ${ANGULAR} and the packed tarballs, without exceljs...`);
run('npm', ['install', '--no-audit', '--no-fund', '--silent'], app);
if (fs.existsSync(path.join(app, 'node_modules/exceljs'))) {
  console.error('exceljs was installed with the app, so this proves nothing: it must be an optional peer.');
  process.exit(1);
}

/** `ng build`, and its output: whether it built, what it printed, and the chunks it wrote. */
function build(label) {
  fs.rmSync(path.join(app, 'dist'), { recursive: true, force: true });
  const result = spawnSync('npx', ['ng', 'build'], { cwd: app, shell, encoding: 'utf8', env: { ...process.env, NG_CLI_ANALYTICS: 'false', FORCE_COLOR: '0' } });
  const output = `${result.stdout}\n${result.stderr}`;
  const browser = path.join(app, 'dist/browser');
  const chunks = fs.existsSync(browser) ? fs.readdirSync(browser).filter(f => f.endsWith('.js')) : [];
  console.log(`\n${label}: ng build exited ${result.status}`);
  return { ok: result.status === 0, output, browser, chunks };
}
/** A string only ExcelJS contains. */
const isExcel = (dir, chunk) => fs.readFileSync(path.join(dir, chunk), 'utf8').includes('Worksheet name already exists');
/** The scripts index.html loads, and what they import statically, transitively. */
function upFront(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const pending = [...html.matchAll(/src="([^"]+\.js)"/g)].map(m => m[1]);
  const seen = new Set();
  while (pending.length) {
    const chunk = pending.pop();
    if (seen.has(chunk) || !fs.existsSync(path.join(dir, chunk))) continue;
    seen.add(chunk);
    const text = fs.readFileSync(path.join(dir, chunk), 'utf8');
    for (const m of text.matchAll(/(?:^|[;\s])import\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) pending.push(m[1]);
  }
  return [...seen];
}

const problems = [];
const expect = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) problems.push(what);
};

try {
  fs.writeFileSync(path.join(app, 'src/main.ts'), main(false));
  const csv = build('1. CSV only, exceljs not installed');
  expect(csv.ok, 'ng build passes');
  if (!csv.ok) console.log(csv.output.slice(-3000));
  expect(csv.ok && !csv.chunks.some(chunk => isExcel(csv.browser, chunk)), 'and no ExcelJS is anywhere in the output');

  fs.writeFileSync(path.join(app, 'src/main.ts'), main(true));
  const missing = build('2. With provideSheetFileParser(), exceljs not installed');
  expect(!missing.ok, 'ng build fails');
  expect(/Could not resolve "exceljs"/.test(missing.output), 'saying Could not resolve "exceljs"');
  const said = missing.output.split(/\r?\n/).find(line => line.includes('Could not resolve'));
  if (said) console.log(`  (${said.trim()})`);

  console.log('\nInstalling exceljs...');
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', 'exceljs@^4.4.0'], app);
  const installed = build('3. With provideSheetFileParser(), exceljs installed');
  expect(installed.ok, 'ng build passes');
  if (installed.ok) {
    const initial = upFront(installed.browser);
    const excel = installed.chunks.filter(chunk => isExcel(installed.browser, chunk));
    expect(excel.length > 0, `ExcelJS is in the output (${excel.join(', ') || 'nowhere'})`);
    expect(excel.every(chunk => !initial.includes(chunk)), `and only in a lazy chunk, never up front (${initial.join(', ')})`);
  } else {
    console.log(installed.output.slice(-3000));
  }
} finally {
  if (KEEP) console.log(`\nKept ${work}`);
  else fs.rmSync(work, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\nThe xlsx entry does not build as A1 says, on ${problems.length} point(s).`);
  process.exit(1);
}
console.log(`\nAngular ${ANGULAR}: a CSV-only app builds without exceljs; the xlsx entry needs it, and loads it lazily.`);
