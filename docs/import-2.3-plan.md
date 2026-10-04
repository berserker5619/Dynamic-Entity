# Dynamic Entity 2.3 — import fixes: implementation plan

**Input:** the "Dynamic Entity 2.3 — Import Fix Specs" issue set (Oct 4, 2026) and the review
of it against `fb095e8` (core `2.2.0`). This plan corrects that spec where the review found it
wrong, adds one issue the review found, and orders the work so that every step can ship on its own.

**Ground rules**

- Commit straight to `main`, one commit per step. Each commit leaves `npm test` green across
  all packages.
- Nothing changes the *shape* of `MappingPlan`. Where a stored plan's *contents* stop
  resolving, the step says so and ships an alias or a migration note.
- Every behaviour change starts with a failing spec, so no step relies on inference.
- Effort: S ≈ ½ day, M ≈ 1–2 days, L ≈ 3+ days.

## Order at a glance

| Step | What | Packages | Effort | Depends on |
|---|---|---|---|---|
| 0 | Parity baseline: freeze today's derived columns | core, server | S | — |
| 1 | `refererField` on containers (corrected Issue 1) | core | M | 0 |
| 2 | Rules and `showWhen` by ref during import (new; absorbs 7c) | core | M | 0 |
| 3 | Shared array-header grammar + numbered-header suggestion (Issue 4) | core | M | 1 |
| 4 | Slot sizing from the sheet; mapper keeps plan entries (Issue 5) | core, ngx, server | L | 3 |
| 5 | Delimiter detection + decimal-comma guard (Issue 6) | core, ngx, server, demo | M | 0 |
| 6 | Typed cells through `SheetParser` (Issue 3) | core, ngx, docs | M | 0 |
| 7 | Small fixes: 7a, 7b, 7d | core, server | M | 0 |
| 8 | Release 2.3.0 | all | S | 1–7 |
| — | Positional arrays (Issue 2) | — | — | **Deferred to plan v2** |

Steps 5, 6 and 7 do not depend on each other or on 1–4, so they can be done in any order or in
parallel.

---

## Step 0 — Parity baseline

**Why:** Steps 1–3 change how columns are derived. The extraction will later treat today's specs
as its parity suite, so record exactly what today derives before anything moves.

1. In `server/src/all-configs.spec.ts`, add a snapshot of
   `deriveImportColumns(config, { maxArrayRows: 3 })` for every config in `test_data.json`:
   `ref`, `header`, `required`, `arrayIndex`, plus `unsupported`.
2. In `core/src/import-columns.spec.ts`, add three hand-built fixtures that `test_data.json`
   does not cover: (a) an array with an authored override ref, (b) a group with an override ref,
   (c) a config as the builder saves it, with refs stamped on every field
   (`assignFieldRefs`).

**Done when:** the snapshots are committed and green. Any later diff to them must be deliberate
and explained in that step's commit.

## Step 1 — `refererField` on containers (corrected Issue 1)

**Corrections to the spec**

- An *override* is a `refererField` that differs from the field's positional ref
  (`fieldRefFor(positionalScope, id)`). Presence alone means nothing: the builder stamps a
  ref on every field and treats any loaded ref as authored.
- Do **not** change `getTabData`. The renderer depends on it, and the renderer already writes a
  tab-level field to both its own position and its override (`extractRecord`) and reads the
  override first (`patchForm`). Import only has to write where `patchForm` reads.

**Decision (recommended):** honour an override on an `array` or `group` exactly where the
renderer does, on **tab-level** fields. An override on a container nested inside a group is
ignored by the renderer today, so `validateConfig` warns about it rather than import inventing a
meaning for it.

**Work**

1. `core/src/field-scopes.ts`: add `effectiveRefs(config)`. It walks once and computes each
   field's effective ref: the parent container's effective ref (when that container has an
   honoured override) plus the child id. A child's own stamped positional ref is ignored and
   rebased.
2. `core/src/import-columns.ts`: `collectLeafTargets` uses `effectiveRefs` for both `arrayRefs`
   and leaf refs, so `contact.phones.0.number` is derived.
3. `core/src/import-engine.ts`: after `normalizeArrayStructures`, normalise every override
   array at its effective ref (`[]` when absent).
4. `core/src/validate-config.ts`:
   - `REFERER_INSIDE_ARRAY` (error): a field inside an array whose `refererField` is an
     override, i.e. not equal to its positional ref and not equal to its rebased ref.
   - `REFERER_OVERRIDE_IGNORED` (warning): an override on a container that is not tab-level.
5. **Plan compatibility:** in `validateMappingPlan`/`applyMapping`, resolve an un-indexed
   legacy ref (`phones.number`, as derived by 2.2) to slot 0 of its new ref and report a
   `warning`, not an error. Remove the alias in 3.0. Add a changelog line.

**Specs**

