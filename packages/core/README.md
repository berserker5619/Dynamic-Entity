# @dynamic-entity/core

[![npm version](https://img.shields.io/npm/v/@dynamic-entity/core.svg?color=blue)](https://www.npmjs.com/package/@dynamic-entity/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Framework-agnostic core models, pure form logic, rules evaluation engine, and field type vocabulary for the `@dynamic-entity` ecosystem.

---

## 📦 Installation

```bash
npm install @dynamic-entity/core
```

---

## ✨ Features

- **Nested Entity Form Model (`EntityFormConfig`)**: Expresses tabbed hierarchies, nested groups, arrays, and field table display metadata.
- **Pure Form Logic**: Framework-independent utilities for label resolution, display value formatting, nested data access, and masking.
- **Rules Engine**: Pure condition evaluation for 18 rule operators (`EQUALS`, `NOT_EQUAL`, `CONTAINS`, `GREATER_THAN`, `VALUE_CHANGED`, etc.) with action targeting (hidden fields/tabs, validation errors/warnings, info banners).
- **Canonical Field Catalog**: Single source of truth for 18 rich field type keys (`text`, `currency`, `monthYear`, `entityRef`, `referencedField`, `image`, `file`, etc.), consumed by both the renderer and the builder.
- **Entity Reference Contracts**: `EntityReferenceLoader`, option normalisation, and pure cascade filtering (`lookupFilter` / `lookupPath`) — no framework, no rxjs.
- **File Contracts**: Canonical `FileRef` and `FileUploadHandler` shared by image and file fields.

---

## 🚀 Quick Start

```typescript
import { evaluateFormRules, resolveLabel, FIELD_CATALOG } from '@dynamic-entity/core';

// 1. Resolve localized label
const label = resolveLabel({ en: 'First Name', de: 'Vorname' }, 'en'); // "First Name"

// 2. Evaluate rules dynamically
const result = evaluateFormRules(rules, { annualBudget: 6000000 });
console.log(result.infoBanners); // [{ severity: 'warning', message: 'Budget exceeds $5,000,000' }]
```
