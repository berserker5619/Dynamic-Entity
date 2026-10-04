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
- **Pure form logic** — label resolution, display value formatting (`setDateFormatters` for `date` / `datetime` / `time`), nested data access, and masking, all as side-effect-free functions.
- **Rules engine** — condition evaluation over 18 operators (`EQUAL`, `NOT_EQUAL`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `IS_EMPTY`, `IS_NOT_EMPTY`, `LESS_THAN`, `MORE_THAN`, `LESS_THAN_EQUAL`, `MORE_THAN_EQUAL`, `DATE_BEFORE`, `DATE_AFTER`, `IN`, `NOT_IN`, `HAS_ITEMS`, `VALUE_CHANGED`) producing three action types: `visibility`, `validation`, and `info`.
- **Canonical field catalog** — `FIELD_TYPE_CATALOG` is the single source of truth for the 27 field type keys (`text`, `textarea`, `markdown`, `number`, `currency`, `email`, `password`, `date`, `datetime`, `time`, `monthYear`, `dropdown`, `radio`, `checkbox`, `boolean`, `multiSelect`, `entity-ref`, `group`, `array`, `image`, `file`, `url`, `phone`, `slider`, `rating`, `color`, `tags`), consumed by both the renderer and the builder.
- **Entity reference contracts** — `EntityReferenceLoader`, option normalisation, and pure cascade filtering (`lookupFilter` / `lookupPath`).
- **File contracts** — canonical `FileRef` and `FileUploadHandler`, shared by the image and file field types.
- **Config validation** — `validateConfig` checks structure, field types against the catalog, ids unique per scope, and references that would never resolve — including bracketed field paths and, when passed, `FormRule`s. A JSON Schema for editor completion ships alongside it at `@dynamic-entity/core/schema`. The same check is the `dynamic-entity validate` command, for gating configs in CI.
- **Spreadsheet import engine** — `deriveImportColumns`, `suggestMapping` and `applyMapping` turn sheet rows into records against a config, applying the field validators and the rules the way the form does. The engine also includes a streaming CSV reader that detects `,` / `;` / tab (`createCsvReader`, `parseCsv`), numbered-header matching for repeating fields, `arrayBoundFor` to size them from a sheet, and `cellText` for rendering typed cells. It is pure, so the same engine runs in the browser and in `@dynamic-entity/server`.
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
console.log(FIELD_TYPE_CATALOG.length); // 27

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
  hiddenFields: string[];                        // fields hidden by a visibility rule
  hiddenTabs: string[];                          // tabs hidden by a visibility rule
  shownFields: string[];                         // fields a `visibility: true` rule showed
  shownTabs: string[];                           // tabs a `visibility: true` rule showed
  validationErrors: Record<string, string>;      // target id → message
  validationWarnings: Record<string, string>;    // target id → message
  infoBanners: Record<string, string>;           // target id → message
}
```

Each list and map holds the target **as the rule names it** — a bare id, or a bracketed path
such as `[personal.status]` — not the rule id. A hide beats a show; a show beats a field's
static `visibility: false` or `showWhen`. The values map you pass is looked up by the same
names, so a rule written with paths needs values keyed by path too: `flattenFieldValues`
builds that map, every field under both its id and its `[path]`. Pass a baseline record as
the third argument to enable the `VALUE_CHANGED` operator, and `{ onProblem }` as the fourth
to hear about a malformed rule, which is skipped rather than thrown:

```typescript
import { evaluateFormRules, type FormRule } from '@dynamic-entity/core';

declare const rules: FormRule[];
declare const currentValues: Record<string, unknown>;
declare const originalValues: Record<string, unknown>;

const changed = evaluateFormRules(rules, currentValues, originalValues);
```

---

## Date display

`formatDisplayValue` formats `date`, `datetime` and `time` through the **runtime's** locale
(`toLocaleDateString` and friends), not the form's `language`. `language` selects which
`LocalizedText` key to read; tying the two would change the punctuation for every consumer
whose browser (or Node `Intl`) is set to something else.

```typescript
import { setDateFormatters } from '@dynamic-entity/core';

setDateFormatters({
  date: (value, lang) => value.toLocaleDateString(lang ?? []),
});
```

Every caller of `formatDisplayValue` honours it — which, in the renderer, means every
read-only `date`, `datetime` and `time` field as well as the record summary.

A partial object overrides one kind and leaves the rest. `setDateFormatters()` with no
argument restores the defaults. It is module-level rather than an injection token because
`formatDisplayValue` is a pure function — the renderer, the builder and the CLI all call it,
and only one of those has an injector.

---

## Validating a config

`validateConfig` is the API. The package also ships a `dynamic-entity` bin so the same
check can run in CI without writing a script:

```bash
npx dynamic-entity validate ./form-config.json
```

`--additional-field-types signature,nps` is the command-line form of
`additionalFieldTypes`, and `--validators noDisposable,uniqueEmail` of `knownValidators`, so a
`validators.custom` naming something unregistered is caught before it is silently dropped at
render time. `--rules rules.json` is a `FormRule[]` checked against the same
path/id rule as `showWhen`. `--fail-on-warnings` treats a warning as a failure. Exit `0`
means no errors, `1` means the config is unusable, `2` means the file or the JSON itself is.

