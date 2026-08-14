# Dynamic Entity Ecosystem 🚀

> Production-Grade, Low-Code Enterprise Form Engine & Visual Builder for Angular 17+

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/nizamudeen5619/Dynamic-Entity)
[![Angular](https://img.shields.io/badge/angular-17%2B-red.svg)](https://angular.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Dynamic Entity** is a complete, enterprise-grade suite of packages for declarative form creation, dynamic table rendering, rule evaluation, role-based access control (RBAC), and visual drag-and-drop form authoring in Angular 17.

---

## 📦 Packages in the Monorepo

| Package | Version | Description |
|---|---|---|
| [`@dynamic-entity/core`](./packages/core) | `1.0.0` | Framework-agnostic schema models, validation engine, rules evaluator & utilities. |
| [`ngx-dynamic-entity`](./packages/ngx-dynamic-entity) | `1.0.0` | Angular 17 standalone UI library for rendering dynamic forms & entity tables. |
| [`ngx-dynamic-entity-builder`](./packages/ngx-dynamic-entity-builder) | `1.0.0` | Standalone visual drag-and-drop builder for authoring `EntityConfig` schemas. |
| `demo-angular` | `1.0.0` | Showcase Angular demo application with Playwright E2E test suite. |

---

## ✨ Features

- **18 Unified Field Types**: Text, Text Area, Number, Currency, Date, Month & Year, Checkbox, Radio, Select, Multi-Select, Boolean Switch, Group, Array, Image Upload, File Attachment, Entity Reference, Connection, Lookup List.
- **Reactive Rules Engine**: Evaluate `SHOW_WHEN`, `ENABLE_WHEN`, `REQUIRE_WHEN`, `CALCULATE` rules dynamically as form values change.
- **Role-Based Access Control (RBAC)**: Field-level permission enforcement (`READ_WRITE`, `READ_ONLY`, `MASKED`, `HIDDEN`).
- **Cross-Entity Referenced Fields**: Link fields to external source entities with real-time drift detection and one-click syncing.
- **Named Lookup Lists**: Asynchronous & synchronous resolution of localized multi-language option lists with fallbacks.
- **Visual Drag & Drop Builder**: Tree editor supporting recursive tab, group, and array structuring up to 3 levels deep.
- **100% Standalone & Signals-Native**: Built natively on Angular 17 Signals, Standalone Components, and CDK Drag & Drop.

---

## 🚀 Quick Start

### 1. Installation

```bash
npm install @dynamic-entity/core ngx-dynamic-entity ngx-dynamic-entity-builder
```

### 2. Render a Dynamic Form in Angular

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
      [initialValue]="initialRecord"
      [role]="'editor'"
      (formSubmit)="onSave($event)"
    />
  `
})
export class RecordEditorComponent {
  config: EntityFormConfig = {
    key: 'client',
    version: '1.0.0',
    labels: { en: 'Client Profile' },
    tabs: [
      {
        id: 'general',
        title: { en: 'General' },
        fields: [
          { id: 'firstName', type: 'text', label: { en: 'First Name' }, required: true },
          { id: 'lastName', type: 'text', label: { en: 'Last Name' }, required: true },
          { id: 'email', type: 'text', label: { en: 'Email' }, validators: [{ type: 'email' }] }
        ]
      }
    ]
  };

  initialRecord = { firstName: 'Alice', lastName: 'Smith' };

  onSave(record: any) {
    console.log('Saved record:', record);
  }
}
```

### 3. Embed the Visual Form Builder

```typescript
import { Component } from '@angular/core';
import { EntityBuilderComponent } from 'ngx-dynamic-entity-builder';
import type { EntityFormConfig } from '@dynamic-entity/core';

@Component({
  selector: 'app-schema-designer',
  standalone: true,
  imports: [EntityBuilderComponent],
  template: `
    <ngx-entity-builder
      [config]="initialConfig"
      (configChange)="onConfigUpdated($event)"
    />
  `
})
export class SchemaDesignerComponent {
  initialConfig: EntityFormConfig = { /* ... */ };

  onConfigUpdated(newConfig: EntityFormConfig) {
    console.log('Schema updated:', newConfig);
  }
}
```

---

## 🧪 Testing & Verification

Run tests across all monorepo packages:

```bash
# Run turbo pipeline across all packages (build, test, lint)
npx turbo run build test lint

# Run Playwright E2E test suite (54 specs)
npm run e2e --workspace=demo-angular
```

---

## 📜 License

Distributed under the [MIT License](LICENSE).
