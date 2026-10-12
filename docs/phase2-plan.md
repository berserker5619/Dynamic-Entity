# Phase 2 plan: moving the import engine into sheet-to-schema

Status: approved by the owner on 2026-10-12, with the decisions below. Step 2 is under way.

Source of truth is `docs/import-phase1-spec.md`. This plan is based on the extraction analysis
(`docs/import-extraction-analysis.md`, §6.4) as corrected by the progress report
(`docs/import-progress-report.md`, §6) and by the spec. Where they disagree, the spec wins.

## Where things stand

- **Dynamic Entity 2.5.0** is the baseline. It has the date-order fix, so the engine that
  moves is the one that no longer guesses a date's order.
- **`packages/sheet-to-schema`** already holds the generic half, written in Phase 1 and private:
  plan v2 and `readPlan`, the adapter contracts and `validatePlan`, `coerceValue`,
  `applyMapping` with grouping, `suggestMapping` and the header grammar, `jsonSchemaAdapter`
  and `exampleJsonAdapter`. It has no file reader and no Node code.
- **`entityFormConfigAdapter`** exists in `@dynamic-entity/core`, unexported. Its parity spec
  holds it equal to 2.x's `applyMapping` on every shipped config.
- **Dynamic Entity still runs its own engine.** `applyMapping`, the server and the wizard do
  not use any of the above. Phase 2 is the switch.

So Phase 2 has less to move than analysis §6.4 lists. The generic engine is written. What
moves is the file-handling code, and what changes is which engine DE calls.

## Decisions

Settled by the owner on 2026-10-12. Each was put as a question in the first version of this
plan; the answer is what is recorded here.

### 1. One package, `sheet-to-schema`, with a `/node` subpath

Not the five `@sheet-to-schema/*` packages named on 11 October.

- The DE adapter cannot live under `@sheet-to-schema`. It imports DE, and DE's core
  re-exports the importer, so an adapter package outside DE makes a cycle. It lives in
  `@dynamic-entity/core`.
- There is no generic Angular code to package yet. Every Angular import component today reads
  `EntityFormConfig`. **The Phase 4 Angular mapper will be a separate package**, not a third
  entry of this one.
- `jsonSchemaAdapter` and `exampleJsonAdapter` stay in the main entry.

### 2. `@dynamic-entity/core` depends on `sheet-to-schema`

A real dependency, not a bundled copy. Core's first: it published with none until now, and
`MIGRATING-3.0.md` says so.

- **The range is exact for the release candidates, and `^1.0.0` at 3.0.0 final.** A caret
  range is safe there for two reasons. A consumer's tree then holds one engine, so a plan, a
  result or an `ImportFailure` built by one side is the same type on the other; a bundled
  copy or a pinned mismatch gives two. And every release of either package is gated by the
  monorepo's parity suite, which runs DE's own suites against the importer at the same
  commit, so a `sheet-to-schema` 1.x that breaks DE cannot be released.
- **Publishing order:** `sheet-to-schema` release candidate first, then any DE release
  candidate. DE cannot be installed otherwise.
- Core imports only the main entry, never `/node`. Step 4's bundle test proves it.

### 3. `exceljs` and `busboy` are optional peers of `sheet-to-schema`

And normal `dependencies` of `@dynamic-entity/server`, as today, so a DE server user
installs nothing new. A browser-only user of `sheet-to-schema` installs neither.

`/node` loads each one when it is first needed. A missing `exceljs` fails with a message
that says which package to install and why, and a test holds that.

### 4. `coerce` gets a fourth argument

`coerce(target, raw, ctx, cell?: { dateOrder?, split?, decimal? })`. Optional, so an adapter
written for three arguments still fits.

- **Precedence: the plan's entry, then the run's options, then the default.** The engine
  resolves it and hands the adapter the result.
- **2.5's options-level `dateOrder` keeps working**, as the run's default: an entry with no
  `dateOrder` is read with it.
- The DE adapter passes the resolved values to `coerceCell`. A v2 plan's per-column
  `dateOrder` therefore works on DE fields in 3.0.
