# ngx-dynamic-entity-builder

[![npm version](https://img.shields.io/npm/v/ngx-dynamic-entity-builder.svg?color=purple)](https://www.npmjs.com/package/ngx-dynamic-entity-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Visual Angular builder for authoring `EntityFormConfig` schemas consumed by `ngx-dynamic-entity`. Supports Angular 17 through 22.

---

## 📦 Installation

```bash
npm install ngx-dynamic-entity-builder ngx-dynamic-entity @dynamic-entity/core
```

Unlike the renderer, **the builder requires Angular Material and the CDK**, and needs animations enabled:

```typescript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';

export const appConfig: ApplicationConfig = {
  providers: [provideAnimations()],
};
```

---

## ✨ Features

- **Palette & canvas** — click a field type in the palette to add it; drag to reorder within the canvas and tree.
- **Property inspector** — configure validators, options, display flags, `criticalField`, `maskData`, `autoPatch`, and `patchOnTrue`.
- **Entity reference designer** — registry key mapping, display fields, static filters, and parent→child cascades (`parentField` + `lookupFilter`).
- **Rules manager** — create, reorder, edit, and toggle reactive rules (`RuleFormComponent`, `FieldRulesListComponent`).
- **Tab & tree manager** — organize primary tabs, sub-tabs, nested groups, and array field lists. Nesting is recursive; no depth limit is enforced.
- **Live preview slot** — a projected content slot, so the builder renders a preview without depending on the renderer package.
- **All 20 field types** from the `@dynamic-entity/core` catalog.

---

## 🚀 Usage

```html
<ngx-entity-builder
  [config]="initialConfig"
  [languages]="['en', 'de']"
  [availableRoles]="['admin', 'editor']"
  (configChange)="onConfigUpdated($event)"
  (save)="onSave($event)"
/>
```

### Inputs

| Input | Type | Notes |
|---|---|---|
| `config` | `EntityFormConfig \| undefined` | Omit to start from an empty schema. |
| `languages` | `string[]` | Locales offered for localized labels. Defaults to `['en']`. |
| `availableRoles` | `string[]` | Roles offered in the permissions editor. |
| `commonModules` | `readonly CommonModuleEntry[]` | Shared-module options for tabs. |

### Outputs

| Output | Payload |
|---|---|
| `configChange` | `EntityFormConfig` — emitted on every edit. |
| `save` | `EntityFormConfig` — emitted when the user saves. |

---

## ⚠️ Known limitations

- **Field ids are unique per scope**, not across the whole schema — `address` on Personal Details and `address` on Work Details are two different fields, and records nest by tab so they store separately. The builder still generates and enforces ids that are unique across the config, because its selection model addresses a field by bare id. New `showWhen`, cascade, patch and rule references are chosen from a path list (`[work.address]`). A bare id in an older config is still valid while only one scope defines it; `validateConfig` reports it as ambiguous the moment two do.
- **Structural edits apply to top-level tabs only.** Removing, duplicating, moving, and reordering a field works for fields on a top-level tab; a field inside a sub-tab can be selected and edited but not yet restructured.
- **Not an SSR target.** The builder is a Material visual editor with drag-and-drop. Host it in a browser-only route. The form renderer (`ngx-dynamic-entity`) is the SSR surface.
