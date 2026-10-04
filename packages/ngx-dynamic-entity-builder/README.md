# ngx-dynamic-entity-builder

[![npm version](https://img.shields.io/npm/v/ngx-dynamic-entity-builder.svg?color=purple)](https://www.npmjs.com/package/ngx-dynamic-entity-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Visual Angular builder for authoring `EntityFormConfig` schemas consumed by `ngx-dynamic-entity`. Supports Angular **17.2** through 22. It needs 17.2 rather than 17.0 because the panel bindings use `model()`; the renderer and core still support 17.0.

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

- **Palette & canvas** — click a field type in the palette to add it; drag to reorder within the canvas and tree. The palette is grouped by kind and filterable by label, type or description.
- **Property inspector** — configure validators, options, display flags, `hint`, `criticalField`, `maskData`, `autoPatch`, and `patchOnTrue`. A **Width** control sets `colSpan`, and a **Tab** picker moves a field to another tab. Every section opens expanded and collapses on click.
- **Regex pattern playground** — beside `validators.pattern`, type sample input and see *matches*, *does not match*, or *invalid regex syntax* live. Presets are provided for the common shapes (letters, alphanumeric, digits, postal code, phone, slug).
- **Stable option keys** — each new option gets a `$key` minted from its label, shown read-only in the inspector and never rewritten on rename. **Assign stable keys** backfills an existing schema. See [Option identity](../../README.md#-option-identity).
- **Entity reference designer** — registry key mapping, display fields, static filters, and parent→child cascades (`parentField` + `lookupFilter`).
- **Referenced-field drift** — a field linked to another entity's field shows when its source has changed since it was copied, with **Sync with Source**.
- **Rules manager** — create, reorder, edit, and toggle reactive rules (`RuleFormComponent`, `FieldRulesListComponent`). Fields are chosen from a path list (`[work.address]`), never typed, and renaming a field repoints every rule that named it.
- **Rule & dependency graph** — `ngx-rule-dependency-graph`, opened from the toolbar, maps every rule's trigger, conditions and targets across tabs; clicking a node selects that field in the canvas and inspector. The inspector's **Dependencies** section lists what a field depends on and what it affects.
- **Tab & tree manager** — organize primary tabs, sub-tabs, nested groups, and array field lists. Nesting is recursive; no depth limit is enforced. Fields on sub-tabs can be removed, duplicated, moved and reordered like any other.
- **Issue list** — every `validateConfig` problem in the schema, listed and linked to the field it concerns. The builder will not emit `save` for a config `validateConfig` rejects.
- **Collapsible layout** — the palette column, the inspector, the Fields canvas and the Live Preview each collapse independently, and the toolbar stays sticky so its toggles are always in reach. All four are two-way bindable (see below).
- **Live preview slot** — a projected content slot, so the builder renders a preview without depending on the renderer package.
- **Undo & redo** — `Ctrl`/`Cmd`+`Z` and `Ctrl`/`Cmd`+`Shift`+`Z`, plus toolbar buttons that disable at the ends of the history. Consecutive edits inside 400ms merge when the structure is unchanged, so typing a label is one step while adding two fields is two.
- **All 27 field types** from the `@dynamic-entity/core` catalog.
- **Translatable interface** — every word the builder itself renders resolves through `BUILDER_TEXT`; `uiLanguage` picks the locale. Date punctuation in a live preview follows `setDateFormatters` from `@dynamic-entity/core`; the masked placeholder is a renderer token (`MASKED_PLACEHOLDER`), not a builder one.

---

## 🚀 Usage

```html
<ngx-entity-builder
  [config]="initialConfig"
  [rules]="initialRules"
  [languages]="['en', 'de']"
  [uiLanguage]="'en'"
  [availableRoles]="['admin', 'editor']"
  (configChange)="onConfigUpdated($event)"
  (rulesChange)="onRulesUpdated($event)"
  (save)="onSave($event)"
/>
```

### Inputs

| Input | Type | Notes |
|---|---|---|
| `config` | `EntityFormConfig \| undefined` | Omit to start from an empty schema. |
| `rules` | `FormRule[] \| undefined` | The rules that belong with `config`. They arrive together as one snapshot, so opening a builder is not itself an undoable step. Omit and it opens with none. |
| `languages` | `string[]` | Locales offered for localized labels. Defaults to `['en']`. |
| `uiLanguage` | `string` | Locale for the builder's **own** chrome, not the labels being authored. Defaults to `'en'`. |
| `availableRoles` | `string[]` | Roles offered in the permissions editor. |
| `userRoles` | `string[]` | Roles of the person using the builder, passed to the `SYSTEM_DEFAULT_CAN_EDIT` predicate to decide whether they may edit system-default tabs. Distinct from `availableRoles`. |
| `commonModules` | `readonly CommonModuleEntry[]` | Shared-module options for tabs. |

### Panel state

`leftSidebarOpen`, `rightSidebarOpen`, `fieldsOpen` and `previewOpen` are two-way bindable
(`model()`), all `true` by default. The builder stores nothing itself — no package here touches
`localStorage`, which keeps them safe to render on a server — so a host that wants the layout
remembered binds them to its own storage:

```html
<ngx-entity-builder [config]="config" [(leftSidebarOpen)]="paletteOpen" [(previewOpen)]="previewOpen" />
```

### Outputs

| Output | Payload |
|---|---|
| `configChange` | `EntityFormConfig` — emitted on every edit. |
| `rulesChange` | `FormRule[]` — emitted on every edit, the mirror of `configChange`. |
| `save` | `EntityFormConfig` — emitted when the user saves. |

### Rules are stored beside the config, not inside it

`EntityFormConfig` has no `rules` property: the renderer takes them as a separate `[rules]`
input, and so does this component. A host therefore has to save both.

`save` carries the config alone, for compatibility. Keep the latest `rulesChange` and write
it alongside:

```typescript
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';

declare const api: {
  saveConfig(config: EntityFormConfig): void;
  saveRules(entity: string, rules: FormRule[]): void;
};

let authored: FormRule[] = [];

export function onRulesUpdated(rules: FormRule[]): void {
  authored = rules;
}

export function onSave(config: EntityFormConfig): void {
  api.saveConfig(config);
  // Saving the config alone drops every rule the user just authored.
  api.saveRules(config.entity, authored);
}
```

Keeping the pair together matters beyond persistence: renaming a field repoints the rules
that named it, so a host that saved the config from a later edit and the rules from an
earlier one would write a rule pointing at a field that no longer exists. The undo history
stores the two together for the same reason.

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
or `$localize`. `DEFAULT_BUILDER_TEXT` exports all 222 keys with their English source
strings, so a translation file can be generated from it rather than transcribed.

**`uiLanguage` is not `languages`.** `languages` is the vocabulary a label is _authored_ in,
and `store.activeLanguage()` says which entry the inspector is editing right now. Tying the
chrome to that would flip the whole interface every time an author switched the label
language they were working on. `BuilderTextService` is root-provided, so two builders mounted
at once share one chrome language.

---

## ⚠️ Known limitations

- **Field ids are unique per scope**, not across the whole schema — `address` on Personal Details and `address` on Work Details are two different fields, and records nest by tab so they store separately. The builder still generates and enforces ids that are unique across the config, because its selection model addresses a field by bare id. New `showWhen`, cascade, patch and rule references are chosen from a path list (`[work.address]`). A bare id in an older config is still valid while only one scope defines it; `validateConfig` reports it as ambiguous the moment two do.
- **Not an SSR target.** The builder is a Material visual editor with drag-and-drop. Host it in a browser-only route. The form renderer (`ngx-dynamic-entity`) is the SSR surface.
