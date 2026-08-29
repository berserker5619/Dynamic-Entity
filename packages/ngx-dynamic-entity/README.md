# ngx-dynamic-entity

[![npm version](https://img.shields.io/npm/v/ngx-dynamic-entity.svg?color=red)](https://www.npmjs.com/package/ngx-dynamic-entity)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Angular dynamic form renderer and tabbed record editor, powered by `@dynamic-entity/core`. Supports Angular 17 through 22.

> This package renders **forms**. It ships no data table — rendering a table over your records is the consumer's choice.

---

## 📦 Installation

```bash
npm install ngx-dynamic-entity @dynamic-entity/core
```

No Angular Material required. This package has no dependency on Material or the CDK.

---

## ✨ Features

- **`DynamicFormComponent`** — tabbed dynamic forms generated from an `EntityFormConfig`, built on Angular Reactive Forms.
- **`DynamicRecordFormComponent`** — record editor with summary drawer (`showOnMinimize`), profile header, and per-section saving.
- **Reactive rules** — real-time condition evaluation driving field/tab visibility, validation errors and warnings, and info banners.
- **Entity references & cascades** — consumer-registered loaders, parent→child dropdown filtering, and `autoPatch` record copying.
- **20 field types** — each a standalone component, registered explicitly so unused types are never bundled.

---

## 🚀 Setup & Registration

Field types are **not** registered automatically. Without this step the form renders no fields.

```typescript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideNgxDynamicEntity, provideBuiltInFieldTypes } from 'ngx-dynamic-entity';

export const appConfig: ApplicationConfig = {
  providers: [
    provideNgxDynamicEntity({
      maskedRoles: ['IT_SUPPORT'],
      entityRefs: {
        countries: () => fetch('/api/countries').then(res => res.json()),
      },
    }),
    provideBuiltInFieldTypes(),
  ],
};
```

To bundle only the types you use, register them individually instead:

```typescript
import { provideFieldTypes, TextFieldComponent, DropdownFieldComponent } from 'ngx-dynamic-entity';

provideFieldTypes({ text: TextFieldComponent, dropdown: DropdownFieldComponent });
```

Multiple `provideFieldTypes` calls merge; on a key collision the later registration wins. Pass your own component for a key to override a built-in, or add a key of your own for a custom type.

---

## 💡 Usage

```html
<ngx-dynamic-form
  [config]="formConfig"
  [initialData]="record"
  [userRoles]="['editor']"
  [language]="'en'"
  (formSubmit)="onSave($event)"
/>
```

### Inputs

| Input | Type | Notes |
|---|---|---|
| `config` | `EntityFormConfig` | Required. |
| `initialData` | `Record<string, any>` | See **Record shape** below. |
| `userRoles` | `string[]` | Drives permission and masking checks. Defaults to `[]`. |
| `language` | `string` | Defaults to `'en'`. |
| `rules` | `FormRule[]` | Optional reactive rules. |
| `originalData` | `Record<string, any>` | Baseline for the `VALUE_CHANGED` operator. |
| `readonly` | `boolean` | Renders the whole form read-only. |
| `readOnlyFields` | `string[]` | Read-only by field id. |
| `loading` / `error` | `boolean` / `string \| null` | Render loading and error states. |

### Outputs

| Output | Payload |
|---|---|
| `formSubmit` | `Record<string, any>` |
| `formChange` | `Record<string, any>` |
| `formReset` | `void` |
| `activeTabChange` | `string` (tab id) |

---

## 🗂 Record shape

A record is **nested by tab id** by default:

```typescript
const record = { general: { firstName: 'Alice' }, billing: { vatNumber: 'GB123' } };
```

Set `flatData: true` on a tab to store that tab's fields at the record root:

```typescript
const record = { firstName: 'Alice', lastName: 'Smith' };
```

This applies in both directions — `initialData` is read with it and `formSubmit` emits with it. **Passing a flat record to a tab that is not marked `flatData` leaves those fields empty**, with no error.

---

## 🔐 Security

`userRoles`, `EntityPermissions`, and `maskData` affect **rendering only**. A masked field displays `XXXXXXXXX` while the real value stays in the form control and is included in the `formSubmit` payload. Enforce authorization on the server and never send a user data they may not see.

---

## Server-side rendering

This package is intended to work under Angular SSR. There is no raw `document` or `window`
access; `jumpToField` schedules with `afterNextRender`, which does not run on the server.
CI calls `renderApplication` on the published tarball.

This package does not use `NgZone`. It is intended to work under
`provideZonelessChangeDetection()` on Angular 20+. CI `renderApplication`s a form that
way, with no `zone.js` installed.

The visual builder is a separate package and is not an SSR target.

---

## 🎨 Styling

This package ships no CSS. Field components emit `ngx-field`, `ngx-field__label`, `ngx-field__input`, and `ngx-field__error` for you to style. See `packages/demo-angular/src/styles.css` in the repository for a working reference.
