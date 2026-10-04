# Import engine extraction — analysis

**Goal under study:** pull Dynamic Entity's spreadsheet import out into a standalone, generic
importer that maps flat sheet columns into *any* nested structure (JSON Schema, or an example
JSON object), with `EntityFormConfig` as one schema adapter among several.

**Scope read:** `packages/core` (import model, engine, column derivation, CSV),
`packages/server` (streaming reader, xlsx, runner, Express adapter, template writer) and
`packages/ngx-dynamic-entity/src/lib/import` (wizard components and transports). Analysis
only — no code was changed.

**How claims were checked:** by reading the source. Behaviour that the source alone left
ambiguous was confirmed by running small probe scripts against the built
`packages/core/dist/index.mjs` (which reports `CORE_VERSION` `2.2.0`, the same as the source
tree at `fb095e8`). Anything marked **unverified** was neither read in full nor probed.

---

## TL;DR

1. **The pipeline is already generic. Its inputs are not.** Reading (CSV state machine, xlsx
   via exceljs, magic-byte sniffing, zip guarding, limits, streaming batches), plan shape
   (`column` index → `ref` dot path), path writing (`setRecordValue`), array compaction and the
   error/result model know nothing about forms. Everything that decides *what the targets are,
   how a cell becomes a value, and what counts as valid* is hard-wired to `EntityFormConfig`
   and `NestedFieldConfig`. That includes all three exported entry points (`applyMapping`,
   `deriveImportColumns`, `validateMappingPlan`).
2. **The seam already exists internally.** `ImportColumn` (the derived list of addressable
   targets) is the narrow waist. `applyMapping` only reads `column.field` from it, to coerce
   and validate. Replace `field: NestedFieldConfig` with a schema-neutral target descriptor plus
   adapter callbacks and most of core lifts out as-is.
3. **Gap check:** nested objects **yes**. Numbered-column arrays **partly**: the engine does
   it, but only with its own header/ref spelling, and the wizard offers 3 rows. Split cells
   **partly**: only `tags`/`multiSelect`, and `;` is hard-coded. One-to-many row merge **no**,
   and the streaming runner's batching makes it non-trivial. Non-`EntityFormConfig` target
   **no**.
4. **Hardest part of the extraction:** not the code move. It is the two new features the
   standalone package needs, row grouping (d) and split-to-primitive-array (c). Both change
   the `MappingPlan` contract, which is persisted and crosses the wire. Design the plan v2
   shape first.

---

## 1. Inventory

### 1.1 `packages/core/src`

| File | Exports (public via `index.ts` unless noted) | Depends on | Reads `EntityFormConfig` / `FormRule` / lookups? |
|---|---|---|---|
| [import-model.types.ts](../packages/core/src/import-model.types.ts) | `ImportColumn`, `UnsupportedColumn`, `DerivedColumns`, `MappingEntry`, `MappingPlan`, `ImportRowError`, `ImportResult` (all types) | `NestedFieldConfig` (form-model.types), `ConfigProblem` (validate-config) | `ImportColumn.field: NestedFieldConfig`; `ImportResult.planProblems: ConfigProblem[]` |
| [import-wire.types.ts](../packages/core/src/import-wire.types.ts) | `ImportPreviewResponse`, `ImportCommitResponse`, `ImportErrorResponse` | `MappingPlan`, `ImportRowError`, `ConfigProblem` | No (only via `ConfigProblem`) |
| [import-columns.ts](../packages/core/src/import-columns.ts) | `collectLeafTargets`, `deriveImportColumns`, `buildTemplateSpec`, `validateMappingPlan`, `stripIndices`; types `DeriveColumnsOptions`, `LeafTarget`, `TemplateSpec`. **Exported from the file but not from `index.ts`:** `formatArrayHeader`, `parseArrayHeader`, `arrayBoundOf`, `MAX_ARRAY_BOUND` | `collectFieldScopes`, `refOf`, `ROOT_SCOPE` (field-scopes); `getFieldTypeMeta` (field-catalog); `resolveLabel`, `resolveOptionLabel` (form-logic) | **Yes, entirely.** Walks `config.tabs`, `NestedTabConfig.flatData`, `field.type` (`RichFieldType`), `field.validators.required`, `readonly`, `systemDefault`, `visibility`, `options`, `label`, `hint`, `config.entity`, `config.version`, `config.name` |
| [import-engine.ts](../packages/core/src/import-engine.ts) | `applyMapping`, `coerceCell`, `setRecordValue`, `suggestMapping`, `validateImportedRecord`; types `ApplyMappingOptions`, `CoerceOptions`, `CoerceOutcome`, `ImportLookups`, `RecordProblem`, `ValidateRecordOptions`. **File-only export:** `compactArrays` | import-columns; `ROOT_SCOPE`; `stampRecord` (migration); `evaluateFormRules`, `filterRulesForTab` (rules-engine); `evaluateFieldVisibility`, `getTabData`, `getValueByPath`, `isUnsafePath`, `normalizeArrayStructures`, `resolveLabel`, `resolveOptionLabel`, `valuesMatch` (form-logic); `isValidPhone`, `isValidUrl`, `normalizeHexColor`, `normalizeTags`, `ratingScale`, `sliderBounds` (field-values) | **Yes.** `applyMapping`/`validateImportedRecord` take `EntityFormConfig`; validation takes `FormRule[]`; coercion takes `ImportLookups = Record<string, readonly DropdownOption[]>` keyed by `field.listName` |
| [csv.ts](../packages/core/src/csv.ts) | `createCsvReader`, `parseCsv`, `toCsv`, `escapeFormula`, `padRow`; types `CsvReader`, `SheetData` | nothing | No — fully generic |

Supporting core modules the import path pulls in (not import-specific, but they are what
binds it to the form model): `field-scopes.ts` (`collectFieldScopes`, `refOf`, `ROOT_SCOPE`
`= '(root)'`), `form-logic.ts` (path helpers, `getTabData`, `normalizeArrayStructures`,
`valuesMatch`, `evaluateFieldVisibility`, `formatDisplayValue`), `rules-engine.ts`,
`field-values.ts`, `field-catalog.ts`, `migration.ts` (`stampRecord`), `validate-config.ts`
(`ConfigProblem`, `formatConfigProblems`).

