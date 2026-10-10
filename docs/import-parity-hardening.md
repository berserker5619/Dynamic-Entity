# Import parity hardening — summary

**Date:** 2026-10-09 · **Range:** `d244ae0..fc20004` (five commits on `main`) · **Source:** §2 and §8 of [`import-progress-report.md`](import-progress-report.md)

`docs/import-phase1-spec.md` was not in the repository when this work was done, so its "Parity prerequisites" checklist could not be cross-checked. The five items were taken as specified in the task.

Only tests, fixtures, snapshots and `scripts/check-timezones.mjs` changed. No shipped source changed. Shared fixtures live in `packages/core/test-fixtures/`. That directory is outside `src/`, so it is neither published nor counted by the coverage gates. Both the server and the Angular package import it by relative path, the way they already share `test_data.json`.

> **Update, 2.3.1:** both differences below are fixed and their `it.failing` tests are now plain
> tests: #1 in `9770d7d`, #2 in `fb40bdf`. The exceljs/JSZip follow-up is done in `e2da5b2`.
> The release commit is `79a81ed`.

## The two differences found (not fixed)

| # | Marked in | Difference |
|---|---|---|
| 1 | `server/src/run-import.spec.ts:630` (`it.failing`, via `knownDifference` on the case at `core/test-fixtures/preview-parity.ts:181`) | **The server ignores a `.tsv` filename.** The browser reads any `.tsv` by tabs (`sheet-parser.ts`), as the 2.3.0 changelog promises: "`.tsv` always means tab". `readSheet` decides by content only; its `filename` "decides nothing" (`read-sheet.ts:47`). So a `.tsv` whose header line holds more commas than tabs splits on commas on the server. `Name\tNote, if any, here` becomes headers `["Name\tNote", " if any", " here"]`, and nothing is suggested. |
| 2 | `ngx-dynamic-entity/src/lib/form/form-structure.service.spec.ts:323` (`it.failing`) | **An imported record and a saved one differ at a moved array's position.** `extractRecord` writes a tab-level field at its position and at its `refererField`, so the form saves a moved array's rows twice. `applyMapping` writes them only at the override. It leaves nothing at the position, or `[]` in a `flatData` tab. The form reads the override first, so the record opens correctly, but `record.<tab>.<arrayId>` is absent or `[]` for an imported record and holds the rows for a saved one. The 2.3 plan scoped import to "write where `patchForm` reads", so this may be intended. It needs a decision. |

When either difference is fixed, its `it.failing` starts failing. That is the signal to turn it back into a plain `it`; for #1, remove `knownDifference` from the case.

## Items

