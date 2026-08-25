#!/usr/bin/env node
/**
 * verify-consumer.mjs — prove the published packages work for someone who installs them.
 *
 * Builds tarballs exactly as `npm publish` would, installs them into a throwaway Angular
 * project alongside a real Angular version, and compiles a consumer component with the
 * Angular AOT compiler under `strictTemplates`.
 *
 * Two things this catches that the workspace build cannot:
 *   1. Packaging faults — a wrong `main`, a missing peer, a stray runtime dependency.
 *      Inside the workspace everything resolves through symlinks and tsconfig paths, so a
 *      broken manifest still "works" right up until someone installs it.
 *   2. Version drift — the peer range claims Angular 17 through 22, and only compiling
 *      against each of them turns that claim into a fact.
 *
 * Usage:
 *   node scripts/verify-consumer.mjs --angular 20
 *   node scripts/verify-consumer.mjs --angular 22 --readme
 *
 *   --angular <major>  Angular major to install (required).
 *   --readme           Compile the snippets from the README files instead of the built-in
 *                      consumer component, so the documented Quick Start is proven to work.
 *   --keep             Leave the temporary project on disk for inspection.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const angularMajor = arg('angular');
const useReadme = !!arg('readme');
const keep = !!arg('keep');

if (!angularMajor || angularMajor === true) {
  console.error('error: --angular <major> is required, e.g. --angular 20');
  process.exit(2);
}

// npm/npx are .cmd shims on Windows, so they need a shell — which in turn means any
// argument containing a space (this repo lives under "Dynamic Entity") must be quoted by
// hand, since the shell re-splits what execFile would otherwise have passed verbatim.
const useShell = process.platform === 'win32';
const quote = a => (useShell && /[\s]/.test(a) && !a.startsWith('"') ? `"${a}"` : a);

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, useShell ? args.map(quote) : args, {
    encoding: 'utf8',
    shell: useShell,
    ...opts,
  });

const step = msg => console.log(`\n→ ${msg}`);

// ─── Workspace build ────────────────────────────────────────────────────────

step('Building workspace packages');
run('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });

// ─── Pack ───────────────────────────────────────────────────────────────────

const work = fs.mkdtempSync(path.join(os.tmpdir(), `de-consumer-ng${angularMajor}-`));
const tarballs = path.join(work, 'tarballs');
fs.mkdirSync(tarballs);

step(`Packing tarballs into ${tarballs}`);
// core publishes from its own root (files: ["dist"]); the Angular packages publish the
// ng-packagr output, so pack exactly what each would publish.
const sources = {
  core: path.join(ROOT, 'packages/core'),
  renderer: path.join(ROOT, 'packages/ngx-dynamic-entity/dist'),
  builder: path.join(ROOT, 'packages/ngx-dynamic-entity-builder/dist'),
};
for (const [name, dir] of Object.entries(sources)) {
  run('npm', ['pack', dir], { cwd: tarballs });
  console.log(`  packed ${name}`);
}

const tgz = name => {
  const match = fs.readdirSync(tarballs).find(f => f.startsWith(name) && f.endsWith('.tgz'));
  if (!match) throw new Error(`no tarball found for ${name}`);
  return `file:${path.join(tarballs, match).replace(/\\/g, '/')}`;
};

// ─── Consumer project ───────────────────────────────────────────────────────

const proj = path.join(work, 'consumer');
fs.mkdirSync(proj);

const ng = `^${angularMajor}.0.0`;
fs.writeFileSync(
  path.join(proj, 'package.json'),
  JSON.stringify(
    {
      name: `consumer-ng${angularMajor}`,
      private: true,
      version: '1.0.0',
      dependencies: {
        '@angular/animations': ng,
        '@angular/cdk': ng,
        '@angular/common': ng,
        '@angular/compiler': ng,
        '@angular/core': ng,
        '@angular/forms': ng,
        '@angular/material': ng,
        '@angular/platform-browser': ng,
        rxjs: '^7.8.0',
        '@dynamic-entity/core': tgz('dynamic-entity-core'),
        'ngx-dynamic-entity': tgz('ngx-dynamic-entity-1'),
        'ngx-dynamic-entity-builder': tgz('ngx-dynamic-entity-builder'),
      },
      devDependencies: { '@angular/compiler-cli': ng },
    },
    null,
    2,
  ),
);

step(`Installing Angular ${angularMajor} + the packed tarballs (this also proves peer resolution)`);
run('npm', ['install', '--no-audit', '--no-fund'], { cwd: proj, stdio: 'inherit' });

const resolved = JSON.parse(
  fs.readFileSync(path.join(proj, 'node_modules/@angular/core/package.json'), 'utf8'),
).version;
console.log(`  resolved @angular/core ${resolved}`);

// The compiler pins a TypeScript range; install exactly what it asks for.
const tsRange = JSON.parse(
  fs.readFileSync(path.join(proj, 'node_modules/@angular/compiler-cli/package.json'), 'utf8'),
).peerDependencies.typescript;
run('npm', ['install', '--no-save', '--no-audit', '--no-fund', `typescript@${tsRange}`], {
  cwd: proj,
  stdio: 'inherit',
});

// A nested copy of the renderer means the builder shipped it as a runtime dependency, which
// breaks InjectionToken identity: registries provided by the app become invisible to it.
const nested = fs.existsSync(path.join(proj, 'node_modules/ngx-dynamic-entity-builder/node_modules'));
if (nested) {
  console.error('\nFAIL: ngx-dynamic-entity-builder installed nested dependencies of its own.');
  console.error('      Its peers must stay peers — a second copy of the renderer breaks DI.');
  process.exit(1);
}

// ─── Sources to compile ─────────────────────────────────────────────────────

const files = [];

function write(name, contents) {
  fs.writeFileSync(path.join(proj, name), contents);
  files.push(name);
}

if (useReadme) {
  step('Extracting snippets from the README files');
  const ts = s => [...s.matchAll(/```typescript\n([\s\S]*?)```/g)].map(m => m[1]);
  const html = s => [...s.matchAll(/```html\n([\s\S]*?)```/g)].map(m => m[1]);
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

  const rootMd = read('README.md');
  const rendererMd = read('packages/ngx-dynamic-entity/README.md');
  const builderMd = read('packages/ngx-dynamic-entity-builder/README.md');

  // Every ```typescript block, not a hand-picked few — a snippet added later must be
  // checked too, or the guard silently stops covering the thing it was added for.
  const coreMd = read('packages/core/README.md');
  const allTs = [
    ['root', rootMd],
    ['core', coreMd],
    ['renderer', rendererMd],
    ['builder', builderMd],
  ];
  for (const [label, md] of allTs) {
    ts(md).forEach((snippet, i) => {
      // A snippet with no import/export is a *script*, not a module, so its top-level
      // declarations share one global scope and two examples both naming `record` collide.
      // Appending an empty export makes each file a module without altering what it shows.
      const isModule = /^\s*(import|export)\s/m.test(snippet);
      write(`readme-${label}-${i}.ts`, isModule ? snippet : `${snippet}\nexport {};\n`);
    });
  }

  const host = (cls, selector, imports, importLine, template, members) =>
    [
      "import { Component } from '@angular/core';",
      importLine,
      "import type { EntityFormConfig } from '@dynamic-entity/core';",
      '@Component({',
      `  selector: '${selector}',`,
      '  standalone: true,',
      `  imports: [${imports}],`,
      '  template: `',
      template,
      '`,',
      '})',
      `export class ${cls} {`,
      members,
      '}',
    ].join('\n');

  write(
    'readme-renderer-usage.ts',
    host(
      'ReadmeRendererUsage',
      'readme-renderer-usage',
      'DynamicFormComponent',
      "import { DynamicFormComponent } from 'ngx-dynamic-entity';",
      html(rendererMd)[0],
      [
        '  formConfig!: EntityFormConfig;',
        '  record: Record<string, unknown> = {};',
        '  onSave(v: Record<string, unknown>): void { console.log(v); }',
      ].join('\n'),
    ),
  );

  write(
    'readme-builder-usage.ts',
    host(
      'ReadmeBuilderUsage',
      'readme-builder-usage',
      'EntityBuilderComponent',
      "import { EntityBuilderComponent } from 'ngx-dynamic-entity-builder';",
      html(builderMd)[0],
      [
        '  initialConfig?: EntityFormConfig;',
        '  onConfigUpdated(c: EntityFormConfig): void { console.log(c); }',
        '  onSave(c: EntityFormConfig): void { console.log(c); }',
      ].join('\n'),
    ),
  );
} else {
  step('Writing a consumer component');
  write(
    'consumer.ts',
    `import { Component } from '@angular/core';
import {
  DynamicFormComponent,
  provideNgxDynamicEntity,
  provideBuiltInFieldTypes,
} from 'ngx-dynamic-entity';
import { EntityBuilderComponent } from 'ngx-dynamic-entity-builder';
import type { EntityFormConfig } from '@dynamic-entity/core';

export const providers = [provideNgxDynamicEntity({}), provideBuiltInFieldTypes()];

@Component({
  selector: 'consumer-root',
  standalone: true,
  imports: [DynamicFormComponent, EntityBuilderComponent],
  template: \`
    <ngx-dynamic-form
      [config]="config"
      [initialData]="record"
      [userRoles]="roles"
      (formSubmit)="onSave($event)"
    />
    <ngx-entity-builder [config]="config" (save)="onSchema($event)" />
  \`,
})
export class ConsumerComponent {
  config!: EntityFormConfig;
  record: Record<string, unknown> = {};
  roles: string[] = ['editor'];
  onSave(value: Record<string, unknown>): void { console.log(value); }
  onSchema(cfg: EntityFormConfig): void { console.log(cfg); }
}
`,
  );
}

fs.writeFileSync(
  path.join(proj, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ES2022',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'dom'],
        experimentalDecorators: true,
        useDefineForClassFields: false,
        strict: true,
        skipLibCheck: true,
        outDir: './out',
      },
      angularCompilerOptions: { strictTemplates: true },
      files,
    },
    null,
    2,
  ),
);

// ─── Compile ────────────────────────────────────────────────────────────────

step(`Compiling ${files.length} file(s) with ngc (strictTemplates)`);
try {
  run('npx', ['ngc', '-p', 'tsconfig.json'], { cwd: proj, stdio: 'inherit' });
} catch {
  console.error(`\nFAIL: consumer compile failed against Angular ${angularMajor}.`);
  console.error(`      Project kept at ${proj}`);
  process.exit(1);
}

console.log(
  `\nPASS: Angular ${resolved} installs the packed tarballs and compiles ` +
    `${useReadme ? 'every README snippet' : 'a consumer component'} under strictTemplates.`,
);

if (!keep) fs.rmSync(work, { recursive: true, force: true });
else console.log(`Kept: ${work}`);
