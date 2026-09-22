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
 *   node scripts/verify-consumer.mjs --angular 20 --ssr
 *   node scripts/verify-consumer.mjs --angular 20 --ssr --zoneless
 *   node scripts/verify-consumer.mjs --angular 20 --size
 *
 *   --angular <major>  Angular major to install (required).
 *   --readme           Compile the snippets from the README files instead of the built-in
 *                      consumer component, so the documented Quick Start is proven to work.
 *   --ssr              After AOT, `renderApplication` a form on `@angular/platform-server`.
 *                      Proves the renderer produces markup under SSR, not merely compiles.
 *   --zoneless         Angular 20+: `provideZonelessChangeDetection()`, and no `zone.js`.
 *                      Combine with `--ssr` to prove the renderer under zoneless SSR.
 *   --size             Bundle twice — once registering three field types, once registering
 *                      all of them — and assert both a ceiling and the gap between them.
 *                      This is the tree-shaking claim: "an app that uses three field types
 *                      pays for three" rested entirely on a bundler eliding one unused
 *                      exported function, in a module that statically references all 21
 *                      components. Nothing tested it.
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
const ssr = !!arg('ssr');
const zoneless = !!arg('zoneless');
const size = !!arg('size');
const keep = !!arg('keep');

/*
 * Byte budgets, in kilobytes of the optimised browser bundle.
 *
 * The **delta** is the real assertion. An absolute ceiling drifts with every Angular minor
 * and every dependency bump, so both are set generously: they catch a regression of *kind* —
 * a barrel re-export that drags the world in, a `sideEffects: false` lost from a manifest —
 * not one of degree. The gap between the two builds is what actually proves the components
 * are separable, and it cannot be satisfied by accident.
 */
const SIZE_BUDGET = {
  // Measured on Angular 20: 245 kB / 327 kB / 82 kB. The ceilings carry enough headroom for
  // an Angular minor; the floor is set at well under the measured gap so that shrinking a
  // component does not fail the build, while losing the seam entirely does.
  narrowMaxKb: 420,
  wideMaxKb: 520,
  minDeltaKb: 50,
};
if (!angularMajor || angularMajor === true) {
  console.error('error: --angular <major> is required, e.g. --angular 20');
  process.exit(2);
}

if (useReadme && (ssr || zoneless)) {
  console.error('error: --readme cannot be combined with --ssr or --zoneless');
  process.exit(2);
}

if (size && (useReadme || ssr || zoneless)) {
  console.error('error: --size cannot be combined with --readme, --ssr or --zoneless');
  process.exit(2);
}

if (size && Number(angularMajor) < 18) {
  // `@angular/build` is the application builder; before 18 it was
  // `@angular-devkit/build-angular`. The tree-shaking claim does not vary by Angular major,
  // so the gate measures it on one and does not carry a second builder to do it.
  console.error('error: --size requires Angular 18+ (the @angular/build application builder)');
  process.exit(2);
}

