# Dynamic Entity Ecosystem 🚀

> Declarative form engine & visual schema builder for Angular 17–22

[![npm core](https://img.shields.io/npm/v/@dynamic-entity/core.svg?label=@dynamic-entity/core&color=blue)](https://www.npmjs.com/package/@dynamic-entity/core)
[![npm renderer](https://img.shields.io/npm/v/ngx-dynamic-entity.svg?label=ngx-dynamic-entity&color=red)](https://www.npmjs.com/package/ngx-dynamic-entity)
[![npm builder](https://img.shields.io/npm/v/ngx-dynamic-entity-builder.svg?label=ngx-dynamic-entity-builder&color=purple)](https://www.npmjs.com/package/ngx-dynamic-entity-builder)
[![Angular](https://img.shields.io/badge/angular-17%20%7C%2018%20%7C%2019%20%7C%2020%20%7C%2021%20%7C%2022-red.svg)](https://angular.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Dynamic Entity** renders tabbed, deeply nested forms from a declarative `EntityFormConfig` schema, evaluates reactive rules as values change, applies role-based field visibility and masking, and ships a visual editor for authoring those schemas.

---

## 📦 Published Packages

| Package | Version | Description |
|---|---|---|
| [`@dynamic-entity/core`](./packages/core) | [![npm](https://img.shields.io/npm/v/@dynamic-entity/core.svg)](https://www.npmjs.com/package/@dynamic-entity/core) | Framework-agnostic schema models, pure form logic, and the rules evaluator. No Angular, no RxJS. |
| [`ngx-dynamic-entity`](./packages/ngx-dynamic-entity) | [![npm](https://img.shields.io/npm/v/ngx-dynamic-entity.svg)](https://www.npmjs.com/package/ngx-dynamic-entity) | Angular standalone form renderer and tabbed record editor. |
| [`ngx-dynamic-entity-builder`](./packages/ngx-dynamic-entity-builder) | [![npm](https://img.shields.io/npm/v/ngx-dynamic-entity-builder.svg)](https://www.npmjs.com/package/ngx-dynamic-entity-builder) | Standalone visual builder for authoring `EntityFormConfig` schemas. |
| `demo-angular` | — | Showcase application with the Playwright E2E suite. Not published. |

All three share a version and are released together.

---

## ✨ Features

- **20 field types** — `text`, `textarea`, `number`, `currency`, `email`, `password`, `date`, `datetime`, `time`, `monthYear`, `dropdown`, `radio`, `checkbox`, `boolean`, `multiSelect`, `entity-ref`, `group`, `array`, `image`, `file`. Every type is a standalone component you can register individually, or swap for your own.
- **Reactive rules engine** — three action types (`visibility` to show/hide a field or tab, `validation` to attach an error or warning, `info` to raise a banner) driven by 18 condition operators including `EQUAL`, `CONTAINS`, `IN`, `DATE_BEFORE`, `HAS_ITEMS` and `VALUE_CHANGED`. Conditions within a rule are ANDed; rules apply in `priority` order.
- **Role-based field visibility & masking** — per-entity `view`/`edit`/`delete` role lists, plus `maskData` to render a field as `XXXXXXXXX` for configured roles. **This is presentational only — see [Security](#-security).**
- **Cross-entity referenced fields** — link a field to a source entity, snapshot what was copied, and detect drift when the source changes. Drift is surfaced in the builder.
- **Sync and async validation** — built-in validators, your own by name, and async checks against a server. A form cannot be submitted while an async check is pending, and a `beforeSave` hook can abort the save outright.
- **Named lookup lists** — sync or async master lists resolved by name, with localized labels, fallbacks, and an integrity report for values that no longer match any option.
- **Visual builder** — click-to-add palette, drag-and-drop reordering, and a recursive tree editor for tabs, sub-tabs, groups, and arrays.
- **100% standalone** — every component is `standalone: true`; the packages contain no `NgModule`. Signals are used for internal state; component inputs and outputs are decorator-based.

---

## 🚀 Quick Start

### 1. Installation

```bash
npm install @dynamic-entity/core ngx-dynamic-entity
```

Add the builder only if you need the visual schema editor:

```bash
npm install ngx-dynamic-entity-builder
```

### 2. Register the providers

Field types are **not** registered automatically — this is what keeps unused ones out of your bundle. Without this step the form renders no fields.

```typescript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideNgxDynamicEntity, provideBuiltInFieldTypes } from 'ngx-dynamic-entity';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgxDynamicEntity({}),
    provideBuiltInFieldTypes(), // or provideFieldTypes({ text: TextFieldComponent, ... })
  ],
};
```

### 3. Render a form

```typescript
import { Component } from '@angular/core';
import { DynamicFormComponent } from 'ngx-dynamic-entity';
import type { EntityFormConfig } from '@dynamic-entity/core';

@Component({
  selector: 'app-record-editor',
  standalone: true,
  imports: [DynamicFormComponent],
  template: `
    <ngx-dynamic-form
      [config]="config"
      [initialData]="record"
      [userRoles]="roles"
      (formSubmit)="onSave($event)"
    />
  `,
})
export class RecordEditorComponent {
  config: EntityFormConfig = {
    entity: 'client',
    version: 1,
    name: { en: 'Client Profile' },
    tabs: [
      {
        id: 'general',
        label: { en: 'General' },
        visibility: true,
        flatData: true, // store this tab's fields at the record root — see "Record shape"
        fields: [
          { id: 'firstName', type: 'text', label: { en: 'First Name' }, visibility: true, validators: { required: true } },
          { id: 'lastName', type: 'text', label: { en: 'Last Name' }, visibility: true, validators: { required: true } },
          { id: 'email', type: 'email', label: { en: 'Email' }, visibility: true, validators: { required: true } },
        ],
      },
    ],
  };

  record: Record<string, unknown> = { firstName: 'Alice', lastName: 'Smith' };
  roles: string[] = ['editor'];

  onSave(value: Record<string, unknown>): void {
    console.log('Saved record:', value);
  }
}
```

---

## 🗂 Record shape

**This is the most common source of confusion — read it before wiring up `initialData`.**

By default a record is **nested by tab id**:

```typescript
const record = { general: { firstName: 'Alice' }, billing: { vatNumber: 'GB123' } };
```

Set `flatData: true` on a tab to store that tab's fields at the record root instead:

```typescript
const record = { firstName: 'Alice', lastName: 'Smith' };
```

The same shape applies in **both directions**: `initialData` is read with it, and `(formSubmit)` emits with it. Passing a flat record to a tab that is not marked `flatData` leaves those fields empty — the values are simply not found where the form looks for them.

---

## ✅ Validating a config

A config is data — authored in the builder, stored, fetched from an API — so TypeScript cannot
police it. Check one before anything renders it:

```typescript
import { validateConfig, formatConfigProblems, type EntityFormConfig } from '@dynamic-entity/core';

declare const config: EntityFormConfig;

const problems = validateConfig(config);
if (problems.some(p => p.level === 'error')) {
  throw new Error(`Invalid config:
${formatConfigProblems(problems)}`);
}
```

It reports every problem rather than stopping at the first, and catches what a type cannot:
a field type absent from the catalog, two fields sharing an id **in the same scope**, a
`showWhen` naming a field that does not exist, a cascade whose `parentField` is missing,
and — when you pass them — a rule whose trigger, comparison field or field target cannot
resolve. Bracketed paths (`[work.address]`) name one field; a bare id is still accepted
while only one scope defines it.

Field ids are unique per scope, not globally — a record nests by tab, so `address` on
Personal Details and `address` on Work Details are two different fields and store as
`{ personal: { address }, work: { address } }`. A scope is whatever the record nests under:
each tab, each `group` field, and the parent's level for a `flatData` tab. What you cannot
duplicate is an id something *points at* by bare name: `showWhen`, cascade `parentField`
and (when supplied) rules name a field by id with no scope, so an id defined in two scopes
is reported as ambiguous the moment a reference uses it. Name it by path instead. `warning`
means usable but suspicious; `error` means it will not render correctly.

Pass `additionalFieldTypes` for any type you registered yourself.

The same check is a command, so a consumer CI job can fail a bad config before it is stored:

```bash
npx dynamic-entity validate ./form-config.json
```

`--additional-field-types signature,rating` matches `additionalFieldTypes`. `--rules rules.json`
passes a `FormRule[]` so CI can gate rule references the same way. `--fail-on-warnings`
treats a warning as a failure. Exit `0` means no errors, `1` means the config is unusable,
`2` means the file or the JSON itself is.

For editor completion, a JSON Schema ships too:

```json
{ "$schema": "./node_modules/@dynamic-entity/core/entity-form-config.schema.json", "entity": "clients", "tabs": [] }
```

---

## 🔄 Schema versioning

`EntityFormConfig.version` and a record's `_configVersion` describe which shape a record was
saved under. When you change a schema, raise `version` and register the steps that move old
records forward:

```typescript
import { provideNgxDynamicEntity } from 'ngx-dynamic-entity';
import type { RecordMigration } from '@dynamic-entity/core';

const migrations: RecordMigration[] = [
  {
    from: 1,
    to: 2,
    description: 'split name into firstName/lastName',
    migrate: record => {
      const [firstName = '', ...rest] = String(record['name'] ?? '').split(' ');
      const { name, ...others } = record;
      return { ...others, firstName, lastName: rest.join(' ') };
    },
  },
];

provideNgxDynamicEntity({ migrations });
```

Migrations run where a record enters the form, so nothing has to remember to call them. Steps
chain strictly (`1 → 2 → 3`); a gap **throws** rather than applying a partial upgrade, because
a half-migrated record matches neither schema.

Two behaviours worth knowing:

- **A record with no `_configVersion` is left alone.** Its version is genuinely unknown, and
  guessing wrong in either direction corrupts data. Pass `assumeVersion` to `migrateRecord`
  when you know what those records are.
- **A record newer than the config is never migrated downward.** That means a rolled-back
  deployment; downgrading would discard fields no step describes.

`migrateRecord`, `needsMigration`, `stampRecord` and `validateMigrations` are exported from
`@dynamic-entity/core` and are pure, so the same migration set runs on a server before
persisting.

---

## 🔐 Security

`EntityPermissions` (`view` / `edit` / `delete` role lists) and `maskData` control **what the browser renders**. They are a UI convenience, not an access-control boundary:

- A masked value is replaced with `XXXXXXXXX` in the template, but the real value remains in the form control and is included in the `(formSubmit)` payload.
- Any role check performed here runs on the client and can be bypassed.

**Authorize on the server.** Never send a user data they are not permitted to see, and re-check every permission when the submitted record reaches your API.

---

## 🎨 Styling

The renderer ships **no stylesheet**. Field components emit stable BEM-style hooks — `ngx-field`, `ngx-field__label`, `ngx-field__input`, `ngx-field__error` — and it is up to you to style them. This is deliberate: the library has no Angular Material dependency and imposes no design system, so it drops into a Tailwind, CSS-modules, or hand-rolled setup without conflict.

`packages/demo-angular/src/styles.css` is a working reference implementation.

> The **builder** does depend on Angular Material and requires `provideAnimations()`.

---

## 🖥 Server-side rendering

The renderer is intended to work under Angular SSR. Templates use Angular APIs
(`afterNextRender`, `ElementRef`, `@HostListener`) rather than the global `document` or
`window`, so a server render does not throw. CI runs `renderApplication` against the
published tarballs on Angular 20.

The builder is a Material visual editor with drag-and-drop. It is not an SSR target; host
it in a browser-only route.

The renderer does not use `NgZone`. It is intended to work under
`provideZonelessChangeDetection()` (Angular 20+). The demo app still loads `zone.js`
because it is an Angular Material application. CI `renderApplication`s a form
zonelessly on Angular 20.

---

## 🧪 Testing

```bash
npm test          # unit tests across all workspace packages
npm run build     # build every package
npm run lint      # type-check every package

# Playwright E2E (from the demo app)
cd packages/demo-angular && npx playwright test
```

---

## 🧩 Extending

Custom field types, validators, validation messages and i18n, upload handlers, entity-ref
loaders, lookup lists, and the programmatic form API: see [EXTENDING.md](EXTENDING.md).

Start with [how a field is addressed](EXTENDING.md#how-a-field-is-addressed). Field ids are
unique **per scope**, not per config — `personal.address` and `work.address` are two
different fields — and `showWhen`, cascades, `autoPatch`, rules and the submitted record all
name fields by that model.

---

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md). The three packages share a version and are released
together.

---

## 📄 License

[MIT](LICENSE) © Nizamudeen
