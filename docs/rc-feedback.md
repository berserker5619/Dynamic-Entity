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
  1. Simulated browser path (`readSheet` from `sheet-to-schema/node` -> `applyMapping`): Note: `readSheet` is Node-only (`sheet-to-schema/node`) and was used as a stand-in reader; browser `defaultSheetParser` does not read `.xlsx` and requires registering a custom `SheetParser` (e.g. over ExcelJS/SheetJS). When supplied with parsed rows, `applyMapping` preserved native booleans, numbers, and dates into exact schema types.
  2. Server path (`createImportRouter` via Express multipart POST): natively streamed the upload through `sheet-to-schema/node` workbook reader, executed `onImport` with identical typed records without string conversion degradation.
- **Expected**: Zero stringification degradation (such as `'TRUE'` or `'98.5'`) when Excel cells are natively typed.
- **Severity**: Pass / Working as expected.
  - *Correction / Clarification*: The server path natively handles `.xlsx` via `sheet-to-schema/node`. The browser path requires a consumer-registered `SheetParser` to accept `.xlsx` (tested with a custom ExcelJS `SheetParser` in Round 2 below).

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

---

## Second RC Test Round (Real-World Files & Standalone Angular App)

Tested against published npm `@next` packages only (`sheet-to-schema@1.0.0-rc.1`, `@dynamic-entity/core@3.0.0-rc.1`, `@dynamic-entity/server@3.0.0-rc.1`, `ngx-dynamic-entity@3.0.0-rc.1`).

### A1. Mac Excel 1904 Date System
- **Date**: 2026-10-14
- **App**: Dual test harness (Browser `SheetParser` over ExcelJS vs Server `createImportRouter` over HTTP)
- **Sheet shape**: Binary `.xlsx` generated with openpyxl setting `wb.epoch = CALENDAR_MAC_1904` (`<workbookPr date1904="1"/>` in `xl/workbook.xml`), containing dates `2026-05-15`, `1904-01-02` (day 1 in 1904 epoch), `1985-10-26`, and `2020-03-01`.
- **What happened**:
  - *Browser path*: ExcelJS `Workbook.xlsx.load` detected `date1904="1"`. Both dates parsed as exact UTC dates (`2026-05-15`, `1904-01-02`). `applyMapping` formatted them into ISO strings `2026-05-15` and `1904-01-02`.
  - *Server path*: Preview sample and commit imported identical records: Alice Mac (`birthDate: '2026-05-15'`, `joinDate: '1904-01-02'`), Bob Mac (`birthDate: '1985-10-26'`, `joinDate: '2020-03-01'`).
- **Expected**: Dates must not shift by 1462 days (the ~4-year gap between 1900 and 1904 date epochs).
- **Severity**: Pass / Working as expected. Zero epoch drift.

### A2. Numeric cells holding identifiers mapped to string fields
- **Date**: 2026-10-14
- **App**: Dual test harness (Browser `SheetParser` over ExcelJS vs Server `createImportRouter` over HTTP)
- **Sheet shape**: `.xlsx` with numeric cells (`<c t="n">`) holding:
  - 10-digit phone (`9876543210`)
  - 16-digit National ID (`1234567890123456`, `9876543210987654`)
  - Pincodes (`600001`, and `12345` entered without leading apostrophe)
  - Whole numbers / counts (`42`, `100`)
  - Mapped to schema fields of type `text` (string).
- **What happened**:
  - Both Browser and Server paths produced identical strings:
    - `phone`: `"9876543210"`
    - `nationalId`: `"1234567890123456"` (no scientific notation `1.23457e+15`; safe integer below `Number.MAX_SAFE_INTEGER`)
    - `postalCode`: `"600001"`, and `"12345"`
    - `itemCount`: `"42"`, `"100"`
  - *Correction on round 2's "zero precision loss" note*: The second 16-digit case (`9876543210987654`) exceeds `Number.MAX_SAFE_INTEGER` (`9007199254740991`) and passed only because the value was even. An odd value above the limit (such as `9876543210987653`) loses precision in IEEE-754 float64 (becoming `9876543210987652`). In rc.2, when a numeric cell's absolute value exceeds `Number.MAX_SAFE_INTEGER` and its target is a string kind, the importer reports `CELL_FORMAT`: `"too many digits to read exactly; format the column as Text in the source file"`.
