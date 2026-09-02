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
- **Undo & redo** — `Ctrl`/`Cmd`+`Z` and `Ctrl`/`Cmd`+`Shift`+`Z`, plus toolbar buttons that disable at the ends of the history. Consecutive edits inside 400ms merge when the structure is unchanged, so typing a label is one step while adding two fields is two.
- **All 21 field types** from the `@dynamic-entity/core` catalog.
- **Translatable interface** — every word the builder itself renders resolves through `BUILDER_TEXT`; `uiLanguage` picks the locale.

---

## 🚀 Usage

```html
<ngx-entity-builder
  [config]="initialConfig"
  [languages]="['en', 'de']"
  [uiLanguage]="'en'"
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
| `uiLanguage` | `string` | Locale for the builder's **own** chrome, not the labels being authored. Defaults to `'en'`. |
| `availableRoles` | `string[]` | Roles offered in the permissions editor. |
| `commonModules` | `readonly CommonModuleEntry[]` | Shared-module options for tabs. |

### Outputs

| Output | Payload |
|---|---|
| `configChange` | `EntityFormConfig` — emitted on every edit. |
| `save` | `EntityFormConfig` — emitted when the user saves. |

---

## ↩️ Undo & redo

Wired to the toolbar and to `Ctrl`/`Cmd`+`Z` / `Ctrl`/`Cmd`+`Shift`+`Z`. The shortcut is
ignored while focus is in an input, textarea or contenteditable — those have their own undo
stack, and taking it over would discard a structural edit when the author wanted one
character back.

Driving it yourself, from a host that injects `BuilderStore`:

```ts
store.undo();          // no-op at the start of history
store.redo();          // no-op at the end
store.canUndo();       // signal — bind it to your own button's disabled state
store.canRedo();
```

History records the config and its rules **together**: they are two signals, and undoing one
without the other could leave a rule pointing at a field that no longer exists. Loading a
config or resetting starts history again, so opening an entity is not something you can undo
past.

---

## 🌍 Translating the builder

Every word the builder renders itself — panel headings, tooltips, empty states — resolves
through `BUILDER_TEXT`. The library does no translating; it publishes the keys and resolves
what you hand back, per key, falling back to English for anything you leave out.

```typescript
import { BUILDER_TEXT } from 'ngx-dynamic-entity-builder';

export const builderTextProvider = {
  provide: BUILDER_TEXT,
  useValue: {
    save: { en: 'Save', de: 'Speichern' },
    addField: { en: 'Add field', de: 'Feld hinzufügen' },
  },
};
```

A value may be `LocalizedText`, a flat string, or a resolver
`(key, defaultText, language) => string` for a host that already has ngx-translate, Transloco
or `$localize`. `DEFAULT_BUILDER_TEXT` exports all 149 keys with their English source
strings, so a translation file can be generated from it rather than transcribed.

**`uiLanguage` is not `languages`.** `languages` is the vocabulary a label is _authored_ in,
and `store.activeLanguage()` says which entry the inspector is editing right now. Tying the
chrome to that would flip the whole interface every time an author switched the label
language they were working on. `BuilderTextService` is root-provided, so two builders mounted
at once share one chrome language.

---

## ⚠️ Known limitations

- **Field ids are unique per scope**, not across the whole schema — `address` on Personal Details and `address` on Work Details are two different fields, and records nest by tab so they store separately. The builder still generates and enforces ids that are unique across the config, because its selection model addresses a field by bare id. New `showWhen`, cascade, patch and rule references are chosen from a path list (`[work.address]`). A bare id in an older config is still valid while only one scope defines it; `validateConfig` reports it as ambiguous the moment two do.
- **Structural edits apply to top-level tabs only.** Removing, duplicating, moving, and reordering a field works for fields on a top-level tab; a field inside a sub-tab can be selected and edited but not yet restructured.
- **Not an SSR target.** The builder is a Material visual editor with drag-and-drop. Host it in a browser-only route. The form renderer (`ngx-dynamic-entity`) is the SSR surface.
