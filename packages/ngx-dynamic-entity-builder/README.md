# ngx-dynamic-entity-builder

[![npm version](https://img.shields.io/npm/v/ngx-dynamic-entity-builder.svg?color=purple)](https://www.npmjs.com/package/ngx-dynamic-entity-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Visual drag-and-drop Angular form builder component for `@dynamic-entity/core` and `ngx-dynamic-entity`.

---

## 📦 Installation

```bash
npm install ngx-dynamic-entity-builder @dynamic-entity/core
```

---

## ✨ Features

- **Visual Palette & Canvas**: Drag-and-drop authoring for all 18 catalog field types from `@dynamic-entity/core`.
- **Property Inspector**: Configure validators, options, display flags, `criticalField`, `maskData`, `autoPatch`, and `patchOnTrue`.
- **Entity Reference Designer**: Registry key mapping, display fields, static filters, and parent→child cascades (`parentField` + `lookupFilter`).
- **Rules Manager**: Create, reorder, edit, and toggle reactive rules (`RuleFormComponent` & `FieldRulesListComponent`).
- **Tab & Tree Manager**: Organize primary tabs, sub-tabs, nested groups, and dynamic array field lists up to 3 levels deep.
- **Live Preview Slot**: Projected content slot for live rendering without hard dependencies on the renderer.

---

## 🚀 Usage

```html
<ngx-entity-builder
  [config]="initialConfig"
  (configChange)="onConfigUpdated($event)"
/>
```
