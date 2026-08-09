# @dynamic-entity/core

Framework-agnostic core models, pure form logic, rules evaluation engine, and field type vocabulary for `@dynamic-entity`.

## Features
- **Nested Entity Form Model (`EntityFormConfig`)**: Expresses tabbed hierarchies, nested groups, arrays, and field table display metadata.
- **Pure Form Logic**: Framework-independent utilities for label resolution, display value formatting, nested data access, and masking.
- **Rules Engine**: Pure condition evaluation for 18 rule operators (`EQUAL`, `CONTAINS`, `MORE_THAN`, `VALUE_CHANGED`, etc.) with action targeting (hidden fields/tabs, validation errors/warnings, info banners).
- **Canonical Field Catalog**: Single source of truth for 19 rich field type keys (`text`, `monthYear`, `entity-ref`, `image`, `file`, etc.), consumed by both the renderer and the builder.
- **Entity Reference Contracts**: `EntityReferenceLoader`, option normalisation, and pure cascade filtering (`lookupFilter` / `lookupPath`) — no framework, no rxjs.
- **File Contracts**: the canonical `FileRef` and `FileUploadHandler` shared by the image and file fields.

## Config versioning — no migration path

`EntityFormConfig` carries a `version`, but this package ships **no migration**. A persisted
config is only guaranteed to load against the model version it was written with. Stamp
`version` on save and gate your own upgrade path on it; a breaking model change will not
be auto-upcast for you.

## Installation
```bash
npm install @dynamic-entity/core
```

## Quick Start
```typescript
import { evaluateFormRules, resolveLabel, FIELD_TYPE_CATALOG } from '@dynamic-entity/core';

// Resolve localized label
const label = resolveLabel({ en: 'First Name', de: 'Vorname' }, 'en'); // "First Name"

// Evaluate rules
const result = evaluateFormRules(rules, { age: 16 });
console.log(result.validationErrors); // { age: "Must be 18 or older" }
```