- Spec §7 is updated in the same commit (2.8).

### 5. Grouping in the streaming runner is Phase 3

In Phase 2 the generic `runImport` refuses a plan with `group` before reading a row:
`INVALID_PLAN`, carrying a `PLAN_GROUP` problem whose message says this server version does
not support grouping yet, and that the browser path does.

### 6. A 3.0 server advertises `planVersions: [1, 2]`

It reads v2 plans: split lists, `dateOrder` and `lists` all work. `group` is refused as
decision 5 says, before any row is read, so nothing is half-imported.

### 7. DE's `MappingPlan` becomes the importer's v2 type

Decided for step 3:

- `MappingPlan`, exported from `@dynamic-entity/core`, is the importer's v2 type.
- The 2.x shape is exported as `MappingPlanV1`, deprecated.
- Every DE function that takes a plan accepts either, and normalises through `readPlan`.

Before 3.1 is written, every caller of a plan in core, the server and the wizard is read
against this. Anything that does not fit is reported, not worked around.

### 8. Smaller points, decided in this plan

- **`ImportTransport` and `ImportContext` stay DE-shaped.** Generalising them to
  `{ adapter, ctx }` belongs with the Phase 4 mapper. Analysis §6.4 calls it optional.
- **DE keeps its own `coerceCell`.** The generic coercers and DE's share ancestry and now
  differ on purpose (dates, email). Merging them is not part of a parity-gated move.
- **`ImportErrorCode` keeps `UNKNOWN_ENTITY`** in the generic router, meaning "no adapter for
  this name". Renaming a wire code is a break that buys nothing.
- **Version stamps** follow spec §9: `engineVersion` becomes the importer's version, and
  `adapterVersion` is added. DE's adapter reports `CORE_VERSION`.

## What moves into sheet-to-schema

### Main entry (`sheet-to-schema`): browser-safe, zero runtime dependencies

Already there from Phase 1, unchanged by Phase 2:

| Module | What it is |
| --- | --- |
| `plan.types`, `read-plan`, `validate-plan`, `plan-slots`, `problem-codes` | Plan v2, its reader and its checks |
| `adapter.types`, `result.types`, `import-failure` | The contracts |
| `coerce`, `date-order`, `cell-text` | Generic coercion |
| `apply-mapping`, `validate-record`, `record-path`, `safe-path` | The engine |
| `suggest`, `header-grammar` | Suggestion and slot sizing |
| `json-schema-adapter`, `example-json-adapter` | The two generic adapters |

Moving in from `@dynamic-entity/core`:

| From | What | Note |
| --- | --- | --- |
| `csv.ts` (333 lines) | `createCsvReader`, `parseCsv`, `toCsv`, `escapeFormula`, `padRow`, `detectDelimiter`, `completeFirstLine`, `decimalMarkFor`; types `CsvDelimiter`, `CsvReader`, `CsvReaderOptions`, `SheetData`, `SheetGrid` | Fully generic, no dependencies. Moves as it is, with its specs. |
| `cell-text.ts` | `cellText` | Already copied in Phase 1. Core's copy is deleted and re-exported. |
| `import-wire.types.ts` | `ImportPreviewResponse`, `ImportCommitResponse`, `ImportErrorResponse` | Moves with `planVersions`, `adapterVersion` and v2's `warnings` added (spec §9). Problems become `PlanProblem`, the same shape as `ConfigProblem`. |

Nothing else moves from core. `array-headers.ts` and the generic parts of `import-engine.ts`
and `import-columns.ts` were re-implemented in Phase 1, not moved, so the originals stay
until step 3 replaces their insides.

### `/node` subpath (`sheet-to-schema/node`): everything that needs Node

Moving in from `@dynamic-entity/server`:

| From | What | Coupling to DE today |
| --- | --- | --- |
| `bytes.ts` | `toByteStream`, `limitBytes`, `peek`, `destroySource`; `ByteSource` | None |
| `limits.ts` | `DEFAULT_LIMITS`, `resolveLimits`; `ImportLimits` | None. Gains `maxGroupRows`, `maxGroups`, `maxGroupKeyBytes` in Phase 3, with streaming grouping (decision 5). |
| `errors.ts` | `ImportError`, `toErrorBody`; `ImportErrorCode`, `ImportErrorBody` | None |
| `guard-zip.ts` | `guardZip` | None |
| `xlsx-source.ts` | `xlsxRows`, `cellValue` | None. Needs `exceljs`. |
| `read-sheet.ts` | `readSheet`, `detectFormat`, `guardRows`; `SheetFormat`, `SheetSource`, `ReadSheetOptions` | None |
| `multipart.ts` | `receiveUpload`, `readPlanField`, `safeFieldName` (internal) | None. Needs `busboy`. `readPlanField` hands the plan to `readPlan`. |
| `write-template.ts` | `writeTemplate`, `TEMPLATE_EXTENSION`, `TEMPLATE_MEDIA_TYPE`; `TemplateFormat` | Takes DE's `TemplateSpec`. The generic one takes `{ sheetName, headers, notes }`. |
| `run-import.ts` | `runImport`, `previewSheet` and their types | Takes `config`, `rules`, `lookups`. The generic one takes `{ adapter, ctx }`. |
| `express.ts` | A generic router factory | New, written from `createImportRouter` with the DE wiring taken out: it resolves an adapter and a context per request, where DE's resolves a config. |

`cell-text.ts` in the server is already an alias of core's and is dropped.

## What stays in Dynamic Entity

| Package | What stays | Why |
| --- | --- | --- |
| core | `collectLeafTargets`, `deriveImportColumns`, `buildTemplateSpec`, `upgradeLegacyRefs`, `legacyRefAliases`, `stripIndices`, `arrayBoundFor`, `inferArrayBound`, `DEFAULT_ARRAY_ROWS` | They read `EntityFormConfig`. They are what the adapter is made of. |
| core | `coerceCell` and everything under it: option matching, lookups by `listName`, rating and slider scales, colours, tags, the 2.5.0 date rule | DE's values are not generic values: an option is a `LocalizedText` object. |
| core | `validateImportedRecord`, the validators, rule evaluation, `recordShaper`, `stampRecord` | The form's contract. |
| core | `entityFormConfigAdapter`, now exported | The one place that knows both sides. |
| core | `applyMapping`, `suggestMapping`, `validateMappingPlan`, with their 2.x signatures | Public API. Their insides become the generic engine over the adapter (step 3). |
| server | `createImportRouter`, `listNamesOf`, `templateFilename`, `sendFailure`, `OnImport`, `ConfigSource`, `ImportRouterOptions`, and DE-signature `runImport`, `previewSheet`, `writeTemplate` | The DE wrapper: config per entity, rules per entity, the lookups startup check, template names. |
| ngx-dynamic-entity | Every import component, both transports, `SHEET_PARSER`, `IMPORT_TRANSPORT`, the contracts | All DE-shaped (decision 8). Their engine calls go through the adapter. |

## Public DE exports that become deprecated re-exports

Per Decision 2: kept through 3.x, marked `@deprecated` and pointing at `sheet-to-schema`,
removed in 4.0. Only exports whose code moves are on this list. An export that keeps a DE
signature is not deprecated; it is still DE's.

From `@dynamic-entity/core`, re-exporting `sheet-to-schema`:

| Export | Kind |
| --- | --- |
| `createCsvReader`, `parseCsv`, `toCsv`, `escapeFormula`, `padRow`, `detectDelimiter`, `completeFirstLine`, `decimalMarkFor` | functions |
| `CsvDelimiter`, `CsvReader`, `CsvReaderOptions`, `SheetData`, `SheetGrid` | types |
| `cellText` | function |
| `ImportPreviewResponse`, `ImportCommitResponse`, `ImportErrorResponse` | types |

From `@dynamic-entity/server`, re-exporting `sheet-to-schema/node`:

| Export | Kind |
| --- | --- |
| `DEFAULT_LIMITS`, `resolveLimits`, `ImportLimits` | limits |
| `ImportError`, `toErrorBody`, `ImportErrorCode`, `ImportErrorBody` | errors |
| `toByteStream`, `limitBytes`, `peek`, `destroySource`, `ByteSource` | bytes |
| `guardZip` | zip guard |
| `xlsxRows`, `cellValue` | xlsx |
| `readSheet`, `detectFormat`, `guardRows`, `SheetFormat`, `SheetSource`, `ReadSheetOptions` | reader |
| `sampleText` | already an alias of `cellText` |
| `TEMPLATE_EXTENSION`, `TEMPLATE_MEDIA_TYPE`, `TemplateFormat` | template constants |

Not deprecated, because they stay DE's with DE's signatures: `setRecordValue` (public, and
DE's own path guard), `applyMapping`, `suggestMapping`, `coerceCell`,
`validateImportedRecord`, `validateMappingPlan`, and the server's `runImport`,
`previewSheet`, `writeTemplate` and `createImportRouter`.

The plan and result types change as decision 7 says:

| Export | In 3.0 |
| --- | --- |
| `MappingPlan`, `MappingEntry` | The importer's v2 types, re-exported. Not deprecated: this is the type to write. |
| `MappingPlanV1` | New name for the 2.x shape (`entity`, `configVersion`), deprecated. Still accepted everywhere a plan is taken. |
| `ImportResult`, `ImportRowError` | The importer's, re-exported. They are the 2.x shapes plus optional fields, so code that reads or builds one still compiles (spec §9). |

## Order of work and commit list

One commit per line, straight to main, the full release gate after each, a push after each
green one. Nothing is tagged or published without your go.

### Step 2: the moves

DE is not touched in step 2. Each module is copied into `sheet-to-schema` with its tests,
and DE keeps running its own copy. That keeps every DE suite a fixed reference until step 3.

| # | Commit | Contents |
| --- | --- | --- |
| 2.1 | `feat(sheet-to-schema): csv in the main entry` | `csv.ts` and its specs; the wire types, generalised. |
| 2.2 | `build(sheet-to-schema): the /node entry` | Second tsup entry, `exports["./node"]`, `exceljs` and `busboy` as optional peers (decision 3), and `scripts/check-importer-bundle.mjs`: the main entry's bundle holds no `exceljs`, no `busboy`, no Node built-in. |
| 2.3 | `feat(sheet-to-schema/node): bytes, limits, errors, the zip guard` | With their specs. |
| 2.4 | `feat(sheet-to-schema/node): readSheet and the xlsx source` | With their specs and the workbook fixtures. A missing `exceljs` fails with an install message, and a test holds that. |
| 2.5 | `feat(sheet-to-schema/node): multipart and writeTemplate` | `writeTemplate` over `{ sheetName, headers, notes }`. |
| 2.6 | `feat(sheet-to-schema/node): runImport and previewSheet over an adapter` | The streaming runner, generic. Refuses a plan with `group` before reading a row (decision 5). Ported run-import specs, over the fixture adapter. |
| 2.7 | `feat(sheet-to-schema/node): a generic Express router factory` | Routes as today, an adapter per request, version stamps and `planVersions: [1, 2]` (decision 6). |
| 2.8 | `feat(sheet-to-schema): coerce sees the cell's options` | The fourth argument and its precedence (decision 4). Spec §7 updated in the same commit. |

### Step 3: DE on top of sheet-to-schema

| # | Commit | Contents |
| --- | --- | --- |
| 3.1 | `feat(core)!: the import engine is sheet-to-schema's` | Core depends on `sheet-to-schema` (decision 2). `entityFormConfigAdapter` is exported. `MappingPlan` becomes the v2 type and `MappingPlanV1` the deprecated 2.x one (decision 7). `applyMapping`, `suggestMapping` and `validateMappingPlan` take either and run the generic engine over the adapter. Core's `csv.ts` and `cell-text.ts` become deprecated re-exports. |
| 3.2 | `feat(server)!: a thin wrapper over the generic router` | `createImportRouter` builds an adapter per entity and delegates. The lookups startup check, per-entity configs and rules stay. The moved exports become deprecated re-exports. |
| 3.3 | `feat(ngx)!: the transports and the wizard use the adapter` | `LocalImportTransport`, the preview component and the mapper call the generic engine through the adapter. |

3.1 is the commit the parity gate is really about. If a DE suite fails there for a reason
other than the three allowed differences, I stop and report.

### Step 4: the parity gate

| # | Commit | Contents |
| --- | --- | --- |
| 4.1 | `test: the Phase 2 parity gate` | See "The gate" below. Scripts and CI wiring only. No expectation is adjusted to pass it. |

### Step 5: docs and versions

| # | Commit | Contents |
| --- | --- | --- |
| 5.1 | `docs: sheet-to-schema README and MIGRATING-3.0` | The README (what it is, the three list layouts, grouping, adapters, browser and `/node`) and `docs/MIGRATING-3.0.md` for DE users. |
| 5.2 | `release: sheet-to-schema 1.0.0-rc.1, Dynamic Entity 3.0.0-rc.1` | Both CHANGELOGs, the versions, DE's exact rc range on `sheet-to-schema` (decision 2). Then stop and report. Publishing, when the owner says go, is `sheet-to-schema` first. |

## The gate

A failure in any of these means stop and report.

1. **Every DE suite passes with its expectations unchanged**, except:
   - the new optional `code` and `rows` fields on errors, and `warnings` on results;
   - the one removal the spec allows: the second, "required" report of a field whose cell
     could not be read (Decision 16).
2. **Every parity prerequisite stays green**, with no `it.failing`: the shared preview
   fixture, the moved-container snapshots, the browser typed-parser tests in the timezone
   suite, the decimal-comma test, and the xlsx browser-and-server test.
3. **The bundle test.** The main entry of `sheet-to-schema`, and the built `@dynamic-entity/core`
   and `ngx-dynamic-entity`, contain no `exceljs`, no `busboy` and no Node built-in.
4. **No import cycle**, checked by a script over the built module graph of all packages.
   `sheet-to-schema` imports nothing from `@dynamic-entity/*`, which the lint rule already
   enforces.
5. **The acceptance test** against the prototype's fixtures still passes.

## Risks

1. **The switch in 3.1 is one commit and cannot be smaller.** `applyMapping` either runs the
   old engine or the new one. The parity spec already holds them equal on every shipped
   config, which is why I expect it to pass, but it has only been compared row by row, not
   through the server's batching or the wizard.
2. **Publishing order.** By decision 2, DE 3.0.0-rc.1 cannot be installed until
   `sheet-to-schema` 1.0.0-rc.1 is on npm. The name and the `@sheet-to-schema` scope are
   still unclaimed. `verify-consumer.mjs` and `verify-server-consumer.mjs` install packed
   tarballs and must learn to pack the importer as well. The release workflow publishes four
   folders and would need a fifth, added only on your go.
3. **Version stamps over HTTP.** A 3.0 wizard talking to a 2.5 server, or the reverse, during
   a rolling deploy. The spec's rules cover it (`planVersions` absent means v1, a v2-only plan
   is refused, anything else is downgraded), and step 3.3 has to implement and test each.
4. **Shared fixtures cross packages.** `core/test-fixtures` is imported by the server's and
   the wizard's specs by relative path. Tests that move to `sheet-to-schema` cannot import
   from DE, so the generic ones need their own fixtures and the DE ones stay put.
5. **The timezone gate.** `scripts/check-timezones.mjs` lists suites by path. Moved specs
   have to be re-listed, or the gate goes quiet without failing.
6. **2.5.0's `dateOrder` is run-level.** Until commit 2.8 lands, a DE import through the
   generic engine has one date order for the whole run. That matches 2.5.0. After 2.8 the
   run's order is the default and a plan entry's overrides it.
7. **What Phase 2 does not include**, so it is not mistaken for missing: the generic Angular
   mapper (Phase 4), a chosen header row (deferred), positional arrays for DE (Decision 5),
   storing moved containers once (Decision 9).