- **Expected**: Numeric cell values coerced to strings should retain full digit strings without exponential notation; values exceeding safe integer precision mapped to strings must report `CELL_FORMAT`.
- **Severity**: Pass / Resolved in rc.2 with unsafe integer guard.
  - *Observation*: Pincode `12345` (intended as `012345`) imported as `"12345"`. When a user types a leading zero into a default Excel cell without text formatting, Excel's engine discards the leading zero before saving to XML. The coercion faithfully read the stored numeric value.

### A3. CSV Flavors & LibreOffice Calc (.xlsx)
- **Date**: 2026-10-14
- **App**: Dual test harness (Browser `defaultSheetParser` / `exceljsParser` vs Server `createImportRouter` over HTTP)
- **Sheet shape**:
  1. *Excel CSV UTF-8 with BOM*: Starts with byte order mark `\uFEFF`, comma-delimited, CRLF.
  2. *Excel Semicolon CSV*: `;` delimiter with European comma decimals (`12,50`, `4,8`).
  3. *Google Sheets CSV export*: Standard UTF-8, commas, multiline cell `"123 Main St\nApt 4B"`, escaped quotes `"Special order: ""fragile"""`.
  4. *LibreOffice Calc xlsx*: Native `.xlsx` with LibreOffice generator metadata in `docProps/app.xml`.
- **What happened**:
  - *Excel CSV UTF-8 (BOM)*: Both browser and server stripped `\uFEFF` from header 1. `parsedHeaders[0]` was `"Name"` (not `"\uFEFFName"`), allowing `suggestMapping` and `applyMapping` to achieve 100% exact match.
  - *Excel Semicolon CSV*: `detectDelimiter` detected `;`. Coercion with `decimalMarkFor(';')` converted `12,50` to `12.5` and `4,8` to `4.8`.
  - *Google Sheets CSV*: Multiline addresses and escaped quotes were preserved without row splitting or truncated quotes.
  - *LibreOffice Calc xlsx*: Streamed and parsed with 100% parity to Excel workbooks.
- **Expected**: Universal interoperability across major spreadsheet software exports.
- **Severity**: Pass / Working as expected.

### A4. Complex .xlsx (merged headers, hidden column, formulas, multiple sheets, trailing rows, duplicate headers)
- **Date**: 2026-10-14
- **App**: Dual test harness (Browser `SheetParser` over ExcelJS vs Server `createImportRouter` over HTTP)
- **Sheet shape**: Binary `.xlsx` containing:
  - Merged header cells `A1:B1` ("Customer Info")
  - Hidden column F (`<col min="6" max="6" hidden="1"/>`) containing "Secret"
  - Formula cells in column E (`=C2*D2` and `=C3*D3` with cached values `255` and `400`)
  - Two sheets (`Sales` with data, `Instructions` as sheet 2)
  - 7 trailing empty styled rows (rows 4 to 10)
  - Duplicate header name (`Status` at column 6 and column 7)
- **What happened**:
  - *Formula cells*: Both paths evaluated to cached formula values `255` and `400`. The raw formula string `=C2*D2` was never emitted.
  - *Hidden column*: Both paths parsed column F without shifting subsequent column indices.
  - *Two sheets*: Both paths read sheet 1 (`Sales`) and ignored sheet 2 (`Instructions`).
  - *Trailing empty rows*: Server commit reported `rowsRead: 9, imported: 2, skipped: 7`. Both paths silently skipped the 7 empty rows without generating errors or null records.
  - *Duplicate headers*: `suggestMapping` mapped `status` to column 6 (first occurrence); column 7 was left unmapped.
  - *Merged header cells*: 
    - In Browser (non-streaming `getSheetValues()`): ExcelJS duplicated the master cell text into covered cells: `['Customer Info', 'Customer Info', 'Qty', ...]`.
    - In Server (streaming `WorkbookReader`): The covered cell was emitted as empty string: `['Customer Info', '', 'Qty', ...]`.
