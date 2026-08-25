# @dynamic-entity/core

[![npm version](https://img.shields.io/npm/v/@dynamic-entity/core.svg?color=blue)](https://www.npmjs.com/package/@dynamic-entity/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Framework-agnostic core models, pure form logic, rules evaluation engine, and field type vocabulary for the `@dynamic-entity` ecosystem.

Contains no Angular and no RxJS — it is plain TypeScript and can be used from any framework, or on a server.

---

## 📦 Installation

```bash
npm install @dynamic-entity/core
```

---

## ✨ Features

- **Nested entity form model (`EntityFormConfig`)** — tabbed hierarchies, sub-tabs, nested groups, arrays, and field table display metadata.
- **Pure form logic** — label resolution, display value formatting, nested data access, and masking, all as side-effect-free functions.
- **Rules engine** — condition evaluation over 18 operators (`EQUAL`, `NOT_EQUAL`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `IS_EMPTY`, `IS_NOT_EMPTY`, `LESS_THAN`, `MORE_THAN`, `LESS_THAN_EQUAL`, `MORE_THAN_EQUAL`, `DATE_BEFORE`, `DATE_AFTER`, `IN`, `NOT_IN`, `HAS_ITEMS`, `VALUE_CHANGED`) producing three action types: `visibility`, `validation`, and `info`.
- **Canonical field catalog** — `FIELD_TYPE_CATALOG` is the single source of truth for the 19 field type keys (`text`, `textarea`, `number`, `currency`, `email`, `password`, `date`, `datetime`, `monthYear`, `dropdown`, `radio`, `checkbox`, `boolean`, `multiSelect`, `entity-ref`, `group`, `array`, `image`, `file`), consumed by both the renderer and the builder.
- **Entity reference contracts** — `EntityReferenceLoader`, option normalisation, and pure cascade filtering (`lookupFilter` / `lookupPath`).
- **File contracts** — canonical `FileRef` and `FileUploadHandler`, shared by the image and file field types.
- **Record migration** — `migrateRecord`, `needsMigration`, `stampRecord` and `validateMigrations` move a saved record forward as a config's `version` changes. Pure, so the same steps run in the browser and on a server.

---

## 🚀 Quick Start

```typescript
import {
  evaluateFormRules,
  resolveLabel,
  FIELD_TYPE_CATALOG,
  type FormRule,
} from '@dynamic-entity/core';

// 1. Resolve a localized label
const label = resolveLabel({ en: 'First Name', de: 'Vorname' }, 'en'); // "First Name"

// 2. Inspect the field type vocabulary
console.log(FIELD_TYPE_CATALOG.length); // 19

// 3. Raise an info banner on the `annualBudget` field when it exceeds 5,000,000
const rules: FormRule[] = [
  {
    formConfigId: 'client',
    fieldId: 'annualBudget',
    conditions: [{ operator: 'MORE_THAN', value: 5_000_000, compareType: 'value' }],
    action: { type: 'info', value: 'Budget exceeds $5,000,000' },
    targets: [{ id: 'annualBudget', type: 'field' }],
    enabled: true,
    priority: 0,
  },
];

const result = evaluateFormRules(rules, { annualBudget: 6_000_000 });
console.log(result.infoBanners); // { annualBudget: 'Budget exceeds $5,000,000' }
```

`evaluateFormRules` returns a `RuleEvaluationResult`:

```typescript
interface RuleEvaluationResult {
  hiddenFields: string[];                        // field ids hidden by a visibility rule
  hiddenTabs: string[];                          // tab ids hidden by a visibility rule
  validationErrors: Record<string, string>;      // target id → message
  validationWarnings: Record<string, string>;    // target id → message
  infoBanners: Record<string, string>;           // target id → message
}
```

Each map is keyed by the **target id** the rule points at, not by rule id. Pass a baseline record as the third argument to enable the `VALUE_CHANGED` operator:

```typescript
import { evaluateFormRules, type FormRule } from '@dynamic-entity/core';

declare const rules: FormRule[];
declare const currentValues: Record<string, unknown>;
declare const originalValues: Record<string, unknown>;

const changed = evaluateFormRules(rules, currentValues, originalValues);
```
