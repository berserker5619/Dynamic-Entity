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
- **21 field types** — each a standalone component, registered explicitly so unused types are never bundled.
- **Fully translatable** — config text is `LocalizedText`; the library's own buttons and empty states resolve through `uiText`.
- **Configurable masking and dates** — `MASKED_PLACEHOLDER` replaces the `XXXXXXXXX` literal; `setDateFormatters` in `@dynamic-entity/core` replaces the browser-locale date punctuation.

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

Some field types take an optional collaborator. A `markdown` field renders its source as
text until you register a renderer — see
[Markdown](../../EXTENDING.md#markdown) for `MARKDOWN_RENDERER`, which is any function from
source to HTML.

---

## 🌍 Translating the library's own text

Labels, placeholders and options come from your config as `LocalizedText` and already follow
the `language` input. The chrome around them — Save, Reset, "No rows yet." — is the
library's, and resolves through `uiText`:

```typescript
import { provideNgxDynamicEntity } from 'ngx-dynamic-entity';

export const providers = provideNgxDynamicEntity({
  uiText: {
    save: { en: 'Save', de: 'Speichern' },
    reset: { en: 'Reset', de: 'Zurücksetzen' },
  },
});
```

Values may be `LocalizedText`, a flat string, or — for an app that already has ngx-translate,
Transloco or `$localize` — a resolver `(key, defaultText, language) => string` provided
through `UI_TEXT`. Resolution is per key: anything you leave out keeps its English default.
`DEFAULT_UI_TEXT` exports every key with its English source string, so a translation file can
be generated from it. See [i18n](../../EXTENDING.md#validation-messages-and-i18n).

---

## 🎭 Masked placeholder and dates

A masked field shows `XXXXXXXXX` unless you replace it. The real value stays in the control
either way — see [Security](#-security).

```typescript
import { ApplicationConfig } from '@angular/core';
import { MASKED_PLACEHOLDER, provideNgxDynamicEntity } from 'ngx-dynamic-entity';

export const maskedPlaceholderConfig: ApplicationConfig = {
  providers: [
    provideNgxDynamicEntity({}),
    { provide: MASKED_PLACEHOLDER, useValue: '••••••••' },
  ],
};
```

`date` / `datetime` / `time` still format in the browser's locale. To use the form's
`language`, or a fixed format, call `setDateFormatters` from `@dynamic-entity/core`:

```typescript
import { setDateFormatters } from '@dynamic-entity/core';

setDateFormatters({
  date: (value, lang) => value.toLocaleDateString(lang ?? []),
});
```

A partial object overrides one kind; `setDateFormatters()` restores the defaults.

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

## 📄 Three ways to present a record

`DynamicFormComponent` is the editable form. `DynamicRecordFormComponent` renders the same
config as a record, and two of its inputs decide how much a reader may do:

| Presentation | Component | Inputs |
|---|---|---|
| **Form** | `ngx-dynamic-form` | editable controls plus the actions block |
| **Record view** | `ngx-dynamic-record-form` | `viewMode` (default `true`) — values, with a per-tab "Edit section" flow |
| **Data only** | `ngx-dynamic-record-form` | `isReadOnly="true"` — values, and no way to edit them |

```html
<!-- Read-only for everyone, whatever their roles allow. -->
<ngx-dynamic-record-form
  [config]="config"
  [initialData]="record"
  [userRoles]="roles"
  [isReadOnly]="true"
></ngx-dynamic-record-form>
```

`viewMode="false"` gives a directly editable record with no view/edit distinction, for hosts
that do not want the section flow.

### Record-form inputs

| Input | Type | Notes |
|---|---|---|
| `config` / `initialData` / `userRoles` / `language` | — | As the form component. |
| `viewMode` | `boolean` | Default `true`. Read-only with a per-tab edit flow. |
| `isReadOnly` | `boolean` | Whole record read-only, with no edit affordance at all. |
| `readOnlyFields` | `string[]` | Specific ids read-only while the rest stays editable. |
| `rules` | `FormRule[]` | Optional reactive rules. |

| Output | Payload |
|---|---|
| `formSubmit` / `formChange` / `formReset` | As the form component. |
| `sectionSave` | `{ tabId, record }` — one tab was saved. |

**RBAC applies on top of all three.** Roles outside `permissions.edit` get a read-only
record whichever presentation you choose — see [Security](#-security), because that is a
rendering decision, not an access-control boundary.

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

`userRoles`, `EntityPermissions`, and `maskData` affect **rendering only**. A masked field displays `XXXXXXXXX` by default (`MASKED_PLACEHOLDER` overrides the text) while the real value stays in the form control and is included in the `formSubmit` payload. Enforce authorization on the server and never send a user data they may not see.

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