- **Expected**: Formula results used; empty rows skipped; sheet 1 prioritized; hidden columns kept in index alignment.
- **Severity**: Pass (with Minor observation on merged header cell text duplication in non-streaming browser parser vs empty cell on streaming server parser).

### A5. Non-Latin text (Tamil script, complex combining marks, emojis)
- **Date**: 2026-10-14
- **App**: Dual test harness (Browser vs Server, across both `.xlsx` and `.csv`)
- **Sheet shape**:
  - Headers: `['பெயர்', 'மின்னஞ்சல்', '📦 ஆர்டர் எண்', '💰 தொகை', '🚀 நிலை']`
  - Values: `கார்த்திக் சுந்தரம்`, `மலர்விழி செல்வம்`, `Rajesh Kumar 🎉`, `✅ வழங்கப்பட்டது`, `⚡ செயலாக்கத்தில் உள்ளது`, `❌ ரத்து செய்யப்பட்டது`.
- **What happened**:
  - Full UTF-8 fidelity in both Browser and Server paths across both XLSX and CSV.
  - All Tamil conjuncts and glyphs (`த்`, `தி`, `ழ`, `க்`) and astral plane emojis (`📦`, `💰`, `🚀`, `✅`, `⚡`, `❌`, `🎉`) preserved without mojibake or surrogate corruption.
- **Expected**: 100% character preservation across all languages and emojis.
- **Severity**: Pass / Working as expected.

---

### B. Fresh Standalone Angular App (`ngx-dynamic-entity@next`, `@dynamic-entity/core@next`, `@dynamic-entity/server@next`)

- **Date**: 2026-10-14
- **App**: Standalone Angular 21 project built outside monorepo (`fresh-angular-rc-app`), installing packages from npm registry. Driven end-to-end via Playwright.
- **Screenshots saved to**: `docs/rc-screens/`

#### 1. LocalImportTransport (In-Browser) Flow
- Screen 1: `01-local-upload.png` — Wizard upload step with template download button and file dropzone.
- Screen 2: `02-local-map.png` — Column mapping screen matching `Full Name *`, `Email Address *`, and `City`.
- Screen 3: `03-local-review.png` — Review table rendering 3 sample rows with formatted values.
- Screen 4: `04-local-commit-success.png` — Import completed with success status `Imported 3 record(s). Saved 3 records in browser memory.`

#### 2. HttpImportTransport (Against `@dynamic-entity/server@next`) Flow
- Screen 5: `05-http-upload.png` — Server transport upload screen.
- Screen 6: `06-http-map.png` — Server-suggested mapping screen.
- Screen 7: `07-http-review.png` — Server preview sample table.
- Screen 8: `08-http-commit-success.png` — Multipart POST `/commit` executed, backend console logged `[SERVER] Imported 3 customers to backend database.`, wizard displayed `Imported 3 record(s).`

#### 3. Date-Order Mismatch Guard (Wizard `DMY` vs Server `MDY`)
- Screen 9: `09-date-order-mismatch.png`
- **What happened**: Wizard configured with `[dateOrder]="'DMY'"` connected to server router configured with `dateOrder: 'MDY'`. When previewing ambiguous dates (`05/09/2026`, `15/10/2026`), the review screen immediately displayed the mismatch alert:
  > *"This page reads dates as DMY but the import reads them as MDY. Nothing can be imported until both use the same date order."*
  The "Import 2 row(s)" commit button was automatically disabled. Emma Watson's row flagged `"15/10/2026" is not a date`.
- **Expected**: Immediate UI guard preventing accidental date corruption before a single record is written.
- **Severity**: Pass / Working as expected.

#### 4. Stored 2.5 Plan Reopened in 3.0 Wizard
- Screen 10: `10-stored-25-plan-reopened.png`
- Screen 11: `11-stored-25-plan-imported.png`
- **What happened**: Stored 2.5 plan `{ entity: 'customers', configVersion: 1, entries: [{ ref: 'name', column: 0 }, { ref: 'email', column: 1 }, { ref: 'city', column: 2 }] }` provided via custom preview suggestion. `ImportMapperComponent` automatically normalized the legacy plan via `upgradeLegacyRefs` and pre-populated all column select dropdowns (`3 of 3 field(s) matched.`). The user proceeded to Review and Commit without re-mapping any column.
- **Expected**: Flawless backward compatibility when reopening existing saved mapping plans.
- **Severity**: Pass / Working as expected.

