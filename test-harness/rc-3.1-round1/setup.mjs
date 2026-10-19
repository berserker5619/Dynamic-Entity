// The rc.1 round: two fresh Angular 21 apps from the published packages, built with `ng build`.
// Usage: node setup.mjs <DE version> . Writes csv-app/ and full-app/ beside this file.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = process.argv[2];
if (!VERSION) throw new Error('usage: node setup.mjs <DE version>');
const shell = process.platform === 'win32';
const main = fs.readFileSync(path.join(HERE, 'app-main.ts'), 'utf8');

for (const [name, xlsx] of [['csv-app', false], ['full-app', true]]) {
  const app = path.join(HERE, name);
  fs.rmSync(app, { recursive: true, force: true });
  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  const ng = '^21.0.0';
  const dependencies = {
    '@angular/common': ng, '@angular/compiler': ng, '@angular/core': ng, '@angular/forms': ng, '@angular/platform-browser': ng,
    rxjs: '^7.8.0', tslib: '^2.3.0',
    '@dynamic-entity/core': VERSION, 'ngx-dynamic-entity': VERSION,
    ...(xlsx ? { exceljs: '^4.4.0' } : {}),
  };
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name, private: true, dependencies, devDependencies: { '@angular/build': ng, '@angular/cli': ng, '@angular/compiler-cli': ng, typescript: '~5.9.3' } }, null, 2));
  fs.writeFileSync(path.join(app, 'angular.json'), JSON.stringify({
    version: 1,
    projects: { app: { projectType: 'application', root: '', sourceRoot: 'src', architect: { build: {
      builder: '@angular/build:application',
      options: { browser: 'src/main.ts', index: 'src/index.html', tsConfig: 'tsconfig.json', outputPath: 'dist' },
      configurations: { production: { optimization: true, outputHashing: 'all' } }, defaultConfiguration: 'production',
    } } } },
  }));
  fs.writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler', strict: true, skipLibCheck: true, lib: ['ES2022', 'dom'] }, files: ['src/main.ts'] }));
  fs.writeFileSync(path.join(app, 'src/index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>loading</title></head><body><app-root></app-root></body></html>');
  fs.writeFileSync(
    path.join(app, 'src/main.ts'),
    main
      .replace('//__XLSX_IMPORT__', xlsx ? "import { provideSheetFileParser } from 'ngx-dynamic-entity/xlsx';" : '')
      .replace('//__XLSX_PROVIDER__', xlsx ? "...(query.get('parser') === 'xlsx' ? provideSheetFileParser() : [])," : ''),
  );
  console.log(`\n${name}: installing ngx-dynamic-entity@${VERSION}${xlsx ? ' with exceljs' : ', no exceljs'}...`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: app, shell, stdio: 'inherit' });
  const has = fs.existsSync(path.join(app, 'node_modules/exceljs'));
  console.log(`${name}: exceljs installed: ${has}`);
  console.log(execFileSync('npm', ['ls', '@dynamic-entity/core', 'ngx-dynamic-entity', 'sheet-to-schema'], { cwd: app, shell }).toString().trim());
  const result = spawnSync('npx', ['ng', 'build'], { cwd: app, shell, encoding: 'utf8', env: { ...process.env, NG_CLI_ANALYTICS: 'false', FORCE_COLOR: '0' } });
  console.log(`${name}: ng build exited ${result.status}`);
  const out = `${result.stdout}\n${result.stderr}`;
  fs.writeFileSync(path.join(app, 'build.log'), out);
  if (result.status !== 0) console.log(out.slice(-2000));
  const browser = path.join(app, 'dist/browser');
  const excel = fs.existsSync(browser) ? fs.readdirSync(browser).filter(f => f.endsWith('.js') && fs.readFileSync(path.join(browser, f), 'utf8').includes('Worksheet name already exists')) : [];
  console.log(`${name}: chunks holding ExcelJS: ${excel.join(', ') || 'none'}`);
}