| # | Commit | Spec / script files | Cases added | Result |
|---|---|---|---|---|
| 1. Shared preview fixture (report 4.2) | `7818faa` | new `core/test-fixtures/preview-parity.ts`; `ngx-dynamic-entity/src/lib/import/local-import-transport.spec.ts`; `server/src/run-import.spec.ts` | 8 cases, run on both sides (16 tests). Each side asserts headers, sample, row count, delimiter, `arrayBound`, the suggestion sorted by ref, and its entity. The cases: comma CSV; semicolon CSV with decimal commas; `.tsv`; numbered array headers up to slot 6; a one-child array (`Phone 2`); a header two arrays answer to; a header with quoted delimiters; a `.tsv` whose header has more commas than tabs. The two copied cases (old `:201` and `:642`) are replaced by the shared slot-6 case. The server is fed one byte at a time. | Pass. 15 pass outright; 1 is `it.failing` (difference #1). |
| 2. Moved-container snapshots (report 0.2, §6.5) | `b0e62da` | `core/src/import-moved-containers.spec.ts`; new `core/src/__snapshots__/import-moved-containers.spec.ts.snap`; `ngx-dynamic-entity/src/lib/form/form-structure.service.spec.ts` | 6 snapshots over three configs: a moved array, a moved group, and an array override the form ignores. For each, the derived columns (`ref`, `header`, `required`, `arrayIndex`, `arrayRef`, `arrayLabel`, `unsupported`) and the `applyMapping` result (records, errors, skipped) for one representative row. Plus 1 renderer test. | Pass. The snapshots were read before committing. The renderer test is `it.failing` (difference #2, which the moved-array snapshot exposed). |
| 3. Typed parser at negative offsets (report 6.1) | `9caa48a` | `scripts/check-timezones.mjs` | `ngx/local-import-transport` added to `SUITES`. The script can run Angular specs, so no core-level stand-in was needed. | Pass in all six zones: UTC, America/Los_Angeles, America/New_York, Europe/Berlin, Asia/Kolkata, Pacific/Kiritimati. I checked that the gate can fail. With `coerceTypedCell` reading local date parts, the typed commit test fails under Los Angeles and passes under Kolkata. |
| 4. Browser decimal comma (report 5.2) | `9e1be7d` | `core/test-fixtures/preview-parity.ts`; both specs from item 1 | The shared semicolon case gains an `expectedCommit`: `1,5` → 1.5, `1.234,5` → 1234.5, `1,500` → 1.5, and `1.5` refused with `"1.5" is not a number` at row 5. `LocalImportTransport.commit` and `runImport` (one byte at a time, two rows per batch) are both held to it: 1 test per side. | Pass. I checked that the browser test can fail: without `decimalMarkFor`, `1,500` imports as 1500. |
| 5. xlsx parity, browser vs server | `fc20004` | new `core/test-fixtures/xlsx-parity.ts`; new `server/src/xlsx-parity.spec.ts`; new `ngx-dynamic-entity/src/lib/import/xlsx-parity.spec.ts`; `scripts/check-timezones.mjs` | One workbook built with exceljs, holding a midnight-UTC date, a year-boundary date, date-times, numbers, booleans, text, a one-child numbered array, a blank row and a bad number. The server imports it through `runImport`. The browser reads it through a typed exceljs `SheetParser` (test code only) and `LocalImportTransport.commit`. Both must equal one expected set of records, errors and `skipped`. Server: 2 tests (bytes, commit). Browser: 3 tests (bytes, headers, commit). Both specs were added to `check:timezones`. | Pass, and the two sides agree in all six zones. |

### How "the same bytes" holds for item 5

exceljs stamps the current time on every zip entry, so its output differs from run to run. The fixture re-packs the archive with JSZip at a fixed date and with fixed workbook properties. I verified that the result is byte-identical:
- across separate runs;
- in Node and in jsdom;
- under Los Angeles, Kolkata and Kiritimati.

Each side asserts the bytes against `PARITY_XLSX_SHA256` before importing them. No binary is committed. Change the workbook and the hash test says so; then update the constant.

## Test counts

| Package | Before (`d244ae0`) | After (`fc20004`) | Change |
|---|---|---|---|
| `@dynamic-entity/core` | 876 (35 suites) | 882 (35) | +6 |
| `@dynamic-entity/server` | 294 (13) | 304 (14) | +10 |
| `ngx-dynamic-entity` | 1094 (76) | 1106 (77) | +12 |
| `ngx-dynamic-entity-builder` | 407 (25) | 407 (25) | — |

Every count passes; Jest counts an `it.failing` that fails as passed. Nothing is skipped or todo. Each commit was checked with `npx jest --ci` in all four packages, because turbo cannot spawn in this environment. The server and Angular specs were also type-checked (`tsc --noEmit`, `tsc -p tsconfig.spec.json`) and the changed files linted with ESLint.

## Follow-ups

- **Fix or decide** differences #1 and #2. Each wants its own issue.
- **Declare exceljs and JSZip for the test-only imports.** `core/test-fixtures/xlsx-parity.ts` and the Angular `xlsx-parity.spec.ts` import them. Both are hoisted from the server's dependencies, so they resolve today, but neither package declares them. Declaring them as devDependencies where they are imported would remove that reliance on hoisting. I left it alone because it touches `package.json` and the lockfile, which this task excluded.
- **Watch the zone in Git Bash.** Git Bash does not pass `TZ=… cmd` through to Node on this machine. `check-timezones.mjs` is unaffected because it sets `TZ` through `spawnSync`, but a hand-run `TZ=America/Los_Angeles npx jest` here silently runs in the local zone.