---

## Deferred Items

### Duplicate header names: preview should flag them
- **Status**: Deferred to Phase 4.
- **Description**: When an uploaded spreadsheet carries duplicate header names (such as multiple columns titled "Status"), the preview step should detect and flag them to alert the user during mapping.


---

## Dependency alerts triaged before 3.0.0-rc.3 (2026-10-17)

Ten Dependabot alerts were open on `main`. Each was traced to whether it reaches the runtime
dependency tree of a published package (`npm ls <pkg> --omit=dev` per workspace, and the
generated `dist/package.json` each package publishes). Only one did.

### uuid (#30, medium, GHSA-w5hq-g745-h8pq): runtime, vulnerable code not used

- **Path**: `@dynamic-entity/server` depends on `exceljs@4.4.0` (a normal dependency, by the
  Phase 2 decision, unchanged), which depends on `uuid@^8.3.0`, resolved to `uuid@8.3.2`.
  `sheet-to-schema` reaches the same `exceljs` only as an optional peer.
- **Fix available**: none short of a major. The first patched version is `uuid@11.1.1`; there
  is no 8.x patch, and `exceljs@4.4.0` is exceljs's latest release. An override in this
  repository would not ship: a server user would still install `uuid@8`.
- **The advisory**: a missing buffer bounds check in `v3`, `v5` and `v6` when a `buf`
  argument is passed.
- **What exceljs calls**: every `uuid` reference in the installed `exceljs@4.4.0` was searched
  (`grep -rn uuid node_modules/exceljs`, outside its own `node_modules`):
  - `lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`, which Node loads
    (`excel.js` → `lib/exceljs.nodejs.js`):
    - line 1: `const {v4: uuidv4} = require('uuid');`
    - line 43: `` model.x14Id = `{${uuidv4()}}`.toUpperCase(); ``
    - line 77: `` id: model.x14Id || `{${uuidv4()}}`, ``

    These are the only three references in `lib/`.
  - `dist/es5/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js` (the ES5 build): the same
    import of `v4` only (lines 4-5) and the same two calls (lines 40 and 68).
  - `dist/exceljs.js` and `.min.js` (the browser bundles, which nothing here loads): uuid's
    whole source is bundled in, but the only calls from exceljs code are the same two
    `uuidv4()` sites (lines 9287 and 9315); the remaining matches are inside uuid's own
    bundled implementation.
- **Conclusion**: exceljs uses `v4()` only, always with no arguments. `v3`, `v5` and `v6` are
  never called and no `buf` is ever passed, so the vulnerable code is not reached. Alert #30
  is dismissed as "vulnerable code not used".
