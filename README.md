# Dynamic Entity Ecosystem 🚀

> Production-Grade, Low-Code Enterprise Form Engine & Visual Builder for Angular 17+

[![npm core](https://img.shields.io/npm/v/@dynamic-entity/core.svg?label=@dynamic-entity/core&color=blue)](https://www.npmjs.com/package/@dynamic-entity/core)
[![npm renderer](https://img.shields.io/npm/v/ngx-dynamic-entity.svg?label=ngx-dynamic-entity&color=red)](https://www.npmjs.com/package/ngx-dynamic-entity)
[![npm builder](https://img.shields.io/npm/v/ngx-dynamic-entity-builder.svg?label=ngx-dynamic-entity-builder&color=purple)](https://www.npmjs.com/package/ngx-dynamic-entity-builder)
[![Angular](https://img.shields.io/badge/angular-17%2B-red.svg)](https://angular.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Dynamic Entity** is a complete, enterprise-grade suite of packages for declarative form creation, dynamic table rendering, rule evaluation, role-based access control (RBAC), and visual drag-and-drop form authoring in Angular 17+.

---

## 📦 Published Packages

| Package | Version | NPM | Description |
|---|---|---|---|
| [`@dynamic-entity/core`](./packages/core) | `1.0.0` | [![npm](https://img.shields.io/npm/v/@dynamic-entity/core.svg)](https://www.npmjs.com/package/@dynamic-entity/core) | Framework-agnostic schema models, validation engine, rules evaluator & utilities. |
| [`ngx-dynamic-entity`](./packages/ngx-dynamic-entity) | `1.0.0` | [![npm](https://img.shields.io/npm/v/ngx-dynamic-entity.svg)](https://www.npmjs.com/package/ngx-dynamic-entity) | Angular 17 standalone UI library for rendering dynamic forms & entity tables. |
| [`ngx-dynamic-entity-builder`](./packages/ngx-dynamic-entity-builder) | `1.0.0` | [![npm](https://img.shields.io/npm/v/ngx-dynamic-entity-builder.svg)](https://www.npmjs.com/package/ngx-dynamic-entity-builder) | Standalone visual drag-and-drop builder for authoring `EntityConfig` schemas. |
| `demo-angular` | `1.0.0` | — | Showcase Angular demo application with Playwright E2E test suite. |

---

## ✨ Features

- **18 Unified Field Types**: Text, Text Area, Number, Currency, Date, Month & Year, Time, Checkbox, Radio, Select, Multi-Select, Boolean Switch, Group, Array, Image Upload, File Attachment, Entity Reference, Connection, Lookup List.
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
import { DynamicFormComponent, provideNgxDynamicEntity, provideBuiltInFieldTypes } from 'ngx-dynamic-entity';
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
    entity: 'client',
    version: 1,
    name: { en: 'Client Profile' },
    tabs: [
      {
        id: 'general',
        label: { en: 'General' },
        visibility: true,
        systemDefault: true,
        isPrimaryTab: true,
        fields: [
          { id: 'firstName', type: 'text', label: { en: 'First Name' }, visibility: true, validators: { required: true } },
          { id: 'lastName', type: 'text', label: { en: 'Last Name' }, visibility: true, validators: { required: true } },
          { id: 'email', type: 'text', label: { en: 'Email' }, visibility: true, validators: { required: true } }
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
      [config]="config"
      (configChange)="onConfigUpdated($event)"
    />
  `
})
export class SchemaDesignerComponent {
  config!: EntityFormConfig;

  onConfigUpdated(newConfig: EntityFormConfig) {
    console.log('Updated Schema Config:', newConfig);
  }
}
```

---

## 🧪 Testing

```bash
# Run unit tests across all workspace packages
npm test

# Run Playwright E2E browser tests
npm run e2e
```

---

## 📄 License

[MIT](LICENSE) © Nizamudeen
