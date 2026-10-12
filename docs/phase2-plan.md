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
| `ImportPreviewResponse`, `ImportErrorResponse` | types |
| `ImportCommitResponse` | type; not deprecated. The importer's, with `planProblems` as DE's `ConfigProblem[]`, since DE keeps its result types |

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
| `ImportResult`, `ImportRowError` | Still Dynamic Entity's own types (owner, 2026-10-12), with the optional fields the engine adds: `code` and `rows` on an error, `warnings` on a result. `planProblems` stays `ConfigProblem[]`. A type-level test holds that the importer's result and error are assignable to them. |

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
| 2.5 | `feat(sheet-to-schema/node): writeTemplate` | `writeTemplate` over `{ sheetName, headers, notes }`. |
| 2.6 | `feat(sheet-to-schema/node): runImport and previewSheet over an adapter` | The streaming runner, generic. Refuses a plan with `group` before reading a row (decision 5). Ported run-import specs, over the fixture adapter. |
| 2.7 | `feat(sheet-to-schema/node): a generic Express router factory` | Routes as today, an adapter per request, version stamps and `planVersions: [1, 2]` (decision 6). `multipart` moves here, with the router whose tests are its only tests. |
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
     could not be read (Decision 16);
   - the three changes of "The plan-type exception" below, and nothing else.
2. **Every parity prerequisite stays green**, with no `it.failing`: the shared preview
   fixture, the moved-container snapshots, the browser typed-parser tests in the timezone
   suite, the decimal-comma test, and the xlsx browser-and-server test.
3. **The bundle test.** The main entry of `sheet-to-schema`, and the built `@dynamic-entity/core`
   and `ngx-dynamic-entity`, contain no `exceljs`, no `busboy` and no Node built-in.
4. **No import cycle**, checked by a script over the built module graph of all packages.
   `sheet-to-schema` imports nothing from `@dynamic-entity/*`, which the lint rule already
   enforces.
5. **The acceptance test** against the prototype's fixtures still passes.

### The plan-type exception

Decision 7 makes `MappingPlan` the v2 type, and DE's own tests were written against the 2.x
one. The owner allowed exactly these changes to DE tests on 2026-10-12:

- **(a)** a type annotation `MappingPlan` becomes `MappingPlanV1` on a v1 literal;
- **(b)** `suggestion.entity` becomes `suggestion.target` in the three assertions that read it
  (`server/src/run-import.spec.ts`, twice, and `local-import-transport.spec.ts`);
- **(c)** a test asserting a plan problem's message text may assert its `code` and `path`
  instead, only where the generic message differs from DE's.

Rules that go with them:

- Every changed line is listed in its commit message.
- No value, count or behaviour may change. Anything else that fails is a stop and a report.
- **v1 fixtures stay v1 literals, with `entity`.** They are the proof that stored 2.x plans
  keep importing.
- One test is added: a v2 suggestion committed through the DE adapter gives the same records
  as the equivalent v1 plan.

### The exceptions recorded while writing 3.1

Each was put to the owner and decided on 2026-10-12. None changes a record, a count or what
a stored 2.x plan imports. Every changed test line is listed in the commit message of 3.1.

1. **A reserved-key ref is `PLAN_UNSAFE_PATH`.** 2.x reported a ref into `__proto__` as
   `PLAN_UNKNOWN_REF`. Two expectations change: the `a ref into __proto__` problem fixture,
   and `server/src/express.spec.ts` "a plan naming `__proto__` cannot pollute anything".
2. **`PLAN_PROBLEM_CODES` is a deprecated re-export of the importer's thirteen.** The six 2.x
   emitted are among them with the same meaning. The coverage test requires a fixture per
   code, so seven fixtures are added, one per newly reachable code: `PLAN_VERSION`,
   `PLAN_UNKNOWN_KEY`, `PLAN_ALIAS_CONFLICT`, `PLAN_ALIAS_USED`, `PLAN_SPLIT_TARGET`,
   `PLAN_LIST_OPTION`, `PLAN_GROUP`.
3. **Three snapshot lines change**, all message text in `problem-codes.coverage.spec.ts.snap`:
   the entity mismatch, the version mismatch and the reserved-key ref. The seven new fixtures
   add their own lines. "Adapter-supplied noun for problem messages" is on the spec's Later
   list, since the generic text says "schema" where DE said "config".
4. **`code: 'CELL_FORMAT'` on two shared parity fixtures** (`preview-parity.ts`,
   `xlsx-parity.ts`). They compare whole error objects, and every error has a code now.
5. **The wizard's contracts take a plan in either shape.** `ImportPreview.suggestion`, the
   `[plan]` inputs of the mapper and the preview, and `ImportTransport.commit` are typed
   `AnyMappingPlan`, because a 2.x server still sends the 2.x shape. `LocalImportTransport`
   narrows its own preview to v2, which it always makes. v1 literals in tests are cast or
   annotated `MappingPlanV1` (allowed change (a)). `readPlan` is re-exported from core.
6. **The mapper emits plan v2**: `target`, `schemaVersion`, `planVersion: 2`, and never the
   2.x names beside them. No existing assertion read the emitted plan's entity or version, so
   none changed; two tests are added for the emitted shape.
