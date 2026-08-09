# ngx-dynamic-entity-builder

Visual drag-and-drop Angular form builder for `@dynamic-entity/core` and `ngx-dynamic-entity`.

## Features
- **Visual palette & canvas** — drag-and-drop authoring for all 19 field type keys, from the
  shared catalog in `@dynamic-entity/core` (so the builder can never drift from the renderer).
- **Inspector** — properties, validation, options, display flags, `showWhen` conditions,
  `criticalField`, `showOnMinimize`, and `patchOnTrue`.
- **Entity reference config** — registry key, display fields, static filters, parent→child
  cascade (`parentField` + `lookupFilter`/`lookupPath`), and `autoPatch` mappings.
- **Rules** — author a rule with `RuleFormComponent`, manage the set per field with
  `FieldRulesListComponent` (reorder, enable/disable, edit, delete).
- **Tab & module manager** — primary and nested tab structures.
- **Live preview** — projected content slot; the builder does not depend on the renderer.

## Installation
```bash
npm install ngx-dynamic-entity-builder @dynamic-entity/core
```

`ngx-dynamic-entity` is not required — pass a rendered preview in as projected content if you
want one.

## Usage
```html
<ngx-entity-builder
  [config]="initialConfig"
  [rules]="initialRules"
  (configChange)="onConfigUpdated($event)"
/>
```

## Rules are stored beside the config

`BuilderStore` keeps rules separate from `EntityFormConfig` — they are persisted per form, not
inside the config object. Load and export them explicitly:

```ts
store.load(config);
store.loadRules(rules);
// …authoring…
const config = store.exportConfig();
const rules = store.exportRules();
```

Reordering rules renumbers `priority` contiguously from 1.

## Sub-components

Each panel is individually importable: `FieldPaletteComponent`, `FieldInspectorComponent`,
`TabManagerComponent`, `RuleFormComponent`, `FieldRulesListComponent`,
`EntityReferenceConfigComponent`. All read and write through the `BuilderStore` provided by
`EntityBuilderComponent`.