- Override array `contact.phones` → `contact.phones.0.number … .2.number`; two slots import as
  `{ contact: { phones: [{…}, {…}] } }`.
- Same for a group override (`customer` → `customer.city`).
- A builder-stamped config (fixture c) gets **zero** `REFERER_INSIDE_ARRAY` errors.
- A hand-written child override inside an array gets the error.
- Renderer round-trip in `ngx-dynamic-entity` (`form-structure.service.spec.ts`): patch the
  imported record, extract it, and the override location holds the same rows.
- A 2.2 plan with `phones.number` still imports, with a warning.
- Step 0 snapshots unchanged for every config without overrides.

## Step 2 — Rules and `showWhen` by ref during import (new issue)

**Problem (probed):** the builder authors rule triggers and targets as `[tab.field]` tokens.
`evaluateRuleState` passes `getTabData` (an object keyed by bare id) to `evaluateFormRules`, so
the trigger never resolves. It then checks `hiddenIds.has(field.id)`, so a `[ref]` target never
matches. Result: hidden required fields reject valid rows. Bare-id rules work. 7c's question is
already answered: duplicate ids across scopes are allowed by design.

**Work**

1. Move the renderer's value-map rule into core:
   `flattenScopeValues(record, entries): Record<string, unknown>`. Each field appears under its
   bare id and under `toRefToken(effectiveRef)`, the same as
   `FormStructureService.flattenValues`. Make the renderer delegate to it so the two cannot
   drift; the renderer keeps reading values from controls and passes them in.
2. `evaluateRuleState` builds that map per tab from `fieldsUnderTab(config, tab.id)` and
   evaluates against it.
3. Key hidden state by both name forms. A field is hidden if `hidden` contains its bare id
   *and* the id is not ambiguous (`ambiguousFieldIds`), or if it contains its ref token.
   Rule validation messages get the same treatment.
4. `evaluateFieldVisibility` for each leaf gets the same flat map, so `showWhen` keys written
   as `[ref]` resolve.

**Specs:** the probe from the review as a spec (ref-token hide relaxes `required`); two `city`
fields in different groups with a ref rule hiding one; a bare-id rule on an ambiguous id hides
neither (and `validateConfig` already flags it); a `[ref]` `showWhen` key; the renderer's rule
specs unchanged.

## Step 3 — Shared array-header grammar (Issue 4)

**Work**

1. `core/src/array-headers.ts` (new, internal): one grammar used for matching and, in step 4,
   for inferring the bound.
   - `slotPatterns(arrayLabel, childLabel, childId, singleChild)` returns normalised templates
     with a slot placeholder: `A n C`, `A C n`, `C n`, `C (n)`, `A n` (single-child only), each
     also with `childId`.
   - `matchSlot(normalisedHeader, pattern): number | null` extracts `n`.
   - The singular form is only the trivial `-s` strip. Labels resolve in the `lang` passed in.
2. `ImportColumn.arrayLabel?: string`, set in `deriveImportColumns`.
3. `suggestMapping`: an exact pass, unchanged; then a loose pass over plain candidates plus
   `matchSlot` hits. The ambiguity guard applies per (pattern, slot): any key that answers to
   more than one column is dropped. Every loose hit is `confidence: 'guess'`.

**Specs:** every acceptance case in Issue 4, including `Number 1` being ambiguous between
`phones` and `faxes`; existing `suggestMapping` specs unchanged.

## Step 4 — Slot sizing and mapper round-trip (Issue 5)

1. **Reproduce first** (`import-mapper.component.spec.ts`): load a plan with
   `phones.4.number` and one `constant`, emit, compare. The result decides whether
   items 4–5 below are a fix or only a guard spec.
2. `inferArrayBound(headers, config, lang?)` in core. It applies `matchSlot` from step 3 to every
   header, plus `parseArrayHeader` for ref-spelled headers. It never enumerates slots. It is
   clamped to `[1, MAX_ARRAY_BOUND]`.
3. One helper used by all three callers:
   `boundFor(headers, config, plan?) = max(3, inferArrayBound, arrayBoundOf(plan))`.
   Used in `ImportMapperComponent`, `LocalImportTransport.preview` and server `previewSheet`.
4. Mapper: keep a row for every incoming entry (constants, refs beyond the bound, unknown refs
   shown as invalid); `toPlan` emits them unchanged.
5. Mapper "Add slot" per array: a session-local bound bump.
6. `arrayBound` on `ImportPreview` and `ImportPreviewResponse`. `HttpImportTransport` treats
   a missing value (older server) as 3.

**Specs:** the Issue 5 acceptance list; plus a shared fixture file run through both local and
server preview, asserting equal `arrayBound`.

## Step 5 — Delimiters (Issue 6) + decimal-comma guard

1. `createCsvReader({ delimiter })` and `parseCsv(text, { delimiter })`. Parameterise only the
   separator compare in the state machine.