7. **The Phase 1 adapter spec compares against a record of 2.5.0, not against the old engine.**
   The old engine is gone, so the comparison it made would be the new code against itself.
   `scripts/generate-import-golden.mjs` ran the published `@dynamic-entity/core@2.5.0` over the
   spec's inputs (two cases per shipped config, seventeen written by hand, seven suggestions)
   and wrote inputs and results to `core/test-fixtures/import-golden-2.5.0.json`. The script
   refuses any other version. The file is a record: it is not regenerated to make a test pass.
8. **DE keeps its own result types** (see the table under "Public DE exports").
9. **"No entity named means this config" applies to 2.x plans only.** A v2 plan with no
   `target` is refused. One narrow allowance, flagged for the owner to veto: a v2 plan whose
   `target` is the empty string, which is what DE's two-argument `suggestMapping` writes, is
   read against the config in hand. Without it `array-headers.spec.ts` "suggest, then import"
   would fail, and so would any app calling `suggestMapping(headers, columns)`.
10. **A change to the importer, found by DE's suites:** a plan problem is reported at the
    name the plan used (`entity`, `configVersion` for a 2.x plan). `preparePlan` maps the
    reader's `target` and `schemaVersion` paths back; four tests in the importer hold it.

### What MIGRATING-3.0.md must say because of it

Six entries, for commit 5.1 (the first three from the plan-type exception, the rest from 3.1):

1. A suggested plan carries `target`, not `entity`.
2. Plan-problem messages changed. Match on `code`.
3. A plan saved by a 3.0 wizard is v2, so an app rolled back to 2.5 cannot read it. Talking
   to an older server over HTTP is different, and handled: the wizard sends such a server the
   plan in v1 form (commit 3.3).
4. A ref into a reserved key (`__proto__`, `constructor`, `prototype`) is reported as
   `PLAN_UNSAFE_PATH`, not `PLAN_UNKNOWN_REF`. `PLAN_PROBLEM_CODES` has thirteen codes.
5. App code that reads `preview.suggestion`, or takes a plan from storage, should normalise
   it with `readPlan` (exported from `@dynamic-entity/core`): it may be either shape.
6. `@dynamic-entity/core` has one dependency, `sheet-to-schema`. The CSV functions,
   `cellText` and two of the wire types are deprecated re-exports of it, removed in 4.0.

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

## Progress

One line per commit, added as each lands with its gate green.

