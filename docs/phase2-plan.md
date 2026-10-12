# Phase 2 plan: moving the import engine into sheet-to-schema

Status: for review, written 2026-10-12. Nothing in it has been done. Steps 2 to 5 wait for a go.

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

## Decisions I need from you

Ranked by how much each one changes the work. My recommendation is first in each.

### 1. One package with a `/node` subpath, or five scoped packages

Your instructions differ. On 11 October: packages under the `@sheet-to-schema` scope (`core`,
`angular`, `node`, `adapter-json-schema`, `adapter-dynamic-entity`). In the Phase 2 go: one
package, `sheet-to-schema`, with a browser-safe main entry and a `/node` subpath, the DE
adapter in `@dynamic-entity/core`, and one version, `1.0.0-rc.1`.

**This plan follows the Phase 2 go: one package.** Reasons:

- The DE adapter cannot live under `@sheet-to-schema`. It imports DE, and DE's core re-exports
  the importer, so an adapter package outside DE makes a cycle or forces a third package to
  break it. The spec already puts it in core ("Package boundaries").
- There is no generic Angular code to put in an `angular` package. The generic mapper is
  Phase 4. Every Angular import component today reads `EntityFormConfig`.
- `jsonSchemaAdapter` is 330 lines with no dependencies. A package of its own buys nothing.

If you want the five-package layout anyway, say so before step 2: it changes every import
path, the build graph and the commit list. Decision 1 in the spec gets rewritten to match
whichever you choose.

### 2. `@dynamic-entity/core` gains its first runtime dependency

Core publishes today with zero dependencies. To re-export moved functions it must depend on
`sheet-to-schema`. Two ways:

- **A real dependency, exact range (recommended).** One copy of the engine in a consumer's
  tree, so a plan or a result built by one side is the same type on the other. It means
  `sheet-to-schema` has to be on npm before any DE 3.0 release candidate can be installed.
- Bundle it into core's `dist`. No new dependency, but two copies of the engine whenever a
  consumer also installs `sheet-to-schema` directly, and `instanceof ImportFailure` then fails
  across them.

Either way the browser guarantee holds: core imports only the main entry, never `/node`.
Step 4's bundle test proves it.

### 3. `exceljs` and `busboy`: where they are declared

They are `dependencies` of `@dynamic-entity/server` today. In one package with a `/node`
subpath, declaring them as `dependencies` installs them for every browser-only user.

- **Optional peer dependencies of `sheet-to-schema` (recommended)**, with a clear error from
  `/node` when one is missing. `@dynamic-entity/server` keeps them as its own `dependencies`,
  so DE server users install nothing new.
- Plain `dependencies`: simpler, heavier for browser users. This is the main cost of
  decision 1's single package.

### 4. The adapter's `coerce` cannot see per-column options

`SchemaAdapter.coerce(target, raw, ctx)` gets the run's context, not the entry. So a v2
entry's `dateOrder` and `split`, and the engine's `decimal`, never reach an adapter that reads
its own cells, which the DE adapter does. Today DE gets `decimal` and `dateOrder` through its
context only, one value for the whole run.

- **Add an optional fourth argument (recommended):**
  `coerce(target, raw, ctx, cell?: { decimal?, split?, dateOrder? })`. Additive. The DE
  adapter then honours `entry.dateOrder` per column, falling back to the run's. This is what
  makes plan v2's per-column date order work for DE in 3.0.
- Leave it. DE 3.0 then has run-level `dateOrder` only, as 2.5.0 does, and a v2 plan's
  per-column order is silently unused on DE targets. I do not recommend shipping that.

This is a change to spec §7, so it needs your word.

### 5. Grouping in the streaming runner: Phase 2 or Phase 3

The spec's scope line gives grouping to Phase 3, and Phase 1 then built it for the in-memory
`applyMapping`. The streaming `runImport` has none. Spec §5 specifies it: contiguous groups
across batch boundaries, with `maxGroupRows`, `maxGroups` and `maxGroupKeyBytes`.

- **Phase 3 (recommended).** In Phase 2 the generic `runImport` refuses a plan with `group`
  before reading a row, with `INVALID_PLAN` carrying a `PLAN_GROUP` problem that says so.
  Phase 2 is then a move with a parity gate, and nothing new can hide in it.
- Phase 2. About one more commit and its tests. It makes the parity gate harder to read,
  because the runner changes shape in the same step that it moves.

Whichever you choose, a preview must not advertise what the server cannot do. See decision 6.

### 6. What a 3.0 server advertises

Spec §9 has previews carry `planVersions`. A server that reads v2 plans but refuses `group`
is not what `planVersions: [1, 2]` promises a client.

- **Advertise `[1, 2]` and refuse `group` with `PLAN_GROUP` (recommended)**, if decision 5 is
  Phase 3. Split lists, `dateOrder` and `lists` all work. The refusal is before any row is
  read, so nothing is half-imported. The client-side check in the spec stays as written.