**`LOOKUP_REGISTRY` is not reachable from core.** Core receives already-resolved option lists
as `ImportLookups` and looks them up by `field.listName`
([import-engine.ts:177-181](../packages/core/src/import-engine.ts#L177-L181)).

### 1.2 `packages/server/src`

Dependencies: `busboy 1.6.0`, `exceljs 4.4.0`; peer `@dynamic-entity/core ^2.2.0`, optional peer `express`.

| File | Exports | Depends on | Form-model coupling |
|---|---|---|---|
| [run-import.ts](../packages/server/src/run-import.ts) | `runImport`, `previewSheet`; types `BatchInfo`, `OnBatch`, `RunImportOptions`, `ImportRunResult`, `PreviewSheetOptions`, `SheetPreview` | core `applyMapping`, `deriveImportColumns`, `suggestMapping`, `validateMappingPlan`; read-sheet; limits; errors; bytes; cell-text | **Yes:** `RunImportOptions.config: EntityFormConfig`, `rules?: readonly FormRule[]`, `lookups?: ImportLookups`; `checkPlan` hard-codes `includeReadonly`/`includeSystemDefault` |
| [read-sheet.ts](../packages/server/src/read-sheet.ts) | `readSheet`, `detectFormat`, `guardRows`; types `SheetFormat`, `SheetSource`, `ReadSheetOptions` | core `createCsvReader`, `padRow`; bytes; xlsx-source; limits; errors; cell-text | None |
| [xlsx-source.ts](../packages/server/src/xlsx-source.ts) | `xlsxRows`, `cellValue` | `exceljs`, guard-zip, limits, errors | None |
| [guard-zip.ts](../packages/server/src/guard-zip.ts) | `guardZip` | limits, errors | None |
| [bytes.ts](../packages/server/src/bytes.ts) | `toByteStream`, `limitBytes`, `peek`, `destroySource`; type `ByteSource` | — | None |
| [cell-text.ts](../packages/server/src/cell-text.ts) | `sampleText` | — | None |
| [limits.ts](../packages/server/src/limits.ts) | `DEFAULT_LIMITS`, `resolveLimits`; type `ImportLimits` | — | None (note: `maxCellLength` doc comment says it also bounds `validators.pattern`, which is form vocabulary) |
| [errors.ts](../packages/server/src/errors.ts) | `ImportError`, `toErrorBody`; types `ImportErrorCode`, `ImportErrorBody` | — | None (codes include `UNKNOWN_ENTITY`, `INVALID_PLAN`) |
| [multipart.ts](../packages/server/src/multipart.ts) | (internal) `receiveUpload`, `readPlanField`, `safeFieldName`, `Upload` | busboy | None |
| [write-template.ts](../packages/server/src/write-template.ts) | `writeTemplate`, `TEMPLATE_EXTENSION`, `TEMPLATE_MEDIA_TYPE`; types `TemplateFormat`, `WriteTemplateOptions` | core `escapeFormula`, `toCsv`, `TemplateSpec`; exceljs | Indirect: consumes `TemplateSpec`, whose `columns` are `ImportColumn[]` |
| [express.ts](../packages/server/src/express.ts) (subpath `./express`) | `createImportRouter`, `listNamesOf`, `templateFilename`, `sendFailure`; types `OnImport`, `ConfigSource`, `ImportRouterOptions` | core `buildTemplateSpec`, `deriveImportColumns`, `CORE_VERSION`; everything above | **Yes:** `ConfigSource` resolves `EntityFormConfig` per `:entity`; `rules: Record<string, FormRule[]>`; `checkLookups` refuses to boot if any `field.listName` lacks an entry in `lookups` ([express.ts:112](../packages/server/src/express.ts#L112)) |

Routes: `GET /:entity/template`, `POST /:entity/preview`, `POST /:entity/validate`,
`POST /:entity/import`.

### 1.3 `packages/ngx-dynamic-entity/src/lib/import`

All re-exported from `public-api.ts` via `export *`.

| File | Exports | Depends on | Form-model coupling |
|---|---|---|---|
| [import-contracts.ts](../packages/ngx-dynamic-entity/src/lib/import/import-contracts.ts) | `SheetParser`, `TemplateFormat`, `ImportContext`, `ImportPreview`, `ImportTransport` | core types | **Yes:** `ImportContext { config: EntityFormConfig; rules?: readonly FormRule[]; lookups?: ImportLookups; lang? }` |
| [local-import-transport.ts](../packages/ngx-dynamic-entity/src/lib/import/local-import-transport.ts) | `LocalImportTransport` (`@Injectable` root, default) | core `applyMapping`, `deriveImportColumns`, `suggestMapping`, `toCsv`; `SHEET_PARSER` token; `defaultSheetParser` | Through `ImportContext` |
| [http-import-transport.ts](../packages/ngx-dynamic-entity/src/lib/import/http-import-transport.ts) | `HttpImportTransport`, `provideHttpImportTransport`, `HttpImportTransportOptions` | core wire types, `CORE_VERSION`, `deriveImportColumns`, `stripIndices`; `IMPORT_TRANSPORT` | URL uses `context.config.entity`; `selectionOf` re-derives columns from config |
| [sheet-parser.ts](../packages/ngx-dynamic-entity/src/lib/import/sheet-parser.ts) | `defaultSheetParser` | core `parseCsv` | None |
| [entity-import.component.ts](../packages/ngx-dynamic-entity/src/lib/import/entity-import.component.ts) | `EntityImportComponent` (`ngx-entity-import`) | core `buildTemplateSpec`, `collectLeafTargets`, `formatConfigProblems`; `IMPORT_TRANSPORT`; `LookupRegistryService`; `UiTextService`; the four child components | **Yes, and the only `LOOKUP_REGISTRY` reader in the import path.** `loadLookups()` walks `collectLeafTargets(config)` for `field.listName`, resolves each through `LookupRegistryService.resolveOptions`, and merges the `lookups` input over the result ([entity-import.component.ts:303-337](../packages/ngx-dynamic-entity/src/lib/import/entity-import.component.ts#L303-L337)) |
| [import-mapper.component.ts](../packages/ngx-dynamic-entity/src/lib/import/import-mapper.component.ts) | `ImportMapperComponent` (`ngx-import-mapper`) | core `deriveImportColumns` | `@Input config: EntityFormConfig`; builds the plan with `config.entity`/`config.version` |
| [import-preview.component.ts](../packages/ngx-dynamic-entity/src/lib/import/import-preview.component.ts) | `ImportPreviewComponent` (`ngx-import-preview`) | core `applyMapping` (dry run over sample), `coerceCell`, `deriveImportColumns`, `formatDisplayValue` | `config`, `rules`, `lookups` inputs; displays with `formatDisplayValue(field.type, field.options, …)` |
| [import-template.component.ts](../packages/ngx-dynamic-entity/src/lib/import/import-template.component.ts) | `ImportTemplateComponent` (`ngx-import-template`) | core `buildTemplateSpec`, `deriveImportColumns`, `stripIndices` | `config` input |
| [import-errors.component.ts](../packages/ngx-dynamic-entity/src/lib/import/import-errors.component.ts) | `ImportErrorsComponent` (`ngx-import-errors`) | core `ImportRowError` | None — generic |

Tokens: `SHEET_PARSER` and `IMPORT_TRANSPORT` in `tokens/injection-tokens.ts`, provided as `null`
unless `provideNgxDynamicEntity({ sheetParser, importTransport })` supplies them.

---

## 2. `MappingPlan`

Full types, verbatim (doc comments trimmed to the field-level ones), from
[import-model.types.ts:74-100](../packages/core/src/import-model.types.ts#L74-L100):

```ts
export interface MappingEntry {
  /** Target field address. At most one entry per `ref` in a plan. */
  ref: string;
  /** Zero-based column index in the source sheet. */
  column?: number;
  /** Header text at `column` when the plan was authored. Display and drift detection only. */
  header?: string;
  /** A literal applied to every row, for a field the sheet does not carry. */
  constant?: unknown;
  /** `guess` marks a match the suggester inferred rather than read. */
  confidence?: 'exact' | 'guess';
}

export interface MappingPlan {
  entity: string;
  configVersion?: number;
  /** The headers this plan was authored against. */
  sourceHeaders?: string[];
  entries: MappingEntry[];
}
```

The target vocabulary it is checked against
([import-model.types.ts:26-41](../packages/core/src/import-model.types.ts#L26-L41)):

```ts
export interface ImportColumn {
  /** Dot-path address in the record, e.g. `work.address` or `contacts.0.email`. */
  ref: string;
  /** Dotted path of the containing scope, or `ROOT_SCOPE`. */
  scope: string;
  field: NestedFieldConfig;
  /** Suggested header text for a generated template. */
  header: string;
  required: boolean;
  /** Resolved option labels for `dropdown` / `radio` / `multiSelect`. */
  enumValues?: string[];
  /** Human format hint for the template's help row, e.g. `YYYY-MM-DD`. */
  format?: string;
  /** Index within the repeating parent, for a column produced by an `array` field. */
  arrayIndex?: number;
}
```

### How targets are addressed

- **Source side: by column index, never by header.** `column` is a zero-based index, and
  `header` is only for display and drift detection. `column` and `constant` are mutually
  exclusive and exactly one is required ([import-columns.ts:456-466](../packages/core/src/import-columns.ts#L456-L466)).
- **Target side: one address language, the dot path.** `ref` is the same string `refOf`
  produces: `field.refererField ?? (scope === '(root)' ? id : scope + '.' + id)`
  ([field-scopes.ts:176](../packages/core/src/field-scopes.ts#L176)).
- **Flat field ids:** a field on a `flatData` tab at root has `ref === id`.
- **Nested sections:** a non-`flatData` tab adds its id as a path segment, and so does a
  `group` field. A field nests as `tabId.groupId.fieldId`. `refererField` can override the
  path outright (see §5a).
- **Array rows:** numeric segments at the array's own boundary,
  `arrayRef.<index>.tail`, e.g. `contacts.0.email`. Built by `formatArrayHeader(arrayRef, index)`
  = `` `${arrayRef}.${index}` `` ([import-columns.ts:171](../packages/core/src/import-columns.ts#L171)).
  Brackets are deliberately not used, because rules already use `[ref]` tokens.
- **Array bound comes from the plan.** `arrayBoundOf(plan)` = highest numeric segment + 1,
  capped at `MAX_ARRAY_BOUND = 1000`. Both `applyMapping` and `validateMappingPlan` derive the
  column list with that bound, so a 5-row plan is never truncated to the default 3.
- **No nested arrays.** A leaf with more than one repeating ancestor (`LeafTarget.nested`)
  produces no column and is reported in `unsupported`.
- **Validation of the plan** checks that every `ref` exists in the derived columns, that no
  `ref` appears twice, that `column` is a non-negative integer, and the `column`/`constant`
  exclusivity. It only *warns* on `entity` and `configVersion` mismatch.

**Things the plan cannot express today:** a per-entry transform (split, trim, date format,
value map), several columns feeding one target (concatenation), one column feeding several
targets (`takenColumns` in `suggestMapping` prevents it, and the mapper UI has one source per
target, though the plan type and `validateMappingPlan` do allow it), row grouping, or a
header-row offset.

---

## 3. `applyMapping`, `suggestMapping`, coercion and validation

### 3.1 Signatures

```ts
// import-engine.ts:790
export function applyMapping(
  rows: readonly (readonly unknown[])[],
  plan: MappingPlan,
  config: EntityFormConfig,
  options: ApplyMappingOptions = {},
): ImportResult;

export interface ApplyMappingOptions extends CoerceOptions, ValidateRecordOptions {
  stamp?: boolean;            // default true → stampRecord adds `_configVersion`
  firstRowNumber?: number;    // default 2 (header is row 1)
  maxArrayRows?: number;      // documented, but applyMapping ignores it and uses arrayBoundOf(plan)
}
export interface CoerceOptions { lang?: string; lookups?: ImportLookups; }
export interface ValidateRecordOptions {
  lang?: string;
  rules?: readonly FormRule[];
  targets?: readonly LeafTarget[];   // precomputed collectLeafTargets(config)
}
export type ImportLookups = Record<string, readonly DropdownOption[]>;

// import-engine.ts:505
export function suggestMapping(
  headers: readonly string[],
  columns: readonly ImportColumn[],
  entity = '',
): MappingPlan;

// import-engine.ts:348
export function coerceCell(
  field: NestedFieldConfig,
  raw: unknown,
  options: CoerceOptions = {},
): CoerceOutcome;                     // { value: unknown } | { error: string }

// import-engine.ts:710
export function validateImportedRecord(
  record: Record<string, unknown>,
  config: EntityFormConfig,
  options: ValidateRecordOptions = {},
): RecordProblem[];                   // Omit<ImportRowError, 'row'>

// import-columns.ts:231, 391
export function deriveImportColumns(config, options?: DeriveColumnsOptions): DerivedColumns;
export function validateMappingPlan(plan, config, options?: DeriveColumnsOptions): ConfigProblem[];
```

Note on `maxArrayRows`: the `ApplyMappingOptions.maxArrayRows` doc says "Must match what the
columns were derived with". The implementation ignores the option and computes
`Math.max(arrayBoundOf(plan), 1)` ([import-engine.ts:808](../packages/core/src/import-engine.ts#L808)).
That is the stated intent of the inline comment there, so it is a stale doc on the option,
not a bug.

### 3.2 `applyMapping` step by step

1. `validateMappingPlan(plan, config, derive)` once. Any `error` → return with no records.
2. `byRef = deriveImportColumns(config, {includeReadonly, includeSystemDefault, maxArrayRows: bound})`.
   `targets = collectLeafTargets(config)`, hoisted once.
3. For each row (one row → at most one record, always):
   - For each entry: `raw = entry.column === undefined ? entry.constant : row[entry.column]`.
     A non-string constant bypasses coercion. Otherwise `coerceCell(column.field, raw, options)`.
   - An error → `ImportRowError {row, ref, column?, message, raw}`, and the row counts as "saw
     a value".
   - `undefined` (blank) → nothing written. Otherwise `setRecordValue(record, ref, value)`, which
     creates arrays for numeric segments and objects otherwise, guarded by `isUnsafePath`.
   - A row with no non-constant value → `skipped++`.
4. `compactArrays(record)` removes holes and empty entries **and renumbers**: filling only
   "row 2" yields `phones[0]` (confirmed by probe).
5. `normalizeArrayStructures(cleaned, config)` makes every `array` field an array, so absent
   arrays become `[]`. This walks tabs/fields **by `id` under `getTabData`**, not by `ref`.
6. `validateImportedRecord(cleaned, config, {...options, targets})`. Any problem → row rejected.
7. Otherwise `stampRecord(cleaned, config)` (adds `_configVersion`) unless `stamp: false`.

### 3.3 Column matching (`suggestMapping`)

- Normalisation: `normalizeHeader(text) = lowercase, strip [^a-z0-9]`, so "First Name",
  `first_name` and `firstName` all become `firstname`.
- Candidate keys per `ImportColumn`: **exact** = `[column.ref, column.header]`; **loose** =
  `[resolveLabel(field.label), field.id]`.
- Two passes, exact then loose, so a guess never steals an exact match's column.
- One header ↔ one target. The first unclaimed header that matches wins.
- **Ambiguity guard:** a loose key that more than one column answers to is never guessed.
  Side effect: every unrolled array column shares its field's label and id, so **array columns
  can only ever match exactly**, by ref (`phones.0.number`) or by generated header
  (`Phone / Number 1`). Confirmed by probe: headers `Phone 1 Number, Phone 2 Number` matched
  nothing.
- Exact matches are tagged `confidence: 'exact'` and loose ones `'guess'`.
- Generated headers ([import-columns.ts:314](../packages/core/src/import-columns.ts#L314)) are
  `Scope Label / … / Field Label`, plus `" ${index + 1}"` for array rows. Example:
  `Address / City`, `Phone / Number 1`.

### 3.4 Coercion (`coerceCell`)

Order: `null`/`undefined` → blank. **Typed cells first** (`coerceTypedCell`): a `Date` is read
by UTC components for `date`/`monthYear`/`time`, as ISO for `datetime`, and for any other type
as `YYYY-MM-DD` if it is midnight UTC, else ISO. Numbers pass through as-is for
`number`/`currency`, are scale-checked for `slider`/`rating`, and booleans pass for
`boolean`/`checkbox`. Then trimmed text, `''` → blank, and then by `field.type`:

| `field.type` | Rule |
|---|---|
| `number`, `currency` | Must match `NUMERIC` (allows `1,234.5`, exponents; rejects `0x10`, `1,2,3`); commas stripped |
| `slider`, `rating` | As number, then `checkScale` (`sliderBounds` / integer 1..`ratingScale`) |
| `color` | `normalizeHexColor` → `#RRGGBB` |
| `tags` | `normalizeTags(text.split(';'))` → `string[]` |
| `boolean`, `checkbox` | `true/t/yes/y/1`, `false/f/no/n/0` |
| `date` | `parseCalendarDate`: bare ISO read textually (no TZ shift, rejects `2024-02-30`), else `new Date(text)` local getters → `YYYY-MM-DD` |
| `datetime` | `new Date(text).toISOString()` |
| `monthYear` | `YYYY-M(M)` or any calendar date → `YYYY-MM` |
| `time` | `H:mm[:ss]` or UTC instant `…THH:mmZ` → `HH:mm` |
| `dropdown`, `radio` | `matchOption`: options = inline `field.options` or `lookups[field.listName]`. Match via `valuesMatch` (key, any-language label, canonical). **Returns the option object** (`DropdownOption = LocalizedText & { $key? }`), not the text. With no options available the text passes through |
| `multiSelect` | Split on `;`, each part `matchOption`ed → `DropdownOption[]` |
| everything else (`text`, `email`, `url`, `phone`, `entity-ref`, `markdown`, …) | Trimmed text |

`image`/`file` never reach coercion: they are `UNSUPPORTED_TYPES` in column derivation.

### 3.5 Where validation and rules run

All inside `validateImportedRecord`, per built record, after compaction and normalisation:

1. **Rules** (`evaluateRuleState`): for every tab, recursively,
   `evaluateFormRules(filterRulesForTab(rules, tab.id, config), getTabData(tab.id, record, config))`.
   This collects `hiddenFields` (bare field ids), adds every field of a `hiddenTabs` tab, and
   collects `validationErrors` keyed by field id. Rules are evaluated per tab on flat values,
   the way the renderer evaluates them. Skipped entirely when `rules` is empty.
2. For every `LeafTarget` (excluding `nested`):
   - skip if `hiddenIds.has(field.id)` (**by bare id**, so two same-id fields in different
     scopes are hidden together — unverified whether that is reachable after `validateConfig`);
   - skip if `!evaluateFieldVisibility(field, scopeValues)` (static `showWhen` against the
     field's scope object);
   - `applyFieldValidators`: `required`, `min`/`max` (numbers), `minLength`/`maxLength` (strings
     *and* arrays), `pattern`, `email` (approximation of Angular's regex), `url`, `phone`;
   - attach the rule's validation message, if any.
   - Array leaves are validated once per existing row at `${arrayRef}.${i}.${tail}`. An empty
     array is not a failure.
3. Not checked, by design: `validators.custom` / `customAsync` (Angular registries).

Plan-level validation (`validateMappingPlan`) runs before any row, in `applyMapping` and again,
earlier, in the server's `runImport` → `checkPlan`.

---

## 4. Readers and format sniffing

### 4.1 CSV in core ([csv.ts](../packages/core/src/csv.ts))

- A hand-written RFC 4180 state machine, `createCsvReader(): { push(chunk): string[][]; end(): string[][] }`.
  Lookahead state is carried across chunks as flags (`quoteHeld`, `crHeld`, `quoted`,
  `pending`), so it streams safely at any chunk boundary, including a `""` escape split
  across chunks, a `\r\n` split across chunks, and quoted newlines.
- **Comma only.** No delimiter option, so semicolon-CSV (common in EU Excel locales) and TSV
  are not handled by core.
- Strips a leading UTF-8 BOM. Malformed input is read as far as it goes and never throws.
- `parseCsv(text): SheetData` = one push + end. Row 0 becomes `headers`, and the rest are padded
  to header width with `padRow` (longer rows are kept long). Blank lines stay as `['']` rows,
  so row numbers stay aligned.
- `SheetData = { headers: string[]; rows: string[][] }`. Positional, never header-keyed.
- `toCsv`/`escapeFormula` are for templates. Formula-lead cells (`= + - @ \t \r`) get a `'`
  prefix, except numeric strings.

### 4.2 xlsx in the browser wizard

**There is no xlsx reader in the browser.** Neither the Angular package nor core has any
spreadsheet dependency, and that is deliberate (see the header of [sheet-parser.ts](../packages/ngx-dynamic-entity/src/lib/import/sheet-parser.ts)).

- The default `defaultSheetParser` accepts files whose name matches `/\.(csv|tsv|txt)$/i` and
  runs `parseCsv(await file.text())`. Other extensions are **refused by name**. A `File` with
  an empty name skips the check.
- Note: `.tsv` passes the extension check but is parsed as **comma**-separated, so a TSV file
  comes out as one column per row. The demo works around this with its own
  `demoSheetParser` ([demo-sheet-parser.ts](../packages/demo-angular/src/app/mock/demo-sheet-parser.ts)),
  which splits on tabs.
- xlsx in the browser has two routes, both consumer-chosen:
  1. register `SHEET_PARSER` (`provideNgxDynamicEntity({ sheetParser })`). The documented
     example uses SheetJS with `raw: false`, which turns every cell to text and therefore
     **loses typed cells**: the `Date`-at-UTC-midnight path in `coerceTypedCell` never fires,
     and dates are whatever SheetJS's formatter prints. The `SheetParser` type is `SheetData`,
     i.e. `string[][]`, so typed cells are not representable through this seam at all.
  2. register `provideHttpImportTransport({ baseUrl })`. The browser uploads the raw `File`
     as multipart, and the **server** reads it with exceljs.
- So the README's "exceljs on the server" is accurate, and it is the *only* first-party xlsx
  reader.

### 4.3 xlsx on the server ([xlsx-source.ts](../packages/server/src/xlsx-source.ts))

- Every byte goes through `guardZip` first, which validates and rebuilds the archive (bounded
  by `maxBytes`, compressed) before it is handed to exceljs. Internals of `guard-zip.ts` (549
  lines) were **not read in detail**, so its exact checks are unverified beyond the limits named
  in `limits.ts` (`maxUncompressedBytes` per the README).
- `ExcelJS.stream.xlsx.WorkbookReader` with `sharedStrings: 'cache'`, `styles: 'cache'` (so
  numeric date cells become `Date`), hyperlinks and entries ignored.
- **First worksheet only.** Blank rows that exceljs skips are put back as `[]`, so row numbers
  match the gutter. A row number past `maxRows` is refused *before* gap synthesis.
- `cellValue`: formula → its cached result (never the formula), richText → joined text, error
  cell → error text, hyperlink/other objects with `text` → text. Types are preserved (`Date`,
  `number`, `boolean`).
- Rows then pass `guardRows` (`maxRows`, `maxColumns`, `maxCellLength`, `padRow`). Headers go
  through `sampleText`, which renders a midnight-UTC `Date` as `YYYY-MM-DD`.

### 4.4 Format sniffing

**Server only, by magic bytes; the filename is display-only**
([read-sheet.ts:60](../packages/server/src/read-sheet.ts#L60)):

```ts
export function detectFormat(head: Uint8Array): SheetFormat {   // 'csv' | 'xlsx'
  // PK (50 4B)          → 'xlsx'   (any zip — a .docx would be sent to exceljs and fail as MALFORMED_FILE)
  // D0 CF 11 E0 (OLE2)  → throw UNSUPPORTED_FORMAT ("pre-2007 .xls")
  // FF FE / FE FF       → throw UNSUPPORTED_FORMAT ("UTF-16")
  // anything else       → 'csv'
}
```

The first 8 bytes are `peek`ed off a `limitBytes`-wrapped stream. CSV bytes are decoded with a
non-fatal streaming `TextDecoder('utf-8')`. The browser side does no sniffing, only the
extension regex above.

---

## 5. Gap check

### a) Target fields inside nested objects (`customer.address.city`) — **Yes**

- Two mechanisms produce nested refs. Structural nesting puts a `group` field (or a
  non-`flatData` tab) into the path. `refererField` overrides a leaf's ref with any dot path.
  ([field-scopes.ts:176](../packages/core/src/field-scopes.ts#L176), [import-columns.ts:97](../packages/core/src/import-columns.ts#L97))
- `setRecordValue` creates the intermediate objects
  ([import-engine.ts:112-128](../packages/core/src/import-engine.ts#L112-L128)).
- Probe: a root leaf with `refererField: 'customer.address.city'` imported as
  `{ customer: { address: { city: 'Paris' } } }`.
- **Caveat, a latent bug found while probing:** `refererField` on an **`array`** field breaks
  unrolling. `collectLeafTargets` takes array refs from `refOf` (the override), but child scopes
  come from the walk's `field.id`s. So the child's ref (`phones.number`) never has the array
  ref (`contact.phones`) as an ancestor, and it becomes a single non-repeating column. Probe
  output: columns `['customer.address.city', 'phones.number', 'kw']`, then
  `normalizeArrayStructures` wrapped the object into `phones: [{ number }]`. Same family as the
  `getTabData`/`normalizeArrayStructures` id-based walks in general: they do not honour
  `refererField`.

### b) Arrays of objects from numbered columns (`Phone 1 Number` → `phones[0]`) — **Partly**

What works:
- An `array` field's children unroll into `phones.0.number`, `phones.1.number`, …
  ([import-columns.ts:287-301](../packages/core/src/import-columns.ts#L287-L301)), and
  `setRecordValue` builds a real array.
- The plan decides the row bound (up to 1000).

What does not:
- **Header recognition is fixed to the engine's own spellings.** Only the ref (`phones.0.number`)
  or the generated header (`Phone / Number 1`, index *after* the label) match. `Phone 1 Number`,
  `Phone1 Number`, `Phone Number (2)` and `phone_2_number` match nothing, because loose matching
  is suppressed for every array column by the ambiguity guard (§3.3). Probe confirmed.
- **The wizard caps at 3 rows.** `ImportMapperComponent` and the transports' `preview` call
  `deriveImportColumns(config, { lang })` with the default `maxArrayRows: 3`
  ([import-mapper.component.ts:189](../packages/ngx-dynamic-entity/src/lib/import/import-mapper.component.ts#L189),
  [local-import-transport.ts:82](../packages/ngx-dynamic-entity/src/lib/import/local-import-transport.ts#L82),
  [run-import.ts:299](../packages/server/src/run-import.ts#L299)). A sheet with Phone 4 cannot
  be mapped through the UI. A hand-written plan can reach further, but the mapper's
  `ngOnChanges` rebuilds rows only from derived columns and its `toPlan` emits only those, so
  opening such a plan in the mapper would drop the extra entries (inferred from the code, not
  probed).
- **Row identity is not preserved.** `compactArrays` renumbers, so data in only "Phone 2"
  lands at `phones[0]` (probe confirmed). That is fine for lists and wrong when position means
  something.
- **No nested arrays** (`orders[].items[].sku`): reported as unsupported
  ([import-columns.ts:261-269](../packages/core/src/import-columns.ts#L261-L269)).

### c) Arrays of primitives split from one cell (`"a; b"` → `["a","b"]`) — **Partly**

- Only two field types split, and both use the hard-coded `MULTI_SEPARATOR = ';'`
  ([import-engine.ts:92](../packages/core/src/import-engine.ts#L92)). `tags` →
  `normalizeTags(text.split(';'))` → `string[]` (probe: `"a; b"` → `["a","b"]`). `multiSelect`
  → each part matched to an option → `DropdownOption[]`, so objects, not strings.
- No configurable separator, per plan entry or per field.
- An `array` field always yields **objects** (rows of `children`). There is no "array of
  `number`/`date`/enum-string" target, and no split for any other type.

### d) One-to-many: rows sharing a key merged into one record with a child array — **No**

- `applyMapping` is strictly one row → at most one record (`rows.forEach` builds a fresh
  `record` per row, [import-engine.ts:828-888](../packages/core/src/import-engine.ts#L828-L888)).
  Probe: two rows with the same name gave two records.
- No grouping key in `MappingPlan`, and nothing in core, server or the Angular package matches
  `groupBy`/key-column concepts.
- **Structural obstacle in the server:** `runImport` cuts the stream into fixed
  `batchSize` (500) chunks and calls `applyMapping` per chunk
  ([run-import.ts:177-238](../packages/server/src/run-import.ts#L177-L238)). A group that
  straddles a batch boundary would be split into two records. Grouping needs either
  sorted/contiguous input with group-aware flushing, or a buffer keyed by group, and the second
  breaks the bounded-memory guarantee the package exists for.
- Error reporting also assumes one row ↔ one record (`ImportRowError.row`, `failed` counts
  distinct rows), so a grouped record needs a row *range*.

### e) A target schema that is not an `EntityFormConfig` — **No**

- Every entry point is typed to it: `applyMapping(rows, plan, config: EntityFormConfig, …)`,
  `deriveImportColumns`, `validateMappingPlan`, `validateImportedRecord`, `collectLeafTargets`,
  `buildTemplateSpec`, `RunImportOptions.config`, `ImportRouterOptions.configs`,
  `ImportContext.config`, and every wizard component's `@Input config`.
- `coerceCell` dispatches on `NestedFieldConfig.type` (`RichFieldType`).
- **Workaround today:** synthesise an `EntityFormConfig` from the target schema (one
  `flatData` tab, `group` for objects, `array` for arrays of objects, `tags` for string arrays,
  `refererField` for arbitrary paths). This gets you a lot, but with real semantic mismatches:
  - enums come back as `DropdownOption` objects (`{ en: 'Gold' }`), not the JSON Schema
    string `"Gold"`;
  - `_configVersion` is stamped unless `stamp: false`;
  - every `array` becomes `[]` even when absent;
  - no primitive arrays except `string[]` via `tags`;
  - no nested arrays;
  - the `refererField`-on-array bug from (a).

---

## 6. Coupling and the proposed seam

### 6.1 Generic versus `EntityFormConfig`-specific

| Concern | Where | Generic? | Notes |
|---|---|---|---|
| CSV parse/emit, BOM, `padRow`, `escapeFormula` | `csv.ts` | **Generic** | Add a delimiter option on the way out |
| Byte streaming, limits, errors, zip guard, xlsx rows, `cellValue`, `sampleText`, `detectFormat`, `guardRows`, multipart | server `bytes`/`limits`/`errors`/`guard-zip`/`xlsx-source`/`cell-text`/`read-sheet`/`multipart` | **Generic** | `ImportErrorCode` names (`UNKNOWN_ENTITY`) are cosmetic |
| `MappingEntry` / `MappingPlan` structure | `import-model.types.ts` | **Mostly generic** | `entity` and `configVersion` are DE names, read only as warnings; rename to `target` / `schemaVersion` |
| `ImportRowError`, `ImportResult`, wire response shapes | model and wire types | **Generic** | `planProblems: ConfigProblem[]` is a generic `{level, path, message}` under a DE name |
| Dot-path write with numeric segments → arrays, unsafe-path guard | `setRecordValue`, `isUnsafePath` | **Generic** | |
| Hole/empty compaction | `compactArrays`, `isEmptyValue` | **Generic** | Make renumbering opt-out (see 5b) |
| Array index addressing, plan-derived bound | `formatArrayHeader`, `parseArrayHeader`, `arrayBoundOf`, `stripIndices`, `MAX_ARRAY_BOUND` | **Generic** | |
| Structural plan checks (shape, dup refs, column/constant exclusivity, unknown ref) | `validateMappingPlan` | **Generic given a target set** | Only the `entity`/`version` warnings are DE |
| Header normalisation, exact→loose two-pass claim, ambiguity guard | `suggestMapping` | **Generic algorithm** | Candidate keys come from `ImportColumn.field.label/id`, so parameterise the keys |
| Locale-safe primitive coercers (number shape, calendar date, datetime, time, month, boolean, typed-cell dates) | `coerceCell`/`coerceTypedCell` internals | **Generic logic, DE dispatch** | Keyed on `RichFieldType`; re-key on a neutral value kind |
| Batching + backpressure + capped error sampling | `runImport` | **Generic** | Calls `applyMapping` with DE args; make it adapter-generic |
| Template writing | `write-template.ts` | **Generic given headers + notes** | Consumes `TemplateSpec.columns[].header` |
| Wizard step flow, errors view, transport seam, HTTP transport | Angular | **Generic in shape** | All typed to `ImportContext.config: EntityFormConfig` |
| Target derivation: tab/`flatData`/group/array walk, `refererField`, readonly/systemDefault/visibility filters, `image`/`file` unsupported | `collectLeafTargets`, `deriveImportColumns`, `collectFieldScopes` | **DE-specific** | Becomes the DE adapter |
| Human headers from tab/group labels, `LocalizedText` resolution, format hints per `RichFieldType`, `hint` notes, sheet name from `config.name` | `headerFor`, `collectTabLabels`, `formatHint`, `enumValuesFor`, `buildTemplateSpec` | **DE-specific** | |
| Option matching: `DropdownOption`, `$key`, any-language `valuesMatch`, `listName` → `ImportLookups` | `optionsFor`, `matchOption` | **DE-specific** | The *idea* (enum resolve via an external list) is generic |
| Slider/rating scale, hex colour, tag normalisation, url/phone/email checks | `field-values.ts`, `checkScale` | **DE-specific vocabulary**, generic checks | |
| `FieldValidators` application | `applyFieldValidators` | **DE-specific** | JSON Schema's `minLength`, `pattern`, … overlap almost 1:1 |
| Rules engine per tab, hidden-field/tab relaxation of `required`, `showWhen` | `evaluateRuleState`, `evaluateFieldVisibility`, `getTabData`, `filterRulesForTab` | **DE-specific** | |
| `normalizeArrayStructures`, `stampRecord` (`_configVersion`) | form-logic, migration | **DE-specific** post-processing | |
| `LOOKUP_REGISTRY` loading; lookup boot check | `EntityImportComponent.loadLookups`, `express.checkLookups`/`listNamesOf` | **DE-specific** | |
| Preview display text | `formatDisplayValue(field.type, field.options, …)` | **DE-specific** | |

### 6.2 Proposed seam

The narrow waist is already `ImportColumn`. The engine only needs four things from a schema:

1. the list of addressable targets;
2. how to turn a cell into a value for one target;
3. what to do to a finished record (normalise, stamp);
4. how to judge a finished record.

Everything else is generic. Proposed interface (new, illustrative, not in the repo):

```ts
/** A neutral description of a value a cell can produce. The generic coercers dispatch on this. */
export type ValueKind =
  | { kind: 'string' }
  | { kind: 'number'; integer?: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'date' } | { kind: 'datetime' } | { kind: 'time' } | { kind: 'month' }
  | { kind: 'enum'; values: readonly unknown[]; match?: (cell: string, value: unknown) => boolean }
  | { kind: 'list'; of: ValueKind; separator?: string }      // gap (c): "a; b" -> ["a","b"]
  | { kind: 'custom' };                                       // adapter's own coerce() handles it

/** One addressable leaf. Replaces ImportColumn; `field` becomes adapter-owned `meta`. */
export interface ImportTarget<TMeta = unknown> {
  ref: string;                 // dot path, numeric segments for array rows — unchanged language
  shapeRef: string;            // ref with indices stripped (today's stripIndices)
  header: string;              // generated template header
  matchKeys?: readonly string[]; // loose candidates for suggestMapping (today: label + id)
  required: boolean;
  value: ValueKind;
  format?: string;             // help-row hint
  enumLabels?: string[];       // help-row "One of:"
  arrayRef?: string;           // repeating ancestor, when unrolled
  arrayIndex?: number;
  meta: TMeta;                 // NestedFieldConfig for the DE adapter; a JSON Schema node for JSON Schema
}

export interface TargetSet<TMeta = unknown> {
  targets: ImportTarget<TMeta>[];
  unsupported: { ref: string; reason: string; meta?: TMeta }[];
}

export interface SchemaAdapter<TMeta = unknown, TContext = unknown> {
  /** Identity for plan drift warnings (today: entity + configVersion). */
  readonly id: string;
  readonly version?: number;

  /** Today's deriveImportColumns. `maxArrayRows` still comes from the plan's own bound. */
  targets(options: { maxArrayRows: number; lang?: string; purpose: 'suggest' | 'apply' }): TargetSet<TMeta>;

  /** Optional override; default is the generic coercer for target.value. */
  coerce?(target: ImportTarget<TMeta>, raw: unknown, ctx: TContext): CoerceOutcome | null;

  /** Today's normalizeArrayStructures + stampRecord. Default: identity. */
  finalize?(record: Record<string, unknown>, ctx: TContext): Record<string, unknown>;

  /** Today's validateImportedRecord. Default: required + ValueKind bounds only. */
  validate?(record: Record<string, unknown>, ctx: TContext): RecordProblem[];
}

// Generic engine — the same algorithm as today, with `config` replaced by `adapter`:
export function applyMapping<M, C>(
  rows: readonly (readonly unknown[])[],
  plan: MappingPlan,
  adapter: SchemaAdapter<M, C>,
  ctx: C,
  options?: { firstRowNumber?: number },
): ImportResult;
```

Adapters, in order of effort:

- **`entityFormConfigAdapter(config, { rules, lookups })`.** Wraps `collectLeafTargets`/`deriveImportColumns`
  (`value` from `RichFieldType`, `meta = NestedFieldConfig`), delegates `coerce` to today's
  `coerceCell` (keeps `DropdownOption` objects and slider/rating/colour), `finalize` =
  `normalizeArrayStructures` + `stampRecord`, and `validate` = `validateImportedRecord`. This
  should be behaviour-identical, and the existing core specs (`import-engine.spec.ts`, the
  timezone specs, server `all-configs.spec.ts`) are the parity gate.
- **`jsonSchemaAdapter(schema)`.** `properties` recurse into the path, and `type: object`
  becomes a nested path. `type: array` with object `items` unrolls into numbered rows;
  primitive `items` becomes `{ kind: 'list' }`. `enum` maps to `enum` (storing the raw enum
  value, not an object). `format: date | date-time | time` map to the matching kinds, and
  `required[]` sets `required`. `validate` can optionally delegate to a JSON Schema validator
  such as Ajv. Ajv is **not** a current dependency, so this is a proposal.
- **`exampleJsonAdapter(sample)`.** Infers kinds from the example's values (and array lengths
  as a default `maxArrayRows`), with no `validate` beyond kind checks.

### 6.3 Plan v2 additions needed for gaps (b)–(d)

These change the persisted, wire-crossing contract, so settle them before moving code. Keep
them optional so every v1 plan stays valid:

```ts
interface MappingEntry {
  ref: string; column?: number; header?: string; constant?: unknown; confidence?: 'exact' | 'guess';
  split?: string;                    // (c) per-entry separator, overriding ValueKind.list.separator
}
interface MappingPlan {
  target: string;                    // was `entity`; read `entity` as an alias
  schemaVersion?: number;            // was `configVersion`; alias likewise
  sourceHeaders?: string[];
  entries: MappingEntry[];
  headerRow?: number;                // today fixed at 1
  group?: {                          // (d) one-to-many
    key: number[];                   // column indices whose values identify a record
    collect: string[];               // arrayRefs whose rows accumulate across the group's rows
    contiguous?: boolean;            // default true: required for the streaming runner
  };
}
```

For (b), header recognition should become a pluggable matcher in `suggestMapping`: for
unrolled targets, generate index-aware candidates (`{label} {n} {child}`,
`{label}{n}{child}`, `{child} ({n})`, …) rather than suppressing loose matching. The wizard
must stop hard-coding the default 3 rows, sizing from the sheet's headers instead.

For (d) on the server: with `contiguous: true`, flush only at a key change. A batch boundary
then means "carry the open group into the next batch", so memory stays bounded by the largest
group rather than the file. Also report errors with a `rows: [first, last]` range.

### 6.4 What moves versus what stays

**Move to a standalone package (e.g. `sheet-importer` core + `sheet-importer/node`):**

- `csv.ts` in full, plus a delimiter option.
- Generic model types: `MappingEntry`, `MappingPlan` (v2), `ImportRowError`, `ImportResult`,
  a renamed `PlanProblem` (`= ConfigProblem` shape), and the wire response types.
- `setRecordValue`, `isUnsafePath` (copied: it lives in form-logic today), `getValueByPath`,
  `compactArrays`, `isEmptyValue`.
- `formatArrayHeader`, `parseArrayHeader`, `arrayBoundOf`, `stripIndices`, `MAX_ARRAY_BOUND`.
- Generic coercers lifted from `coerceCell`/`coerceTypedCell`: `NUMERIC`, `parseCalendarDate`,
  `BARE_DATE`, `UTC_INSTANT`, the boolean sets and the typed-`Date` UTC rules. Dispatch on
  `ValueKind`.
- `suggestMapping`'s algorithm, with the candidate keys taken from `ImportTarget`.
- `validateMappingPlan`'s structural checks.
- `applyMapping` re-expressed over `SchemaAdapter`, plus grouping.
- The `SchemaAdapter`/`ImportTarget`/`ValueKind` contracts, and `jsonSchemaAdapter` and
  `exampleJsonAdapter`.
- From server: `bytes`, `limits`, `errors`, `guard-zip`, `xlsx-source`, `cell-text`,
  `read-sheet` (`detectFormat`, `guardRows`, `readSheet`), `multipart`, and `runImport` /
  `previewSheet` made adapter-generic. `write-template` would take
  `{ headers, notes, sheetName }`. The `exceljs`/`busboy` dependencies move with them.
- Optionally a framework-agnostic "transport" contract (today's `ImportTransport` with
  `ImportContext` generalised to `{ adapter, ctx }`). This is a design choice, not something
  the code forces.

**Stay in Dynamic Entity (as the `EntityFormConfig` adapter and its UI):**

- `collectLeafTargets`, `deriveImportColumns`, `headerFor`/`collectTabLabels`, `formatHint`,
  `enumValuesFor`, `buildTemplateSpec` (sheet name from `config.name`), `UNSUPPORTED_TYPES`
  for `image`/`file`.
- The DE side of `coerceCell`: `matchOption`/`optionsFor`, `DropdownOption`/`LocalizedText`,
  `ImportLookups` keyed by `listName`, `checkScale`, colour/tags normalisation, and the
  `multiSelect`-to-option-objects rule.
- `validateImportedRecord`, `applyFieldValidators`, `evaluateRuleState` and the rules engine,
  `evaluateFieldVisibility`, `normalizeArrayStructures`, `stampRecord`.
- The `entity`/`configVersion` drift warnings (as the adapter's `id`/`version`).
- `express.ts`'s DE wiring: `ConfigSource`, per-entity `rules`, `listNamesOf`/`checkLookups`,
  `templateFilename(config.entity)`. Alternatively keep a thin DE router over a generic router
  factory.
- All Angular components and tokens: `EntityImportComponent` (including the `LOOKUP_REGISTRY`
  loading), the mapper/preview/template components (they read `ImportColumn.field` and call
  `formatDisplayValue`), `SHEET_PARSER`, `IMPORT_TRANSPORT`, `LocalImportTransport`,
  `HttpImportTransport`. These would depend on the standalone package and pass
  `entityFormConfigAdapter(...)`. `ImportErrorsComponent` is the one component that is already
  generic.

### 6.5 Risks to plan for

1. **Plan contract migration.** Plans are persisted and posted (`readPlanField`). The rename
   needs read-aliasing, and adding `group`/`split` needs a server that refuses an unknown
   feature rather than ignoring it. Ignoring `group` would silently import N records instead
   of 1.
2. **Engine-version parity.** `ImportPreviewResponse.engineVersion` compares `CORE_VERSION` at
   major.minor. After extraction the version that matters is the importer package's, plus the
   adapter's. Two version stamps are needed.
3. **`refererField` on arrays** (§5a). Fix it, or define its semantics, before the DE adapter
   becomes the reference implementation, otherwise the bug is carried into the parity suite as
   "expected".
4. **Typed cells through the browser seam.** `SheetParser` returns `string[][]`, so typed
   xlsx cells are not representable in-browser. A generic package should widen it to
   `unknown[][]` (which `applyMapping` already accepts).
5. **`compactArrays` renumbering** must become a per-array choice, or numbered-column imports
   where position means something (Phone 1 = primary) lose meaning.

---

## Unverified / not read in full

- `guard-zip.ts` internals (only its export, its role and the limits names were read).
- `limits.ts` beyond the fields listed above, and `errors.ts`'s full `ImportErrorCode` union
  and status mapping.
- `rules-engine.ts` internals (`evaluateFormRules`, `filterRulesForTab`). They are described here
  only by how `import-engine.ts` calls them.
- Whether a config can reach `validateImportedRecord` with the same field id in two scopes
  (which the id-keyed `hiddenIds` would conflate) once `validateConfig` has run.
- The mapper dropping hand-written entries beyond the derived 3 rows, and `constant` entries,
  when a stored plan is loaded into it. This is inferred from `ngOnChanges`/`toPlan`
  (`toPlan` emits only column-sourced rows), not exercised.
- The Angular templates of the mapper/preview/template components (only their TypeScript
  logic and inputs were read).
