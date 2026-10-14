# Release Candidate Feedback

Log issues and observations from testing the release candidates (`sheet-to-schema@1.0.0-rc.1`, Dynamic Entity `3.0.0-rc.1`).

## Template

- **Date**: 
- **App**: 
- **Sheet shape**: 
- **What happened**: 
- **Expected**: 
- **Severity**: 

---

## Feedback Log

### 1. Grouped rows in browser path
- **Date**: 2026-10-14
- **App**: Standalone consumer app (`sheet-to-schema@1.0.0-rc.1`, `@dynamic-entity/core@3.0.0-rc.1`)
- **Sheet shape**: CSV with 4 rows sharing Order IDs across child item rows (`Item SKU`, `Item Qty`), with conflicting parent field `Customer` on the second order (`Globex` vs `Initech`).
- **What happened**: `applyMapping` aggregated 4 rows into 2 parent records with child `items` arrays. For `ORD-102` which had disagreeing parent values, the first row value (`Globex`) was kept, and a `RECORD_GROUP_CONFLICT` warning was emitted referencing row 4 and target `customer`.
- **Expected**: Hierarchical grouping of child rows under parent record, first row value retained on parent conflict, and `RECORD_GROUP_CONFLICT` warning emitted.
- **Severity**: Pass / Working as expected.
  - *Observation*: The warning provides `row: 4`, `rows: [4, 5]`, and `ref: 'customer'`. Clear and actionable for UI display.

### 2. Day-first date parsing ambiguity guard
- **Date**: 2026-10-14
- **App**: Standalone consumer app (`sheet-to-schema@1.0.0-rc.1`)
- **Sheet shape**: CSV with ambiguous digit date `05/09/2026` (row 1) and day-settling date `15/10/2026` (row 2).
- **What happened**: 
  1. Without `dateOrder` specified: strictly refused row 1 with `CELL_FORMAT` error. No guessing occurred.
  2. With `dateOrder: 'DMY'`: both rows imported cleanly as `2026-09-05` and `2026-10-15`.
  3. With `dateOrder: 'MDY'`: row 1 imported as `2026-05-09` (May 9), and row 2 failed with `CELL_FORMAT` because month 15 is invalid.
- **Expected**: Ambiguous dates must never be guessed and must fail unless `dateOrder` is declared on the run or entry.
- **Severity**: Pass / Working as expected.

### 3. Excel (.xlsx) native typed cells in Browser & Server
- **Date**: 2026-10-14
- **App**: Full stack consumer app (`sheet-to-schema@1.0.0-rc.1`, `@dynamic-entity/server@3.0.0-rc.1`, `exceljs@4.4.0`)
- **Sheet shape**: Binary `.xlsx` workbook containing native cell types: boolean (`true`/`false`), floating point (`98.5`), integer (`100`), and native JS `Date` (`2026-06-15T00:00:00Z`).
- **What happened**:
  1. Browser path (`readSheet` -> `applyMapping`): extracted cells as `unknown[]` preserving native booleans, numbers, and dates. Records produced typed fields (`typeof active === 'boolean'`, `typeof score === 'number'`).
  2. Server path (`createImportRouter` via Express multipart POST): received upload stream, parsed workbook rows, and executed `onImport` with identical typed records.
- **Expected**: Zero stringification degradation (such as `'TRUE'` or `'98.5'`) when Excel cells are natively typed.
- **Severity**: Pass / Working as expected.

### 4. Numbered columns with compacted array slots
- **Date**: 2026-10-14
- **App**: Standalone consumer app (`sheet-to-schema@1.0.0-rc.1`)
- **Sheet shape**: CSV with headers `Name`, `Phone 1 Number`, `Phone 2 Number`. First contact had both phones populated; second contact had Phone 2 empty.
- **What happened**: `suggestMapping` recognized the numbered slot grammar (`phones.0.number`, `phones.1.number`). `applyMapping` populated both slots for contact 1 (`phones.length === 2`), and compacted contact 2 (`phones.length === 1`), eliding the empty trailing slot.
- **Expected**: Compacted arrays drop unpopulated slots while preserving non-empty entries.
- **Severity**: Pass / Working as expected.

### 5. Semicolon CSV with decimal commas
- **Date**: 2026-10-14
- **App**: Standalone consumer app (`sheet-to-schema@1.0.0-rc.1`)
- **Sheet shape**: European format CSV using `;` delimiter with numbers using decimal commas (`12,50`, `2,50`, `100,00`).
- **What happened**: `detectDelimiter` detected `;` from header and data content. Coercion with `decimal: ','` correctly converted `12,50` to number `12.5` and `2,50` to `2.5`.
- **Expected**: Automatic separator detection and decimal comma conversion to numeric primitives.
- **Severity**: Pass / Working as expected.

### 6. Legacy 2.5 plan upgrade in 3.0
- **Date**: 2026-10-14
- **App**: Standalone consumer app (`sheet-to-schema@1.0.0-rc.1`, `@dynamic-entity/core@3.0.0-rc.1`)
- **Sheet shape**: Stored plan in 2.5 format (no `planVersion`, top-level `entity: 'customers'`, `configVersion: 1`, entries with `ref` and `column`).
- **What happened**: `readPlan` normalized the plan: stamped `planVersion: 2`, promoted `entity` to `target: 'customers'`, `configVersion` to `schemaVersion: 1`, and returned a valid v2 plan. Imported 2 rows with exact parity to 2.5.
- **Expected**: Backward compatibility with saved plans without manual migration.
- **Severity**: Pass / Working as expected.

### 7. Mixed version interoperability (3.0 client vs 2.5 server)
- **Date**: 2026-10-14
- **App**: Multi-version test harness (`@dynamic-entity/server@2.5.0` on Express listener vs `sheet-to-schema@1.0.0-rc.1` client helpers)
- **Sheet shape**: Flat and grouped plan submissions across version boundary.
- **What happened**:
  1. 3.0 client previewed against 2.5 server, receiving `engineVersion: '2.5.0'` and `planVersions: [1]`.
  2. When submitting a grouped plan (v2 feature), `planForServer` refused sending it with `refused: ['group']` because a 2.5 server would ignore grouping and import flat rows.
  3. When submitting a flat plan, `planForServer` automatically downgraded the plan to v1 format (`entity` instead of `target`, stripped `planVersion`) allowing the 2.5 server to execute the import.
- **Expected**: Client detects older server capabilities, prevents sending unsupported v2 features that would silently corrupt data, and downgrades flat plans gracefully.
- **Severity**: Pass / Working as expected.