- Advertise `[1]` until grouping lands. Then no v2 feature is usable over HTTP in 3.0.

### 7. Smaller points, decided here unless you object

- **`ImportTransport` and `ImportContext` stay DE-shaped.** Generalising them to
  `{ adapter, ctx }` belongs with the generic mapper in Phase 4. Analysis §6.4 calls it
  optional.
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
| `limits.ts` | `DEFAULT_LIMITS`, `resolveLimits`; `ImportLimits` | None. Gains `maxGroupRows`, `maxGroups`, `maxGroupKeyBytes` when grouping lands (decision 5). |
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
| ngx-dynamic-entity | Every import component, both transports, `SHEET_PARSER`, `IMPORT_TRANSPORT`, the contracts | All DE-shaped (decision 7). Their engine calls go through the adapter. |

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
DE's own path guard), `MappingPlan`, `MappingEntry`, `ImportResult`, `ImportRowError` (DE's
2.x types stay, and gain the optional v2 fields), `applyMapping`, `suggestMapping`,
`coerceCell`, `validateImportedRecord`, `validateMappingPlan`, and the server's `runImport`,
`previewSheet`, `writeTemplate` and `createImportRouter`.

One I am unsure about and will settle in step 3 by reading every caller: whether DE's
`MappingPlan` type can simply become the importer's. The importer's requires `target`, DE's
requires `entity`. If they cannot be one type, DE's stays and the adapter reads it through
`readPlan`'s v1 aliases, which is what the parity spec does today.

## Order of work and commit list

One commit per line, straight to main, the full release gate after each, a push after each
green one. Nothing is tagged or published without your go.

### Step 2: the moves

DE is not touched in step 2. Each module is copied into `sheet-to-schema` with its tests,
and DE keeps running its own copy. That keeps every DE suite a fixed reference until step 3.

| # | Commit | Contents |
| --- | --- | --- |
| 2.1 | `feat(sheet-to-schema): csv in the main entry` | `csv.ts` and its specs; the wire types, generalised. |
| 2.2 | `build(sheet-to-schema): the /node entry` | Second tsup entry, `exports["./node"]`, the dependency declaration from decision 3, and `scripts/check-importer-bundle.mjs`: the main entry's bundle holds no `exceljs`, no `busboy`, no Node built-in. |
| 2.3 | `feat(sheet-to-schema/node): bytes, limits, errors, the zip guard` | With their specs. |
| 2.4 | `feat(sheet-to-schema/node): readSheet and the xlsx source` | With their specs and the workbook fixtures. |
| 2.5 | `feat(sheet-to-schema/node): multipart and writeTemplate` | `writeTemplate` over `{ sheetName, headers, notes }`. |
| 2.6 | `feat(sheet-to-schema/node): runImport and previewSheet over an adapter` | The streaming runner, generic. Refuses `group` or implements it, per decision 5. Ported run-import specs, over the fixture adapter. |
| 2.7 | `feat(sheet-to-schema/node): a generic Express router factory` | Routes as today, an adapter per request, version stamps and `planVersions`. |
| 2.8 | `feat(sheet-to-schema): coerce sees the cell's options` | Only if decision 4 is yes. Spec §7 updated in the same commit. |

### Step 3: DE on top of sheet-to-schema

| # | Commit | Contents |
| --- | --- | --- |
| 3.1 | `feat(core)!: the import engine is sheet-to-schema's` | Core depends on `sheet-to-schema` (decision 2). `entityFormConfigAdapter` is exported. `applyMapping`, `suggestMapping` and `validateMappingPlan` keep their signatures and run the generic engine over the adapter. Core's `csv.ts` and `cell-text.ts` become deprecated re-exports. |
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
| 5.2 | `release: sheet-to-schema 1.0.0-rc.1, Dynamic Entity 3.0.0-rc.1` | Both CHANGELOGs, the versions, DE's exact rc range on `sheet-to-schema`. Then stop and report. |

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
2. **Publishing order.** With decision 2 as recommended, DE 3.0.0-rc.1 cannot be installed
   until `sheet-to-schema` 1.0.0-rc.1 is on npm. The name and the `@sheet-to-schema` scope are
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
6. **2.5.0's `dateOrder` is run-level.** Until decision 4 lands, a DE import through the
   generic engine has one date order for the whole run. That matches 2.5.0, so it is not a
   regression, but it is less than plan v2 promises.
7. **What Phase 2 does not include**, so it is not mistaken for missing: the generic Angular
   mapper (Phase 4), a chosen header row (deferred), positional arrays for DE (Decision 5),
   storing moved containers once (Decision 9).

## What I need to start step 2

Answers to decisions 1 to 6. With the recommendations as given, step 2 is commits 2.1 to 2.8
with 2.6 refusing `group`, and step 3 is 3.1 to 3.3.