| Commit | Done | Note |
| --- | --- | --- |
| 2.1 | 2026-10-12 | `csv.ts` copied unchanged, with its two specs; the one spec that used DE's coercer for the decimal comma now uses `coerceValue`. Wire types in `wire.types.ts`, with `planVersions`, `adapter`, `slots`, `warnings`, `warningCount` and `rowsInImported` added as optional fields. |
| 2.2 | 2026-10-12 | `sheet-to-schema/node` builds as a second entry and imports the main entry by the package's own name, so it carries no second copy of the engine. `exceljs`, `busboy` and `express` are optional peers; `loadOptional` turns a missing one into an install message. `scripts/check-importer-bundle.mjs` holds both entries to what they may import, and two lint rules hold the sources to it. |
| 2.3 | 2026-10-12 | `bytes`, `limits`, `errors` and `guard-zip` copied with their specs; only comments that named Dynamic Entity were reworded. The stream helpers and the workbook builders move as `sheet.fixtures.ts` and `workbook.fixtures.ts`, without DE's config. Coverage has two bars: the main entry keeps 95/90/100/95, and `src/node` keeps the 90/80/100/90 it was held to in `@dynamic-entity/server`. |
| 2.4 | 2026-10-12 | `read-sheet` and `xlsx-source` copied; the reader takes the CSV parser and `cellText` from the main entry. `exceljs` is loaded when a workbook is first read, before the block that calls any failure an unreadable workbook, so a missing package is never blamed on the file. `xlsx-missing.spec.ts` holds the install message, and that a CSV still reads without it. Three xlsx tests that need the runner are held back for 2.6. |
| 2.5 | 2026-10-12 | `writeTemplate` takes a `TemplateSheet` (`sheetName`, `headers`, `notes?`) where DE's took a `TemplateSpec`. `exceljs` is loaded only for a workbook. Its spec is ported, with a test that each note lands on its header cell. **A change to the commit list:** `multipart` has no test of its own, only the router's, so it moves to 2.7 and does not land untested here. |
| 2.6 | 2026-10-12 | `runImport` and `previewSheet` take `{ adapter, ctx }`. The plan is read, upgraded and checked once, before any row; each batch runs the main entry's `applyMapping`. A plan with `group` is refused before a row is read: `INVALID_PLAN` (HTTP 400, as that code already is), with a `PLAN_GROUP` problem saying the browser import does group. The result gains `warnings`, `warningCount` and `rowsInImported`; the preview reports per-array `slots`. The preview suggests from headers alone, so it never proposes a group this runner would refuse. The server spec is ported over a JSON Schema adapter with the same fields as DE's test config; the parts built from DE configs stay in DE. |
| 2.7 | 2026-10-12 | `createImportRouter(router, { bindings, onImport, limits, lang })`: the four routes, on a router the caller makes, so `/node` never imports `express` itself. A binding is `{ adapter, ctx, kind?, template?, previewExtras? }`, from a map or a function that sees the request. Every answer is stamped with `engineVersion` (the importer's), `adapter` and, on a preview, `planVersions: [1, 2]`. `multipart` lands here with the router's tests. **Found while doing it:** `busboy` was imported when `/node` loaded, which would have made reading a CSV need it. It is now loaded on the first upload, and the bundle check fails on a static import of any optional peer. One ported expectation changed: a reserved-key ref is `PLAN_UNSAFE_PATH`, the reader's own code, where DE 2.x reports an unknown ref. |
| 3.3 | 2026-10-12 | The wizard's engine calls already went through the adapter after 3.1, since core's `applyMapping` and `suggestMapping` are the generic engine over it; what was left is the wire. `planForServer(plan, planVersions)` is in sheet-to-schema's main entry (with `v2OnlyFields`, which the plan reader now shares) and re-exported from core. `HttpImportTransport` remembers the `planVersions` each preview reported and, before a byte of a commit is sent: sends plan v2 as written to a server that lists 2; sends the same mapping in 2.x form (`entity`, `configVersion`, no `planVersion`) to one that does not; and refuses a plan using `group`, `lists`, or an entry's `split` or `dateOrder`, naming them and saying the server needs upgrading. A file it never previewed is treated as a 2.x server's. It warns when the server's `adapter` stamp is not `dynamic-entity` at this major version, and passes a 3.0 server's `warnings` through. The review step reads each column in its plan entry's `dateOrder`, falling back to the run's, as the commit does. No existing ngx test changed. **Not done, and not in Phase 2:** the wizard shows no warnings of its own, and the mapper cannot build a group (Phase 4). |
| 3.2 | 2026-10-12 | `@dynamic-entity/server` is sheet-to-schema's runner and router with a config behind each name. `bytes`, `errors`, `limits`, `guard-zip`, `xlsx-source`, `read-sheet` and the template constants are deprecated re-exports of `sheet-to-schema/node` (the same objects: `ImportError` is one class). `runImport`, `previewSheet`, `writeTemplate` and `createImportRouter` keep their signatures. Every 2.x server suite passes with no expectation changed. A plan that groups rows is now refused with `INVALID_PLAN` (decision 5); answers gain `adapter`, `planVersions`, `slots`, `warnings`, `warningCount` and `rowsInImported`. **The generic router gained five things so a wrapper can keep its wire contract**, each tested there: `param` (DE's writers read `request.params.entity`), `engineVersion`, a binding's `templateName`, a binding's `plan` hook (a 2.x plan naming no entity), and `previewExtras` may restate `suggestion` (DE answers with the suggestion the browser makes, sized by `arrayBoundFor`, so the two sides agree). `/node` also exports the multipart reader, and core exports `planForConfig`. **For the owner to confirm or reverse: `engineVersion` on a DE server stays `CORE_VERSION`.** Spec §9 says it is the importer's version. But every DE client, 2.x and this one, compares it with its own `CORE_VERSION`, and a 2.5 wizard reads a value below 2.5.0 as "this server reads dates month first": a 3.0 server answering `1.0.0` would be told that about itself. The importer's version of a DE server follows from the `adapter` stamp, `{ name: 'dynamic-entity', version }`. One line in `express.ts` if reversed. **Test wiring:** the server's Jest reads sheet-to-schema from source, because its built CommonJS entry loads `exceljs` with a real `import()`, which Node runs and Jest's sandbox does not; the built packages are run from tarballs by `verify-server-consumer.mjs`. |
| 3.1 | 2026-10-12 | Core depends on `sheet-to-schema` and its `applyMapping`, `suggestMapping` and `validateMappingPlan` are the generic engine, suggester and plan checks over `entityFormConfigAdapter`, which is exported. The DE-specific code is in `import-internals.ts` and `import-derive.ts`; `import-engine.ts` and `import-columns.ts` keep their names and exports. `MappingPlan` is plan v2, `MappingPlanV1` the deprecated 2.x shape, and every function that takes a plan takes either. `csv.ts`, `cell-text.ts` and the preview and error wire types are deprecated re-exports; the commit response is the importer's with DE's `ConfigProblem[]`. The wizard's contracts take either shape and the mapper emits v2. The consumer-install scripts pack the importer too, and take `--no-build`. Ten exceptions, each decided by the owner, are listed under "The exceptions recorded while writing 3.1". |
| 2.8 | 2026-10-12 | `coerce(target, raw, ctx, cell)`, with `cell: { dateOrder?, split?, decimal? }` resolved by the engine as plan entry, then run option, then default, and handed to the generic coercer too. `applyMapping`, `runImport` and the router gain a run-level `dateOrder`; a preview reports the router's. The DE adapter reads with `cell` and falls back to its context, so a v2 plan's per-column `dateOrder` works on DE fields and 2.5.0's options-level one stays the default. Spec §7 and §8 updated in the same commit. **Step 2 is complete.** |