if (zoneless && Number(angularMajor) < 20) {
  console.error('error: --zoneless requires Angular 20+ (provideZonelessChangeDetection)');
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
// All three publish their build output: core's manifest is generated by build-manifest.mjs
// so dev metadata never ships, and the Angular packages publish the ng-packagr output.
const sources = {
  core: path.join(ROOT, 'packages/core/dist'),
  renderer: path.join(ROOT, 'packages/ngx-dynamic-entity/dist'),
  builder: path.join(ROOT, 'packages/ngx-dynamic-entity-builder/dist'),
};
/*
 * Keyed by each package's own name and version, not by a filename prefix.
 *
 * `npm pack` writes `<flattened-name>-<version>.tgz`, and `ngx-dynamic-entity` is a prefix
 * of `ngx-dynamic-entity-builder`. This used to tell them apart by matching
 * `ngx-dynamic-entity-1`, borrowing the leading digit of the version — which stopped
 * matching anything the moment the packages went to 2.0.0.
 */
const packed = new Map();
for (const [name, dir] of Object.entries(sources)) {
  run('npm', ['pack', dir], { cwd: tarballs });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
  if (!fs.existsSync(path.join(tarballs, file))) {
    throw new Error(`npm pack did not produce ${file} for ${manifest.name}`);
  }
  packed.set(manifest.name, `file:${path.join(tarballs, file).replace(/\\/g, '/')}`);
  console.log(`  packed ${name} as ${file}`);
}

const tgz = name => {
  const spec = packed.get(name);
  if (!spec) throw new Error(`no tarball packed for ${name}`);
  return spec;
};

// ─── Consumer project ───────────────────────────────────────────────────────

const proj = path.join(work, 'consumer');
fs.mkdirSync(proj);

const ng = `^${angularMajor}.0.0`;
const major = Number(angularMajor);
// Angular 19+ peers zone.js 0.15; 17–18 stay on 0.14. Only the SSR path needs it at runtime.
const zone = major >= 19 ? '^0.15.0' : '~0.14.10';
const dependencies = {
  '@angular/animations': ng,
  '@angular/cdk': ng,
  '@angular/common': ng,
  '@angular/compiler': ng,
  '@angular/core': ng,
  '@angular/forms': ng,
  '@angular/material': ng,
  '@angular/platform-browser': ng,
  rxjs: '^7.8.0',
  '@dynamic-entity/core': tgz('@dynamic-entity/core'),
  'ngx-dynamic-entity': tgz('ngx-dynamic-entity'),
  'ngx-dynamic-entity-builder': tgz('ngx-dynamic-entity-builder'),
};
if (ssr) {
  dependencies['@angular/platform-server'] = ng;
  if (!zoneless) dependencies['zone.js'] = zone;
}

fs.writeFileSync(
  path.join(proj, 'package.json'),
  JSON.stringify(
    {
      name: `consumer-ng${angularMajor}`,
      private: true,
      version: '1.0.0',
      // ESM so the compiled `renderApplication` entry can use top-level await.
      ...(ssr ? { type: 'module' } : {}),
      dependencies,
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

step('Running the published `dynamic-entity validate` bin');
fs.writeFileSync(
  path.join(proj, 'ok-config.json'),
  JSON.stringify({
    entity: 'clients',
    version: 1,
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
      },
    ],
  }),
);
try {
  run('npx', ['dynamic-entity', 'validate', 'ok-config.json'], { cwd: proj, stdio: 'inherit' });
} catch {
  console.error('\nFAIL: the published `dynamic-entity` bin did not validate a sound config.');
  console.error(`      Project kept at ${proj}`);
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
  const extendingMd = read('EXTENDING.md');
  // The server README's Angular-side snippet too. Its Node snippets are fenced ```ts and are
  // compiled by verify-server-consumer.mjs instead, where @dynamic-entity/server is installed
  // — the two fences split the file by which project can actually check it.
  const serverMd = read('packages/server/README.md');
  const allTs = [
    ['root', rootMd],
    ['core', coreMd],
    ['renderer', rendererMd],
    ['builder', builderMd],
    ['extending', extendingMd],
    ['server', serverMd],
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
      "import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';",
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
        '  initialRules?: FormRule[];',
        '  onConfigUpdated(c: EntityFormConfig): void { console.log(c); }',
        '  onRulesUpdated(r: FormRule[]): void { console.log(r); }',
        '  onSave(c: EntityFormConfig): void { console.log(c); }',
      ].join('\n'),
    ),
  );
} else if (ssr) {
  step(
    zoneless
      ? 'Writing an SSR bootstrap (zoneless — no zone.js)'
      : 'Writing an SSR bootstrap (renderer only — the builder is not an SSR target)',
  );
  // `@angular/compiler` is loaded first so platform-server can JIT-compile the
  // partially-compiled Angular packages (ng-packagr output) when we execute
  // under Node rather than through the linker. Angular 20's `renderApplication`
  // passes a BootstrapContext into the factory — omitting it is NG0401.
  const coreImport = zoneless
    ? "import { Component, provideZonelessChangeDetection } from '@angular/core';"
    : "import { Component } from '@angular/core';";
  const zoneImport = zoneless ? '' : "import 'zone.js';\n";
  const ssrProviders = zoneless
    ? '[provideZonelessChangeDetection(), provideServerRendering(), provideNgxDynamicEntity({}), provideBuiltInFieldTypes()]'
    : '[provideServerRendering(), provideNgxDynamicEntity({}), provideBuiltInFieldTypes()]';
  write(
    'ssr-app.ts',
    `import '@angular/compiler';
${zoneImport}${coreImport}
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import {
  DynamicFormComponent,
  provideNgxDynamicEntity,
  provideBuiltInFieldTypes,
} from 'ngx-dynamic-entity';
import type { EntityFormConfig } from '@dynamic-entity/core';

@Component({
  selector: 'ssr-root',
  standalone: true,
  imports: [DynamicFormComponent],
  template: \`
    <ngx-dynamic-form [config]="config" [initialData]="record" [userRoles]="roles" />
  \`,
})
export class SsrRootComponent {
  config: EntityFormConfig = {
    entity: 'client',
    version: 1,
    name: { en: 'Client' },
    tabs: [
      {
        id: 'general',
        label: { en: 'General' },
        visibility: true,
        flatData: true,
        fields: [
          { id: 'textField', type: 'text', label: { en: 'Text' }, visibility: true },
          { id: 'textareaField', type: 'textarea', label: { en: 'Textarea' }, visibility: true },
          { id: 'markdownField', type: 'markdown', label: { en: 'Markdown' }, visibility: true },
          { id: 'numberField', type: 'number', label: { en: 'Number' }, visibility: true },
          { id: 'currencyField', type: 'currency', label: { en: 'Currency' }, currencyCode: 'USD', visibility: true },
          { id: 'emailField', type: 'email', label: { en: 'Email' }, visibility: true },
          { id: 'passwordField', type: 'password', label: { en: 'Password' }, visibility: true },
          { id: 'dateField', type: 'date', label: { en: 'Date' }, visibility: true },
          { id: 'datetimeField', type: 'datetime', label: { en: 'Datetime' }, visibility: true },
          { id: 'timeField', type: 'time', label: { en: 'Time' }, visibility: true },
          { id: 'monthYearField', type: 'monthYear', label: { en: 'MonthYear' }, visibility: true },
          { id: 'dropdownField', type: 'dropdown', label: { en: 'Dropdown' }, options: [{ en: 'Opt 1' }, { en: 'Opt 2' }], visibility: true },
          { id: 'radioField', type: 'radio', label: { en: 'Radio' }, options: [{ en: 'Rad 1' }, { en: 'Rad 2' }], visibility: true },
          { id: 'checkboxField', type: 'checkbox', label: { en: 'Checkbox' }, visibility: true },
          { id: 'booleanField', type: 'boolean', label: { en: 'Boolean' }, visibility: true },
          { id: 'multiSelectField', type: 'multiSelect', label: { en: 'MultiSelect' }, options: [{ en: 'Item 1' }, { en: 'Item 2' }], visibility: true },
          { id: 'entityRefField', type: 'entity-ref', label: { en: 'EntityRef' }, entityName: 'clients', visibility: true },
          {
            id: 'groupField',
            type: 'group',
            label: { en: 'Group' },
            visibility: true,
            fields: [
              { id: 'subText', type: 'text', label: { en: 'Sub Text' }, visibility: true },
            ],
          },
          {
            id: 'arrayField',
            type: 'array',
            label: { en: 'Array' },
            visibility: true,
            fields: [
              { id: 'rowText', type: 'text', label: { en: 'Row Text' }, visibility: true },
            ],
          },
          { id: 'imageField', type: 'image', label: { en: 'Image' }, visibility: true },
          { id: 'fileField', type: 'file', label: { en: 'File' }, visibility: true },
        ],
      },
    ],
  };
  record: Record<string, unknown> = {
    textField: 'Alice',
    textareaField: 'Detailed notes',
    markdownField: '# Markdown Title',
    numberField: 42,
    currencyField: 1250.5,
    emailField: 'alice@example.com',
    passwordField: 'secret123',
    dateField: '2024-06-01',
    datetimeField: '2024-06-01T12:00:00Z',
    timeField: '14:30',
    monthYearField: '2024-06',
    dropdownField: { en: 'Opt 1' },
    radioField: { en: 'Rad 1' },
    checkboxField: true,
    booleanField: true,
    multiSelectField: [{ en: 'Item 1' }],
    entityRefField: 'client-1',
    groupField: { subText: 'Group nested value' },
    arrayField: [{ rowText: 'Array item 1' }],
    imageField: 'https://example.com/avatar.png',
    fileField: 'document.pdf',
  };
  roles: string[] = ['editor'];
}

const html = await renderApplication(
  context =>
    bootstrapApplication(
      SsrRootComponent,
      {
        providers: ${ssrProviders},
      },
      context,
    ),
  {
    document: '<!DOCTYPE html><html><body><ssr-root></ssr-root></body></html>',
    url: '/',
  },
);

const expectedFieldIds = [
  'textField', 'textareaField', 'markdownField', 'numberField', 'currencyField',
  'emailField', 'passwordField', 'dateField', 'datetimeField', 'timeField',
  'monthYearField', 'dropdownField', 'radioField', 'checkboxField', 'booleanField',
  'multiSelectField', 'entityRefField', 'groupField', 'arrayField', 'imageField', 'fileField',
];

for (const fieldId of expectedFieldIds) {
  if (!html.includes('data-testid="field-' + fieldId + '"')) {
    throw new Error('SSR HTML missing expected field markup for ' + fieldId + '\\n' + html.slice(0, 4000));
  }
}

console.log('PASS: renderApplication produced markup containing all 21 field types${zoneless ? ' (zoneless)' : ''}.');
`,
  );
} else if (size) {
  step('Writing two apps: one registering three field types, one registering all of them');

  /*
   * Both bootstrap a real application, because that is what makes the question meaningful:
   * a bundler only drops a component when nothing reachable from the entry point mentions
   * it, and `provideBuiltInFieldTypes()` mentions all 21 in one statically-analysable map.
   * Everything else about the two files is identical, so the difference in output is the
   * field components and nothing else.
   */
  const app = (name, importLine, providerCall) =>
    `import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  DynamicFormComponent,
  provideNgxDynamicEntity,
${importLine}
} from 'ngx-dynamic-entity';
import type { EntityFormConfig } from '@dynamic-entity/core';

@Component({
  selector: 'size-root',
  standalone: true,
  imports: [DynamicFormComponent],
  template: '<ngx-dynamic-form [config]="config" />',
})
export class ${name} {
  config: EntityFormConfig = {
    entity: 'client',
    version: 1,
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        flatData: true,
        fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
      },
    ],
  };
}

void bootstrapApplication(${name}, {
  providers: [provideNgxDynamicEntity({}), ${providerCall}],
});
`;

  write(
    'app-narrow.ts',
    app(
      'SizeNarrowComponent',
      `  provideFieldTypes,
  TextFieldComponent,
  NumberFieldComponent,
  DropdownFieldComponent,`,
      'provideFieldTypes({ text: TextFieldComponent, number: NumberFieldComponent, dropdown: DropdownFieldComponent })',
    ),
  );
  write(
    'app-wide.ts',
    app('SizeWideComponent', '  provideBuiltInFieldTypes,', 'provideBuiltInFieldTypes()'),
  );
} else {
  step('Writing a consumer component');
  const zonelessImport = zoneless
    ? "import { Component, provideZonelessChangeDetection } from '@angular/core';\n"
    : "import { Component } from '@angular/core';\n";
  const providerList = zoneless
    ? '[provideZonelessChangeDetection(), provideNgxDynamicEntity({}), provideBuiltInFieldTypes()]'
    : '[provideNgxDynamicEntity({}), provideBuiltInFieldTypes()]';
  write(
    'consumer.ts',
    `${zonelessImport}import {
  DynamicFormComponent,
  provideNgxDynamicEntity,
  provideBuiltInFieldTypes,
} from 'ngx-dynamic-entity';
import { EntityBuilderComponent } from 'ngx-dynamic-entity-builder';
import type { EntityFormConfig } from '@dynamic-entity/core';

export const providers = ${providerList};

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
    `${useReadme ? 'every README snippet' : ssr ? 'an SSR bootstrap' : 'a consumer component'} under strictTemplates.`,
);

if (size) {
  step('Building each app with the Angular application builder');

  /*
   * A real `ng build`, not a bare bundler pass.
   *
   * esbuild over `node_modules` measures nothing here: ng-packagr publishes
   * partial-compiled output (`ɵɵngDeclareComponent`), and it is the Angular **linker** —
   * which only the application builder runs — that turns those declarations into the
   * pure-annotated definitions a bundler can drop. Bundling the FESM directly produced two
   * builds 0.2 kB apart, not because the components are inseparable but because nothing had
   * made them separable yet. A gate that cannot fail for the right reason is worse than none.
   */
  run('npm', ['install', '--no-save', '--no-audit', '--no-fund', `@angular/build@${ng}`, `@angular/cli@${ng}`], {
    cwd: proj,
    stdio: 'inherit',
  });

  const target = entry => ({
    projectType: 'application',
    root: '',
    sourceRoot: '',
    architect: {
      build: {
        builder: '@angular/build:application',
        options: {
          browser: `app-${entry}.ts`,
          tsConfig: 'tsconfig.json',
          outputPath: `dist-${entry}`,
          // Optimised, because an unoptimised build keeps every export alive and would
          // report the two apps as identical whatever the truth is.
          optimization: true,
          sourceMap: false,
          extractLicenses: false,
          index: false,
          polyfills: [],
        },
      },
    },
  });

  fs.writeFileSync(
    path.join(proj, 'angular.json'),
    JSON.stringify(
      { version: 1, projects: { narrow: target('narrow'), wide: target('wide') } },
      null,
      2,
    ),
  );

  const buildKb = entry => {
    run('npx', ['ng', 'build', entry], { cwd: proj, stdio: 'inherit' });
    const dir = path.join(proj, `dist-${entry}`, 'browser');
    // Every chunk, not just the entry: lazy chunks are still bytes the app ships.
    return fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.js'))
      .reduce((total, f) => total + fs.statSync(path.join(dir, f)).size, 0) / 1024;
  };

  const narrowKb = buildKb('narrow');
  const wideKb = buildKb('wide');
  const deltaKb = wideKb - narrowKb;

  const kb = n => `${n.toFixed(1)} kB`;
  console.log(`\n  three field types : ${kb(narrowKb)}`);
  console.log(`  all field types   : ${kb(wideKb)}`);
  console.log(`  difference        : ${kb(deltaKb)}`);

  const failures = [];
  if (narrowKb > SIZE_BUDGET.narrowMaxKb) {
    failures.push(
      `the three-type app is ${kb(narrowKb)}, over its ${SIZE_BUDGET.narrowMaxKb} kB ceiling`,
    );
  }
  if (wideKb > SIZE_BUDGET.wideMaxKb) {
    failures.push(`the all-types app is ${kb(wideKb)}, over its ${SIZE_BUDGET.wideMaxKb} kB ceiling`);
  }
  if (deltaKb < SIZE_BUDGET.minDeltaKb) {
    failures.push(
      `registering all field types costs only ${kb(deltaKb)} more than registering three ` +
        `(expected at least ${SIZE_BUDGET.minDeltaKb} kB). Either the narrow app is dragging ` +
        `in components it never registered — check for a barrel re-export or a lost ` +
        `"sideEffects": false — or the components have shrunk below the floor, in which case ` +
        `lower it deliberately.`,
    );
  }

  if (failures.length) {
    console.error('\nFAIL: the tree-shaking budget was not met.');
    for (const f of failures) console.error(`      - ${f}`);
    console.error(`      Project kept at ${proj}`);
    process.exit(1);
  }

  console.log(
    `\nPASS: registering three field types costs ${kb(deltaKb)} less than registering all of ` +
      `them, so an app really does pay only for the types it uses.`,
  );
}

if (ssr) {
  step('Rendering the form with renderApplication');
  try {
    run('node', ['out/ssr-app.js'], { cwd: proj, stdio: 'inherit' });
  } catch {
    console.error(`\nFAIL: renderApplication threw or produced markup without the field.`);
    console.error(`      Project kept at ${proj}`);
    process.exit(1);
  }
}

if (!keep) fs.rmSync(work, { recursive: true, force: true });
else console.log(`Kept: ${work}`);