2. `detectDelimiter(headerLine)`: count candidates outside quotes; on a tie or zero, use `,`.
3. Browser `defaultSheetParser`: `.tsv` uses `\t`, anything else is detected.
4. Server `readSheet` CSV path: buffer decoded text up to the first newline outside quotes,
   capped at `maxCellLength × maxColumns` (refuse with `LIMIT_EXCEEDED` past it). Then detect,
   then feed the buffer and the rest of the stream to the reader.
5. **Decimal guard (new):** `CoerceOptions.decimal?: '.' | ','`, defaulting to `','` when the
   detected delimiter is `;`. With `','`: `1.234,5` → 1234.5, `1,5` → 1.5, and the ambiguous
   `1,500` is still read as 1.5 — never silently as 1500. Thread it through
   `runImport`/`LocalImportTransport`.
6. `delimiter` on `SheetPreview` and `ImportPreview`, shown in the preview step.
7. Delete `demoSheetParser`; the demo imports TSV through the default parser.
8. `toCsv`/templates stay comma-separated. Note the EU-Excel caveat in the README.

**Specs:** the Issue 6 acceptance list, plus decimal-comma cases on server and client, plus a
1-byte chunk parity spec for `;` and `\t`.

## Step 6 — Typed cells through `SheetParser` (Issue 3)

1. Core: `SheetGrid = { headers: string[]; rows: unknown[][] }`; `SheetData` unchanged.
2. Core: `cellText(value)` = the server's `sampleText`, moved into core. The server re-imports
   it from core.
3. ngx: `SheetParser` returns `SheetGrid | Promise<SheetGrid>`. Mapper samples, preview and
   `LocalImportTransport` render cells through `cellText`.
4. **Verify the SheetJS date behaviour before writing the docs:** check 0.20.3 with
   `cellDates: true` under `TZ=Asia/Kolkata`. If Dates arrive at local midnight, the documented
   example must pass SheetJS's UTC option (or convert to UTC midnight itself), or
   `coerceTypedCell` imports the previous day.
5. Docs: README and `EXTENDING.md` example (SheetJS from its CDN, 0.20.3+, typed). The
   changelog notes that code which *calls* a `SheetParser` now receives `unknown[][]`.

**Specs:** add a typed-parser case to `import-engine.timezone.spec.ts` (positive and negative
offsets): a midnight-UTC `Date` → `YYYY-MM-DD`, matching the server for the same workbook; a
2.2-style `string[][]` parser behaves unchanged.

## Step 7 — Small fixes

- **7a:** `@deprecated` on `ApplyMappingOptions.maxArrayRows`, saying the plan decides the
  bound. No spec.
- **7b:** `guardZip` already tracks `xl/workbook.xml`. When the central directory lacks it,
  throw `UNSUPPORTED_FORMAT` ("a zip archive that is not an Excel workbook") before exceljs is
  constructed. Specs: `.docx` and plain `.zip` fixtures.
- **7c:** absorbed by step 2.
- **7d:** read `guard-zip.ts` in full against the README limits table. Add one crafted-archive
  fixture per limit (`maxUncompressedBytes`, compression ratio, entry count). File anything
  found as its own issue rather than growing this step.

## Step 8 — Release 2.3.0

- Bump `CORE_VERSION` and the package versions. The HTTP engine check compares major.minor, so
  2.3 clients and 2.2 servers will refuse each other. State that in the changelog, and
  deploy servers first.
- `CHANGELOG.md`: new errors and warnings (`REFERER_INSIDE_ARRAY`, `REFERER_OVERRIDE_IGNORED`),
  the legacy-ref alias, rule-by-ref import behaviour (some rows that used to be rejected now
  import), the `SheetParser` widening, the delimiter and decimal behaviour, `arrayBound` and
  `delimiter` on the previews.
- Full `npm test`, then the demo's import walkthrough with CSV, TSV, semicolon CSV and xlsx
  through both the local and HTTP transports.

## Deferred — positional arrays (Issue 2)

Not in 2.3. As specified it adds an import-only flag to the form model. A `null` slot also does
not survive the form: `buildArrayRow` renders it as an empty row, and saving writes back an
object. Records would then differ depending on whether they came from import or the form. It
belongs with plan v2's per-list options (`lists`), where positional behaviour is a property of
the mapping and the renderer contract can be decided at the same time.

## Decisions (taken Oct 4, 2026)

1. **Override semantics (step 1):** an override on a container is honoured on **tab-level**
   fields only, matching the renderer. Elsewhere `validateConfig` warns.
2. **Legacy-ref alias (step 1):** un-indexed 2.2 refs keep resolving to slot 0, with a warning,
   until 3.0.
3. **Decimal default (step 5):** inferred from the delimiter: `;` implies a decimal comma unless
   the caller passes `decimal` explicitly.