- **Upstream**: [exceljs/exceljs#3041](https://github.com/exceljs/exceljs/issues/3041) (open)
  asks for this upgrade; [#3055](https://github.com/exceljs/exceljs/issues/3055) and
  [PR #3085](https://github.com/exceljs/exceljs/pull/3085) ("upgrade uuid to v11", open) as
  well. Revisit when an exceljs release takes `uuid >= 11.1.1`. The `tmp` advisory #3055 also
  names (GHSA-ph9p-34f9-6g65) is already fixed here: `tmp` resolves to 0.2.7.

### Fixed with a non-major update

Dev-only: none reaches a published package's runtime tree.

| Alert | Severity | Path | Now |
|---|---|---|---|
| handlebars #161, #163, #162 | critical, critical, medium | ts-jest | 4.7.10 |
| shell-quote #158 | critical | webpack-dev-server → launch-editor | 1.11.0 |
| source-map-js #156 | high | postcss, sass, source-map-loader | 1.2.2 |
| qs #32 | medium | express 4 (webpack-dev-server) | via express 4.22.3 |
| @modelcontextprotocol/sdk #159 | high | @angular/cli (exact pin) | via the Angular group's patch update |

`qs` showed in the server's runtime listing only because sheet-to-schema's optional `express`
peer was satisfied by the dev-installed express 4. Neither published package declares express
as a dependency.

### Left until after the finals: dev-only, no non-major fix

- **esbuild #35 (low, GHSA-g7r4-m6w7-qqqr)**: arbitrary file read through the esbuild
  development server on Windows. `esbuild@0.27.7` comes in through `tsup` (`^0.27.0`) and
  `vite`; the fix is 0.28.1, outside `tsup`'s range, and a 0.x minor is a breaking range. The
  build never runs esbuild's development server. Revisit when `tsup` accepts esbuild 0.28.
- **sprintf-js #157 (medium, GHSA-hp3w-g68c-fv3c)**: denial of service through unbounded
  precision specifiers. `sprintf-js@1.0.3` comes in through ts-jest → @jest/transform →
  babel-plugin-istanbul → @istanbuljs/load-nyc-config → js-yaml 3 → argparse 1. No patched
  version is published. It runs only in the test toolchain, on our own inputs. Revisit after
  the finals.

---

## Round 3 (published `@next`: sheet-to-schema 1.0.0-rc.3, Dynamic Entity 3.0.0-rc.3)

- **Date**: 2026-10-17
- **Installed from the registry only**: `sheet-to-schema@1.0.0-rc.3`, `@dynamic-entity/core`,
  `@dynamic-entity/server`, `ngx-dynamic-entity` at `3.0.0-rc.3`. Every project was fresh,
  outside the monorepo, on Node 24.19.0 (Windows).
- **Nothing was fixed in this round.** The findings below are the open items.

### Findings

| # | Severity | Finding | Case |
|---|---|---|---|
| R3-1 | Medium | The browser path, using the `.xlsx` parser EXTENDING.md documents (SheetJS 0.20.3), silently corrupts characters above U+FFFF when a workbook stores them as numeric character references. The server path is correct, so browser/server parity breaks for those files | e (5a) |
| R3-2 | Low | `createImportRouter` from `@dynamic-entity/server/express` rejects a typed request: a `configs` callback annotated with the app's own request type fails with TS2322 on `@types/express` 4 and 5. `sheet-to-schema/node`'s router accepts the same code | c |
| R3-3 | Low | `@dynamic-entity/server/express`'s typings import `express`, so a TypeScript app without `@types/express` fails with TS7016 (with `skipLibCheck` off). The server README's Install section does not mention `@types/express` | c |
| R3-4 | Low (docs) | Over HTTP, `importComplete` carries `records: []` and an `imported` count, by design (the server's `onImport` wrote them). The ngx README describes `importComplete` as "the records … this is where you write them". Round 2's test app read `records.length` and reported 0 (Round 2's screenshot 08 shows it too) | d |
| R3-5 | Low (docs) | The ngx README as published on npm links to `../server` and `../../EXTENDING.md#spreadsheet-import`, which do not resolve on npmjs.com | e |

**R3-1 in detail.** `case5_non_latin.xlsx` (written by openpyxl) stores every non-ASCII
character as a numeric character reference in an inline string: `&#128230; &#2950;...` for
`📦 ஆர்டர் எண்`. SheetJS 0.20.3 decodes a reference above U+FFFF to its low 16 bits:
`&#128230;` (U+1F4E6, 📦) becomes U+F4E6, a private-use character that renders as nothing.
Tamil (all below U+FFFF) and ✅ ⚡ ❌ survive; 📦 💰 🚀 🎉 do not. The same emoji stored as
plain UTF-8 round-trips through SheetJS intact. The result is identical whether SheetJS is
given a Node `Buffer`, an `ArrayBuffer`, or `await file.arrayBuffer()` as documented. The
server (exceljs, streamed) reads every character correctly:

| | header C | row 3 `name` |
|---|---|---|
| Browser (documented SheetJS parser) | `" ஆர்டர் எண்"` (U+F4E6 first) | `"Rajesh Kumar "` (U+F4E6 last) |
| Server | `"📦 ஆர்டர் எண்"` | `"Rajesh Kumar 🎉"` |

Round 2 did not see this: its browser path used a hand-written ExcelJS reader, not the
documented parser. EXTENDING.md's claim that "a workbook imported in the browser produces the
same records as the same workbook posted to `@dynamic-entity/server`" does not hold for these
files.

### a. Fresh app: `@dynamic-entity/core@next` + `sheet-to-schema@next`

- **What happened**: `npm install @dynamic-entity/core@next sheet-to-schema@next` added two
  packages. `npm ls` shows one `sheet-to-schema@1.0.0-rc.3`, deduplicated under core. A second
  project (case e) that also installed `@dynamic-entity/server@next` resolved to the same single
  copy.
- **Severity**: Pass.

### b. CommonJS Express server on `@dynamic-entity/server@next` (express 4, then 5)

- **App**: a CommonJS script (`require`) per Express major: express 4.22.3 and 5.3.0, each
  with `@dynamic-entity/server@3.0.0-rc.3`. File `case1_1904_dates.xlsx`.
- **What happened**: on both majors, all five checks passed: `readSheet` read the `.xlsx`
  (3 headers, 2 rows); `GET /template?format=xlsx` returned a workbook; `POST /preview` gave
  `rowCount 2` and `engineVersion 3.0.0-rc.3`; `POST /validate` answered `written: false` and
  wrote nothing; `POST /import` wrote both records with no 1904 drift (`2026-05-15`,
  `1904-01-02`, `1985-10-26`, `2020-03-01`).
- **Jest**: the same five checks as a CommonJS Jest 30 suite, run with `NODE_OPTIONS` empty and
  no transform. Five of five passed on both majors.
- **Severity**: Pass. (The rc.2 failure mode, `A dynamic import callback was invoked without
  --experimental-vm-modules`, does not occur.)

### c. TypeScript strict on `@types/express` 4 and 5 (`skipLibCheck: false`)

- **App**: three files compiled separately with `--strict --skipLibCheck false`
  (`module`/`moduleResolution: nodenext`), against `@types/express` 4.17.25 and 5.0.6.

| File | @types/express 4 | @types/express 5 |
|---|---|---|
| DE `createImportRouter`, used plainly | compiles | compiles |
| DE `createImportRouter`, `configs: (entity, request: TenantRequest) => ...` | TS2322 (R3-2) | TS2322 (R3-2) |
| sheet-to-schema `createImportRouter`, `bindings: (name, request: TenantRequest) => ...` | compiles | compiles |
| DE router with no `@types/express` installed | n/a | TS7016 in `express.d.ts` (R3-3) |

- **R3-2 error**: `Type '(entity: string, request: TenantRequest) => ...' is not assignable to
  type 'ConfigSource'. ... Property 'tenant' is missing in type 'Request<...>'`. DE's
  `ConfigSource`, `OnImport` and `lang` are typed with Express's own `Request`, so an app has
  to cast where sheet-to-schema infers the request type.
- **Severity**: Low (R3-2, R3-3). Everything compiles once the request is cast and
  `@types/express` is installed.

### d. Fresh Angular 21 app on `ngx-dynamic-entity@next`

- **App**: Round 2's test app, rebuilt from its source in a fresh project installing
  `@next` from the registry (`ngx-dynamic-entity`, `@dynamic-entity/core`,
  `@dynamic-entity/server` at 3.0.0-rc.3, `sheet-to-schema` 1.0.0-rc.3), with an Express 5
  backend. Driven by Playwright (Chromium headless).
- **Screenshots**: `docs/rc-screens/round3/01` to `11`, the same flows and names as Round 2.
- **What happened**:
  1. *Local transport*: upload, map (3 of 3 matched), review (3 rows), commit: "Imported 3
     record(s)" (01–04).
  2. *HTTP transport*: same flow against `@dynamic-entity/server@next`; the server logged
     `Imported 3 customers`; the wizard says "Imported 3 record(s)" (05–08). The test app's
     own line says "Imported 0 records to backend" because it reads `records.length` (R3-4).
  3. *Date-order mismatch* (wizard `DMY`, server `MDY`): the review shows "This page reads
     dates as DMY but the import reads them as MDY. Nothing can be imported until both use the
     same date order." and the Import button is disabled (09).
  4. *Stored 2.5 plan*: reopened with 3 of 3 fields matched, then imported 3 records without
     remapping (10–11).
- **Severity**: Pass (R3-4 is documentation).

### e. Round 2's real-world files through both paths

- **App**: a Node harness on the published packages. The browser path does what
  `LocalImportTransport` does (`File.text()` → `parseCsv`, or for `.xlsx` the SheetJS 0.20.3
  parser EXTENDING.md documents, then `suggestMapping` and `applyMapping` with
  `decimalMarkFor(delimiter)`). The server path posts each file to `@dynamic-entity/server`'s
  router (express 5). The files, configs and plans are Round 2's. Each result was compared
  across paths and with Round 2's recorded output.

| Case | Browser = server | Same as Round 2 | Notes |
|---|---|---|---|
| 1. 1904 dates (Mac Excel) | yes | yes | no 1462-day drift |
| 2. Numeric identifiers | yes | no, by design | row 3's `9876543210987654` is past `MAX_SAFE_INTEGER` and now reports `CELL_FORMAT` on both paths (rc.2 change); 1 imported, 1 failed |
| 3a. Excel CSV UTF-8 with BOM | yes | yes | BOM stripped from the first header |
| 3b. Excel semicolon CSV | yes | yes | `12,50` → 12.5 |
| 3c. Google Sheets CSV | yes | yes | multiline cell and escaped quotes intact |
| 3d. LibreOffice xlsx | yes | yes | |
| 4. Merged/complex xlsx | yes | yes | headers now agree (`''` for the covered cell; Round 2's ExcelJS reader repeated the master text); server `rowsRead 9, imported 2, skipped 7` |
| 5a. Tamil and emoji, xlsx | **no** (R3-1) | browser no, server yes | astral emoji lost in the browser path |
| 5b. Tamil and emoji, CSV | yes | yes | |

- **Severity**: Medium for 5a (R3-1); everything else passes.

### Resolution (3.0.0-rc.4)

| # | Resolution |
|---|---|
| R3-1 | EXTENDING.md's browser `.xlsx` example now uses ExcelJS (merged-cell contract, typed cells, formula results), with a note on why not SheetJS. `packages/server/src/documented-sheet-parser.spec.ts` runs the documented example, read out of EXTENDING.md, against the server path on `case5_non_latin.xlsx` (now in `core/test-fixtures`), 1904 dates, numeric IDs and the merged/complex sheet. With SheetJS's 16-bit truncation put back into the example, it fails. |
| R3-2, R3-3 | `@dynamic-entity/server/express` uses sheet-to-schema's structural request and router types and a request type parameter; its published typings import nothing from `express`. `verify-server-consumer.mjs` compiles a typed app with `skipLibCheck` off against `@types/express` 4, 5 and none. |
| R3-4 | The ngx README says what `importComplete` carries over HTTP. |
| R3-5 | Every published package README links absolutely; `scripts/check-readme-links.mjs` runs in `lint` (source READMEs) and in `check:parity` (what `npm pack` would publish from each `dist`). |

The harnesses are in `test-harness/rc-round3/`.

## Planned for sheet-to-schema 1.1

### An official browser `.xlsx` parser
- **Status**: Planned for `sheet-to-schema` 1.1.
- **Why**: Round 3 (R3-1) showed that the browser half of a parity guarantee rests on whatever
  `.xlsx` reader each consumer copies from a doc. Dynamic Entity's docs now show an ExcelJS
  parser held to the server path by a test, but every consumer still owns a copy of it.
- **What**: a browser-safe entry point (for example `sheet-to-schema/xlsx`) exporting a
  `SheetGrid` reader with the server's cell rules: formula results, `''` for covered merged
  cells, typed dates at UTC midnight, the 1904 date system, and every character a workbook
  stores, however it stores it. `exceljs` stays an optional peer, loaded on first use. The
  main entry stays dependency-free.
