# Import work — progress report against the 2.3 plan

**Date:** 2026-10-09 · **HEAD:** `d244ae0` · **Baseline:** `fb095e8` (core `2.2.0`) · **Release tag:** `v2.3.0` → `ca087a0`

## What each section was graded against

| Section | Graded against |
|---|---|
| 1. Summary | [`docs/import-2.3-plan.md`](import-2.3-plan.md), as it stands at HEAD (including the "As built" edits made in `96200a5` and `bf5cffd`) |
| 2. Per-criterion checklist | `docs/import-2.3-plan.md`: each **Specs** / **Done when** bullet is an acceptance criterion. Each **Work** item is graded separately, because that is where most divergences are. |
| 3. Test results | Nothing. These are the results of running the suites at HEAD. |
| 4. API check (index.ts) | The names, fields and error codes `docs/import-2.3-plan.md` gives, checked against `packages/*/src/index.ts` / `public-api.ts` |
| 5. Corrections to the original 2.3 spec | The opening and the step text of `docs/import-2.3-plan.md`. **The original "Dynamic Entity 2.3 — Import Fix Specs" issue set is not in the repository**, so the "spec said" column is reconstructed from the plan's own wording. |
| 6. What Phase 1 must know | The code at HEAD and `CHANGELOG.md` [2.3.0], compared with [`docs/import-extraction-analysis.md`](import-extraction-analysis.md) (written at `fb095e8`). **`docs/import-phase1-spec.md` was not graded.** |
| 7. Changes the plan did not ask for | `git log fb095e8..HEAD`, compared with the plan |

**Statuses:**
- **Done:** I read the code and saw a test covering it pass.
- **Partial:** some of it is there; the entry says what is missing.
- **Not started:** no code found.
- **Diverged:** built differently from the plan; the entry quotes the plan.
- **Unverified:** I could not tell; the entry says why.

All citations are relative to `packages/`.

---

## 1. Summary

### Acceptance criteria (Specs / Done when bullets)

| Step | Done | Partial | Not started | Diverged | Unverified |
|---|---|---|---|---|---|
| 0 — Parity baseline | 2 | 1 | 0 | 0 | 0 |
| 1 — `refererField` on containers (Issue 1) | 7 | 0 | 0 | 0 | 0 |
| 2 — Rules / `showWhen` by ref (new issue, absorbs 7c) | 4 | 0 | 0 | 1 | 0 |
| 3 — Array-header grammar (Issue 4) | 2 | 0 | 0 | 0 | 1 |
| 4 — Slot sizing, mapper round-trip (Issue 5) | 0 | 1 | 0 | 0 | 1 |
| 5 — Delimiters + decimal comma (Issue 6) | 1 | 1 | 0 | 0 | 1 |
| 6 — Typed cells through `SheetParser` (Issue 3) | 1 | 1 | 0 | 0 | 0 |
| 7 — Small fixes 7a–7d | 4 | 0 | 0 | 0 | 1 |
| 8 — Release 2.3.0 | 4 | 0 | 0 | 0 | 1 |
| Deferred — positional arrays (Issue 2) | 0 | 0 | 1 (deferred by the plan) | 0 | 0 |
| Ground rules | 2 | 0 | 0 | 0 | 2 |
| **Total (40)** | **27** | **4** | **1** | **1** | **7** |

### Work items

| Step | Done | Partial | Diverged | Unverified |
|---|---|---|---|---|
| 1 | 3 | 0 | 2 | 0 |
| 2 | 2 | 0 | 2 | 0 |
| 3 | 3 | 0 | 1 | 0 |
| 4 | 4 | 0 | 1 | 1 |
| 5 | 6 | 1 | 1 | 0 |
| 6 | 3 | 1 | 0 | 1 |

**In short:** every step of the plan shipped, and all four Jest suites are green. Nothing is broken, but there are four kinds of gap:

- **The machine-readable error codes don't exist.** `REFERER_INSIDE_ARRAY` and `REFERER_OVERRIDE_IGNORED` were never built: `ConfigProblem` has no code field.
- **Several helpers shipped under names other than the plan's.**
- **Three parity checks are weaker than the plan asked for:**
  - there is no shared local/server preview fixture;
  - no typed-parser case runs at a negative offset;
  - the override fixtures (a) and (b) were never frozen as 2.2 behaviour.
- **Three criteria point at the original Issue 4–6 acceptance lists**, which are not in the repository, so I can't grade them.

---

## 2. Per-criterion checklist

### Step 0 — Parity baseline

| # | Criterion (plan wording) | Status | Evidence |
|---|---|---|---|
| 0.1 | "add a snapshot of `deriveImportColumns(config, { maxArrayRows: 3 })` for every config in `test_data.json`: `ref`, `header`, `required`, `arrayIndex`, plus `unsupported`" | **Done** | `server/src/all-configs.spec.ts:149`, "derives the same columns as the 2.2 baseline" (passes once per config). It also passes `lang: 'en'`. Snapshot: `server/src/__snapshots__/all-configs.spec.ts.snap`. |
| 0.2 | "three hand-built fixtures that `test_data.json` does not cover: (a) an array with an authored override ref, (b) a group with an override ref, (c) a config as the builder saves it" in `core/src/import-columns.spec.ts` | **Partial** | Only (c) is there: `core/src/import-columns.spec.ts:219`, "a config as the builder saves it › derives the same columns as the unstamped config" (passes). (a) and (b) are not in `import-columns.spec.ts`, and their **2.2** derivation was never frozen. They first appear in `core/src/import-moved-containers.spec.ts:48,92`, added with Step 1 (`bab714a`), and they assert the *new* behaviour. |
| 0.3 | "the snapshots are committed and green. Any later diff to them must be deliberate" | **Done** | The `.snap` file and `all-configs.spec.ts` have been touched only by `a686e09` (`git log fb095e8..HEAD -- …`). The test passes at HEAD. |

### Step 1 — `refererField` on containers (corrected Issue 1)

**Specs**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1.1 | "Override array `contact.phones` → `contact.phones.0.number … .2.number`; two slots import as `{ contact: { phones: [{…}, {…}] } }`" | **Done** | Code: `core/src/field-scopes.ts:220` (`collectFieldRefs`), `core/src/import-engine.ts:913`. Tests: `core/src/import-moved-containers.spec.ts:48` "a moved array › unrolls its children under the override"; `:60` "imports several slots as rows at the override"; `:69` "is still an array at the override when the row has no phones". |
| 1.2 | "Same for a group override (`customer` → `customer.city`)" | **Done** | `import-moved-containers.spec.ts:92` "a moved group › takes its children with it…"; `:97` "imports to the override". The fixture uses `customer.address.city`, which is the same case. |
| 1.3 | "A builder-stamped config (fixture c) gets **zero** `REFERER_INSIDE_ARRAY` errors" | **Done** (behaviour) | `import-moved-containers.spec.ts:75` "reads children the builder stamped exactly as it reads unstamped ones" asserts no `refererField` problem on a stamped config. Two caveats. It uses that file's moved-array fixture, not Step 0's fixture (c). And there is no code to assert, so the test filters problems by path (see §4). |
| 1.4 | "A hand-written child override inside an array gets the error" | **Done** | `core/src/validate-config.ts:630`. Test: `import-moved-containers.spec.ts:122` "rejects an authored override on a field inside an array". |
| 1.5 | "Renderer round-trip in `ngx-dynamic-entity` (`form-structure.service.spec.ts`)" | **Done** | `ngx-dynamic-entity/src/lib/form/form-structure.service.spec.ts:287` "patchForm › round-trips an imported record whose array was moved by refererField". |
| 1.6 | "A 2.2 plan with `phones.number` still imports, with a warning" | **Done** | `core/src/import-columns.ts:408` (`legacyRefAliases`), `:463` (`upgradeLegacyRefs`). Test: `import-moved-containers.spec.ts:147` "plans saved against 2.2 › reads an un-indexed child of a moved array as slot 0, with a warning". The alias also covers moved-group children (`:161`) and still rejects an old and new ref mapped together (`:173`). |
| 1.7 | "Step 0 snapshots unchanged for every config without overrides" | **Done** | See 0.3. The snapshot is untouched and green. |

**Work items**

| # | Plan | Status | What was built |
|---|---|---|---|
| W1.1 | "`core/src/field-scopes.ts`: add `effectiveRefs(config)`" | **Diverged** (name, shape) | `collectFieldRefs(config): FieldRefEntry[]` (`field-scopes.ts:220`), public. Each entry carries `ref`, `recordScope`, `tabLevel` and `authored`. Plus a public helper `isRefOverride` (`:181`). The semantics match the plan. |
| W1.2 | "`collectLeafTargets` uses `effectiveRefs` for both `arrayRefs` and leaf refs" | **Done** | `LeafTarget` gains `recordScope`; covered by 1.1. |
| W1.3 | "after `normalizeArrayStructures`, normalise every override array at its effective ref (`[]` when absent)" | **Done** | `import-engine.ts:913`; test 1.1 (`:69`). |
| W1.4 | "`REFERER_INSIDE_ARRAY` (error) … `REFERER_OVERRIDE_IGNORED` (warning)" | **Diverged** | Neither code exists anywhere in the code. `ConfigProblem` is `{ level, path, message }` (`core/src/validate-config.ts:27`); it has no code. The behaviour is present: an error at `:630` and a warning at `:638`. Tests: `import-moved-containers.spec.ts:122` and `:106`. |
| W1.5 | "resolve an un-indexed legacy ref … to slot 0 … report a `warning` … Remove the alias in 3.0. Add a changelog line." | **Done** | Covered by 1.6. The CHANGELOG [2.3.0] has "Plans saved against 2.2 keep working". `upgradeLegacyRefs` is also exported, which the plan did not ask for. |

### Step 2 — Rules and `showWhen` by ref during import (new issue)

**Specs**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 2.1 | "the probe from the review as a spec (ref-token hide relaxes `required`)" | **Done** | `core/src/import-rules.spec.ts:62` "rules addressed by [ref] › relax a required field the rule hides". |
| 2.2 | "two `city` fields in different groups with a ref rule hiding one" | **Done** | `import-rules.spec.ts:68` "hide exactly the field they name when two scopes share an id". The fixture is `home.city` / `work.city` (`:23-24`). |
| 2.3 | "a bare-id rule on an ambiguous id hides neither (and `validateConfig` already flags it)" | **Diverged** | It hides **every** field that answers to the id: `import-rules.spec.ts:97` "hide every field answering to an ambiguous id, as the form does". The plan's own "*As built*" note (line 117) records this: "an ambiguous bare id hides **every** field that answers to it, because that is what the form does". The `validateConfig` flag is covered by `core/src/validate-config.spec.ts:183,207`. |
| 2.4 | "a `[ref]` `showWhen` key" | **Done** | `import-rules.spec.ts:110` "showWhen and show rules › resolve a [ref] showWhen key". |
| 2.5 | "the renderer's rule specs unchanged" | **Done** | `96200a5` changed no renderer spec. The later `4bed21f` *added* `nested-visibility.spec.ts` and modified no existing spec. |

**Work items**

| # | Plan | Status | What was built |
|---|---|---|---|
| W2.1 | "`flattenScopeValues(record, entries): Record<string, unknown>` … Make the renderer delegate to it" | **Diverged** (name, signature) | `flattenFieldValues(entries, valueOf)` (`field-scopes.ts:275`) takes a value callback instead of a record, plus `namesOfField(field, scope)` (`:259`). The renderer delegates at `ngx-dynamic-entity/src/lib/form/form-structure.service.ts:145`. |
| W2.2 | "`evaluateRuleState` builds that map **per tab** from `fieldsUnderTab(config, tab.id)` and evaluates against it" | **Diverged** | One flat map is built for the whole config, and every rule is evaluated against it once (`import-engine.ts:649-701`). `filterRulesForTab` and `getTabData` are no longer used by import. `fieldsUnderTab` is used only to relax hidden tabs. The step also added precedence the plan did not list: "hide over show over showWhen, hidden containers hide their children, hidden tabs relax everything they own" (`96200a5`; tests `import-rules.spec.ts:73,116,126`). |
| W2.3 | "a field is hidden if `hidden` contains its bare id or its ref token. Rule validation messages get the same treatment." | **Done** | `import-engine.ts:685-698`. Test: `import-rules.spec.ts:78` "attach their validation message to the field they name". |
| W2.4 | "`evaluateFieldVisibility` for each leaf gets the same flat map" | **Done** | `import-engine.ts:626,662`; test 2.4. |

### Step 3 — Shared array-header grammar (Issue 4)

**Specs**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 3.1 | "every acceptance case in Issue 4" | **Unverified** | The Issue 4 text is not in the repository. What exists, all passing, is `core/src/array-headers.spec.ts`: `:61` "maps "Phone 1 Number" spellings to their slot, as guesses"; "reads underscores, run-together words and a bracketed number"; "tells two children of one row apart"; `:83` "lets an exact heading win over a guess"; "reads a bare "Phone 2" as the only child of a one-child array"; `:104` "carries the array label and address on every unrolled column". |
| 3.2 | "including `Number 1` being ambiguous between `phones` and `faxes`" | **Done** | `array-headers.spec.ts:91` "matches neither array for a spelling both answer to". |
| 3.3 | "existing `suggestMapping` specs unchanged" | **Done** | `core/src/import-engine.spec.ts` is not in `git diff fb095e8..HEAD`, and it passes. |

**Work items**

| # | Plan | Status | What was built |
|---|---|---|---|
| W3.1 | "`core/src/array-headers.ts` (new, **internal**) … `slotPatterns(arrayLabel, childLabel, childId, singleChild)` … `A n C`, `A C n`, `C n`, `C (n)`, `A n`" | **Diverged** (signature, visibility) | `slotPatterns(names: SlotNames)` takes an object (`array-headers.ts:58`). `C (n)` has no pattern of its own because it normalises to `C n` (`:56`). `slotPatterns` and `matchSlot` stay internal, but the module is not: `inferArrayBound`, `arrayBoundFor` and `DEFAULT_ARRAY_ROWS` are exported from `core/src/index.ts:220`. |
| W3.1b | "`matchSlot` … extracts `n`. The singular form is only the trivial `-s` strip. Labels resolve in the `lang` passed in." | **Done** | `array-headers.ts:88`, `:48` (strips the `s` only when the name is longer than 3 characters). `lang` is passed through `deriveImportColumns`. |
| W3.2 | "`ImportColumn.arrayLabel?: string`, set in `deriveImportColumns`" | **Done** | `core/src/import-model.types.ts:44`; `import-columns.ts:305-313`. `arrayRef?` was also added (`:42`). |
| W3.3 | "exact pass, unchanged; then a loose pass … ambiguity guard … per (pattern, slot) … Every loose hit is `confidence: 'guess'`" | **Done** | `import-engine.ts:532` onward (two passes, `ambiguousLooseKeys`, `'guess'`); tests 3.1 and 3.2. |

### Step 4 — Slot sizing and mapper round-trip (Issue 5)

**Specs**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 4.1 | "the Issue 5 acceptance list" | **Unverified** | The Issue 5 text is not in the repository. What exists, all passing, is `ngx-dynamic-entity/src/lib/import/import-mapper.component.spec.ts`: `:138` "offers a row for every slot the sheet names, not just three"; `:144` "round-trips a stored plan with a far slot and a fixed value, entry for entry"; `:165` "shows a fixed value as the selection…"; `:174` "keeps an entry for a field the form no longer has until the user removes it"; `:193` "adds one slot to an array on request…". |
| 4.2 | "a **shared fixture file** run through both local and server preview, asserting equal `arrayBound`" | **Partial** | There is no shared fixture. The same CSV string and config are copied into `ngx-dynamic-entity/src/lib/import/local-import-transport.spec.ts:201` and `server/src/run-import.spec.ts:642` (both "sizes repeating fields from the headers, and suggests every named row"). Each asserts `arrayBound === 6` on its own, so if one copy is edited the two can drift apart without any test failing. |

**Work items**

| # | Plan | Status | What was built |
|---|---|---|---|
| W4.1 | "**Reproduce first** … The result decides whether items 4–5 below are a fix or only a guard spec." | **Unverified** | The fix and its spec landed in one commit (`9d4315b`), so the history can't show the spec failing first. The commit message describes a real loss ("`toPlan` emitted only rows it had"). |
| W4.2 | "`inferArrayBound(headers, config, lang?)` … never enumerates slots … clamped to `[1, MAX_ARRAY_BOUND]`" | **Done** (plus extras) | `array-headers.ts:151`. It also adds a reach limit the plan did not specify (`PLAUSIBLE_ROWS = 100`, `:142`), so `Revenue 2024` is not read as row 2024. Tests: `array-headers.spec.ts:113,119,123,129`. |
| W4.3 | "`boundFor(headers, config, plan?) = max(3, inferArrayBound, arrayBoundOf(plan))` … Used in `ImportMapperComponent`, `LocalImportTransport.preview` and server `previewSheet`" | **Diverged** (name only) | It is `arrayBoundFor(headers, config, plan?, lang?)` (`array-headers.ts:200`), capped at `MAX_ARRAY_BOUND`. It is used at `import-mapper.component.ts:304`, `local-import-transport.ts:76` and `server/src/run-import.ts:311`, and also `import-preview.component.ts:162`. |
| W4.4 | "Mapper: keep a row for every incoming entry … `toPlan` emits them unchanged" | **Done** | `import-mapper.component.ts:288-342,401-418`; tests 4.1 (`:144,165,174`). Stale refs are listed with a Remove button, not as "invalid" rows. |
| W4.5 | "Mapper "Add slot" per array: a session-local bound bump" | **Done** | `extraSlots` (`:284`), cleared in `ngOnChanges` (`:290`), `addSlot` (`:384`). Test: `:193`. |
| W4.6 | "`arrayBound` on `ImportPreview` and `ImportPreviewResponse`. `HttpImportTransport` treats a missing value (older server) as 3." | **Done** | `core/src/import-wire.types.ts:31`, `import-contracts.ts:92`, `server/src/run-import.ts:275`, `http-import-transport.ts:188`. Tests: `http-import-transport.spec.ts:112` (canned 2.2 response → `arrayBound: 3`) and `:566`. |

### Step 5 — Delimiters (Issue 6) + decimal-comma guard

**Specs**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 5.1 | "the Issue 6 acceptance list" | **Unverified** | The Issue 6 text is not in the repository. What exists, all passing: `core/src/csv-delimiter.spec.ts:14` "picks the separator the header uses most", `:20` "ignores separators inside quotes", `:25` "falls back to a comma for a tie…", `:52` "lets an explicit delimiter win over detection"; `ngx-dynamic-entity/src/lib/import/sheet-parser.spec.ts:20` "reads a .tsv by tabs…", `:27` "detects a semicolon CSV…"; `server/src/run-import.spec.ts:682` "previews a semicolon file in its own columns…", `:706` "reads a tab-separated upload by its tabs". |
| 5.2 | "decimal-comma cases on server **and client**" | **Partial** | Core: `csv-delimiter.spec.ts:72` "is what a semicolon sheet means", `:79` "reads 1,5 and 1.234,5, and never reads 1,500 as fifteen hundred", `:90` "leaves the default exactly as it was". Server: `run-import.spec.ts:689` "imports it with a decimal comma, so 1,500 is one and a half". Client: no unit test (`grep decimal` across `ngx-dynamic-entity/src/lib/import/*.spec.ts` finds nothing). The only client check is the e2e `demo-angular/e2e/import-mapping.spec.ts:174`, which I did not run. |
| 5.3 | "a 1-byte chunk parity spec for `;` and `\t`" | **Done** | `csv-delimiter.spec.ts:60`, `it.each([';', '\t'])` "streams %j identically at any chunk boundary" (`byteByByte`). |

**Work items**

| # | Plan | Status | What was built |
|---|---|---|---|
| W5.1 | "`createCsvReader({ delimiter })` and `parseCsv(text, { delimiter })`" | **Done** | `core/src/csv.ts:144,268`. |
| W5.2 | "`detectDelimiter(headerLine)` … on a tie or zero, use `,`" | **Done** | `csv.ts:299`; test `:25`. |
| W5.3 | "Browser `defaultSheetParser`: `.tsv` uses `\t`, anything else is detected" | **Done** | `ngx-dynamic-entity/src/lib/import/sheet-parser.ts:36`. |
| W5.4 | "buffer decoded text up to the first newline outside quotes, capped at `maxCellLength × maxColumns` (**refuse with `LIMIT_EXCEEDED`** past it)" | **Diverged** (code) | `server/src/read-sheet.ts:126` throws **`SHEET_TOO_LARGE`**. `LIMIT_EXCEEDED` is not an `ImportErrorCode` (`server/src/errors.ts:31`). The cap is `maxCellLength × maxColumns + maxColumns` (`completeFirstLine`, `csv.ts:320`). Test: `run-import.spec.ts:712` "refuses a header line longer than any row may be…". |
| W5.5 | "`CoerceOptions.decimal?` … defaulting to `','` when the detected delimiter is `;` … Thread it through `runImport`/`LocalImportTransport`" | **Partial** | Core: `import-engine.ts:88` and `decimalMarkFor` (`csv.ts:285`). The server takes an override (`RunImportOptions.decimal`, `server/src/run-import.ts:75,167`). The browser always derives the mark (`local-import-transport.ts:98`) and gives callers no `decimal` option. So Decision 3's "unless the caller passes `decimal` explicitly" holds on the server only. |
| W5.6 | "`delimiter` on `SheetPreview` and `ImportPreview`, shown in the preview step" | **Done** | `run-import.ts:273`, `import-contracts.ts:94`, `import-wire.types.ts:33`, and `entity-import.component.ts` (data-testid `import-delimiter`). |
| W5.7 | "Delete `demoSheetParser`" | **Done** | `demo-angular/src/app/mock/demo-sheet-parser.ts` was deleted in `f6b884e`. |
| W5.8 | "`toCsv`/templates stay comma-separated. Note the EU-Excel caveat in the README." | **Done** | `server/README.md:273-276`. |

### Step 6 — Typed cells through `SheetParser` (Issue 3)

**Specs**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 6.1 | "add a typed-parser case to `import-engine.timezone.spec.ts` (positive and negative offsets): a midnight-UTC `Date` → `YYYY-MM-DD`, matching the server for the same workbook" | **Partial** | No case was added: `core/src/import-engine.timezone.spec.ts` is unchanged since `fb095e8`, and its "a typed date cell carries no timezone either" block predates the baseline. That block does run in six zones, including negative offsets, through `npm run check:timezones` (all passed, §3). The new typed-*parser* tests are `ngx-dynamic-entity/src/lib/import/local-import-transport.spec.ts:266` "with a typed parser › imports a date cell as the calendar date it is, as the server would" and `:273`. They run only in the machine zone (UTC+5:30), and `scripts/check-timezones.mjs` does not include them in `SUITES`. No single test asserts that the browser and the server agree. |
| 6.2 | "a 2.2-style `string[][]` parser behaves unchanged" | **Done** (existing guard) | `local-import-transport.spec.ts:155` "uses a registered sheet parser instead of the built-in one". It predates the baseline and passes unchanged. |

**Work items**

| # | Plan | Status | What was built |
|---|---|---|---|
| W6.1 | "`SheetGrid = { headers: string[]; rows: unknown[][] }`; `SheetData` unchanged" | **Done** | `core/src/csv.ts:31`. `SheetData` gains an optional `delimiter` (from Step 5). |
| W6.2 | "`cellText(value)` = the server's `sampleText`, moved into core. The server re-imports it" | **Done** | `core/src/cell-text.ts:17`; `server/src/cell-text.ts:7` re-exports it as `sampleText`. Test: `core/src/cell-text.spec.ts:21` "renders a midnight-UTC date as the bare day". |
| W6.3 | "`SheetParser` returns `SheetGrid \| Promise<SheetGrid>`. Mapper samples, preview and `LocalImportTransport` render cells through `cellText`" | **Done** | `import-contracts.ts:58`; `local-import-transport.ts:83`. The mapper and preview get their samples from that preview. |
| W6.4 | "**Verify the SheetJS date behaviour before writing the docs:** check 0.20.3 with `cellDates: true` under `TZ=Asia/Kolkata`" | **Unverified** | `78dbda3` says it was "verified against 0.20.3", and the docs reflect that result (`cellDates: true`, `UTC: true`). No script or test in the repo reproduces the check. |
| W6.5 | "Docs: **README** and `EXTENDING.md` example … The changelog notes that code which *calls* a `SheetParser` now receives `unknown[][]`" | **Partial** | `EXTENDING.md:681-716` has the example, and the CHANGELOG [2.3.0] has the note. No README has a SheetJS example (`grep -i sheetjs` over every README finds nothing). |

### Step 7 — Small fixes

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 7a | "`@deprecated` on `ApplyMappingOptions.maxArrayRows`, saying the plan decides the bound. No spec." | **Done** | `core/src/import-engine.ts:855`. No spec, as the plan says. |
| 7b | "When the central directory lacks [`xl/workbook.xml`], throw `UNSUPPORTED_FORMAT` … before exceljs is constructed. Specs: `.docx` and plain `.zip` fixtures." | **Done** | `server/src/guard-zip.ts:547`. Test: `server/src/guard-zip.spec.ts:251`, `it.each` "names a .docx / a plain zip as an unsupported format, not a malformed workbook". |
| 7c | "absorbed by step 2" | **Done** | See Step 2. |
| 7d-i | "read `guard-zip.ts` in full against the README limits table. Add one crafted-archive fixture per limit" | **Done** (already existed) | The fixtures predate the baseline: `server/src/xlsx-source.spec.ts:148` "refuses a zip bomb before inflating it", `:159` "refuses it on the ratio…", `:169` "refuses an archive of too many entries". `ca1ea88` added the code each limit refuses with to the README table. |
| 7d-ii | "File anything found as its own issue" | **Unverified** | There is no issue tracker evidence in the repo. `ca1ea88` reports nothing found. |

### Step 8 — Release 2.3.0

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 8.1 | "Bump `CORE_VERSION` and the package versions" | **Done** | `core/src/constants.ts:18` and every `package.json` are at `2.3.0`. Tag `v2.3.0` is on `ca087a0`, which put more work into the release after `bf5cffd` (see §7). |
| 8.2 | "a mismatch is a *warning*, not a refusal … State that in the changelog, and deploy servers first" | **Done** | CHANGELOG [2.3.0] Upgrading: "A 2.3 browser against a 2.2 server works, and logs an engine-version warning … Deploy the server first." Test: `http-import-transport.spec.ts:197` "does say something about a minor difference". |
| 8.3 | "`CHANGELOG.md`: new errors and warnings (`REFERER_INSIDE_ARRAY`, `REFERER_OVERRIDE_IGNORED`), the legacy-ref alias, rule-by-ref import behaviour …, the `SheetParser` widening, the delimiter and decimal behaviour, `arrayBound` and `delimiter` on the previews" | **Done** | Every item is there. The new error and warning are described in prose and not named by code, which is accurate, because the codes don't exist (W1.4). |
| 8.4 | "Full `npm test`" | **Done** (at HEAD) | See §3. Only HEAD was tested, not each release commit. |
| 8.5 | "the demo's import walkthrough with CSV, TSV, semicolon CSV and xlsx through both the local and HTTP transports" | **Unverified** | Not run in this audit. E2E specs exist for: semicolon in the browser (`demo-angular/e2e/import-mapping.spec.ts:174`), semicolon through the server (`:214`), TSV in the browser only (`:189`), a Word file refused by the server (`:241`), and xlsx *templates* (`import-all-configs.spec.ts:225`). I found no e2e that imports an xlsx file. |

### Deferred — positional arrays (Issue 2)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| D.1 | "Not in 2.3 … It belongs with plan v2's per-list options (`lists`)" | **Not started** (deferred on purpose) | No positional-array code. It is now Phase 1 / plan v2 scope (§6). |

### Ground rules

| # | Rule | Status | Evidence |
|---|---|---|---|
| G.1 | "Commit straight to `main`, one commit per step" | **Done** | Step 0 `a686e09`, 1 `bab714a`, 2 `96200a5`, 3 `450b8c0`, 4 `9d4315b`, 5 `f6b884e`, 6 `78dbda3`, 7 `ca1ea88`, 8 `bf5cffd`. |
| G.2 | "Each commit leaves `npm test` green across all packages" | **Unverified** | Only HEAD was tested. |
| G.3 | "Nothing changes the *shape* of `MappingPlan`" | **Done** | `git diff fb095e8..HEAD -- core/src/import-model.types.ts` adds only `ImportColumn.arrayRef` and `ImportColumn.arrayLabel`. `MappingPlan` and `MappingEntry` are untouched. |
| G.4 | "Every behaviour change starts with a failing spec" | **Unverified** | Each fix commit contains both code and spec, so the history can't show which came first. |

---

## 3. Test results (HEAD `d244ae0`)

`npm test` (`turbo run test`) **could not run here.** Turbo's native binary failed with `Error: spawn UNKNOWN` (errno −4094), which is an environment problem, not a test result. Instead:

1. I rebuilt `@dynamic-entity/core` and `ngx-dynamic-entity`, because their `dist/` (gitignored) predated HEAD.
2. I ran `npx jest --ci` in each package, which is what each package's `test` script does.
3. I ran `npm run check:timezones` separately.

| Package | Suites | Passed | Failed | Skipped / todo | Total |
|---|---|---|---|---|---|
| `@dynamic-entity/core` | 35 / 35 | 876 | 0 | 0 | 876 |
| `@dynamic-entity/server` | 13 / 13 | 294 | 0 | 0 | 294 |
| `ngx-dynamic-entity` | 76 / 76 | 1094 | 0 | 0 | 1094 |
| `ngx-dynamic-entity-builder` (not requested; run anyway) | 25 / 25 | 407 | 0 | 0 | 407 |

**No tests failed.**

`check:timezones`: core (`timezone|import-columns|import-engine`) and server (`all-configs`) passed in all six zones: UTC, America/Los_Angeles, America/New_York, Europe/Berlin, Asia/Kolkata and Pacific/Kiritimati.

**Not run:**
- the `demo-angular` unit tests (`ng test`);
- the Playwright e2e suite;
- `npm run lint`.

---

## 4. API check against `index.ts`

The renderer's `public-api.ts` and the server's `index.ts` are unchanged since `fb095e8`, so every new public name is in `core/src/index.ts`.

### Names and codes the plan gives

| Plan name | In the code? | Exported from core `index.ts`? | Note |
|---|---|---|---|
| `REFERER_INSIDE_ARRAY` (error code) | **No.** Only the message (`validate-config.ts:630`) | — | `ConfigProblem` has no `code` field |
| `REFERER_OVERRIDE_IGNORED` (warning code) | **No.** Only the message (`:638`) | — | same |
| `LIMIT_EXCEEDED` (server refusal) | **No.** `SHEET_TOO_LARGE` is used | `ImportErrorCode` in server | — |
| `UNSUPPORTED_FORMAT` (7b) | Yes (`guard-zip.ts:547`) | server `ImportErrorCode` | existed before; now used for non-workbook zips |
| `effectiveRefs` | No: shipped as `collectFieldRefs` | `collectFieldRefs`, type `FieldRefEntry` | renamed |
| `flattenScopeValues` | No: shipped as `flattenFieldValues` | `flattenFieldValues`, `namesOfField` | renamed, new signature |
| `boundFor` | No: shipped as `arrayBoundFor` | `arrayBoundFor` | renamed, extra `lang?` |
| `inferArrayBound` | Yes | yes | — |
| `slotPatterns`, `matchSlot` | Yes | no (internal, as planned) | — |
| `parseArrayHeader`, `arrayBoundOf`, `MAX_ARRAY_BOUND` | Yes | no | unchanged from 2.2 |
| `detectDelimiter`, `createCsvReader({ delimiter })`, `parseCsv(…, { delimiter })` | Yes | yes, plus `CsvDelimiter` and `CsvReaderOptions` | — |
| `CoerceOptions.decimal` | Yes | via the `CoerceOptions` type | plus `decimalMarkFor` (exported) |
| `SheetGrid`, `cellText` | Yes | yes | — |
| `ImportColumn.arrayLabel` | Yes | via the type | plus `arrayRef` |
| `arrayBound` on `ImportPreviewResponse` / `ImportPreview` / `SheetPreview` | Yes (optional on wire and Angular types) | via the types | — |
| `delimiter` on `SheetPreview` / `ImportPreview` | Yes | via the types | also on `ImportPreviewResponse` and `SheetData` |
| `ApplyMappingOptions.maxArrayRows` `@deprecated` | Yes | via the type | — |

### Exported, but not named by the plan

- `isRefOverride`
- `upgradeLegacyRefs`
- `DEFAULT_ARRAY_ROWS`
- `completeFirstLine`
- `decimalMarkFor`
- `RULE_OPERATORS` and `RULE_ACTION_TYPES` (from the unplanned validator work, §7)

---

## 5. Where the plan corrected the original 2.3 spec

The original spec is not in the repository. The "spec said" column is inferred from the plan's wording and marked as inferred. The quotes are the plan's own words.

| # | Where | Spec said (inferred) | Plan decided instead (quoted) | Why (quoted) |
|---|---|---|---|---|
| C1 | Opening | Issues 1–7 as written | "This plan corrects that spec where the review found it wrong, adds one issue the review found, and orders the work so that every step can ship on its own." | It was reviewed "against `fb095e8` (core `2.2.0`)". |
| C2 | Step 1, Corrections | That a `refererField` on a field marks an override | "An *override* is a `refererField` that differs from the field's positional ref (`fieldRefFor(positionalScope, id)`). Presence alone means nothing" | "the builder stamps a ref on every field and treats any loaded ref as authored." |
| C3 | Step 1, Corrections | That `getTabData` should be changed to honour container overrides | "Do **not** change `getTabData`. … Import only has to write where `patchForm` reads." | "The renderer depends on it, and the renderer already writes a tab-level field to both its own position and its override (`extractRecord`) and reads the override first (`patchForm`)." |
| C4 | Step 1, Decision (and Decision 1) | That container overrides are honoured wherever they appear | "honour an override on an `array` or `group` exactly where the renderer does, on **tab-level** fields." / "Elsewhere `validateConfig` warns." | "An override on a container nested inside a group is ignored by the renderer today, so `validateConfig` warns about it rather than import inventing a meaning for it." |
| C5 | Step 1, Work 5 (and Decision 2) | Nothing about stored plans (assumed) | "resolve an un-indexed legacy ref (`phones.number`, as derived by 2.2) to slot 0 of its new ref and report a `warning`, not an error. Remove the alias in 3.0." | Ground rule: "Where a stored plan's *contents* stop resolving, the step says so and ships an alias or a migration note." |
| C6 | Step 2 (new issue) | Did not cover rules addressed by `[ref]` | "Rules and `showWhen` by ref during import (new; absorbs 7c)" | "the builder authors rule triggers and targets as `[tab.field]` tokens. … Result: hidden required fields reject valid rows." |
| C7 | Step 2, 7c | 7c asked whether duplicate ids across scopes should be allowed | "7c's question is already answered: duplicate ids across scopes are allowed by design." | No separate reason given. |
| C8 | Step 2, As built (a correction to the plan itself) | Plan spec: "a bare-id rule on an ambiguous id hides neither" | "*As built:* an ambiguous bare id hides **every** field that answers to it" | "because that is what the form does, and parity with the form is the point of this step. `validateConfig` already flags the ambiguous reference." |
| C9 | Step 4, Reproduce first | That the mapper drops plan entries (stated as a bug) | "**Reproduce first** … The result decides whether items 4–5 below are a fix or only a guard spec." | Ground rule: "Every behaviour change starts with a failing spec, so no step relies on inference." |
| C10 | Step 5, Decimal guard (and Decision 3) | Delimiter detection only | "**Decimal guard (new):** `CoerceOptions.decimal?: '.' \| ','`, defaulting to `','` when the detected delimiter is `;`." / "`;` implies a decimal comma unless the caller passes `decimal` explicitly." | "the ambiguous `1,500` is still read as 1.5 — never silently as 1500." |
| C11 | Step 6, Verify | A SheetJS example (version and options not pinned) | "**Verify the SheetJS date behaviour before writing the docs** … the documented example must pass SheetJS's UTC option (or convert to UTC midnight itself)" | "or `coerceTypedCell` imports the previous day." |
| C12 | Step 7d | An open-ended audit of `guard-zip.ts` | "File anything found as its own issue rather than growing this step." | Keeping the step's scope fixed. |
| C13 | Step 8 (a correction to the review, not the spec) | The review assumed a version mismatch is refused | "a mismatch is a *warning*, not a refusal (corrected while building: the review assumed a refusal)" | It was found while building. |
| C14 | Deferred, Issue 2 | Positional arrays in 2.3, using an import-only flag on the form model | "Not in 2.3. … It belongs with plan v2's per-list options (`lists`)" | "As specified it adds an import-only flag to the form model. A `null` slot also does not survive the form: `buildArrayRow` renders it as an empty row, and saving writes back an object. Records would then differ depending on whether they came from import or the form." |

---

## 6. What a Phase 1 implementer must know about 2.3

[`docs/import-extraction-analysis.md`](import-extraction-analysis.md) describes `fb095e8`. The Phase 1 spec should be updated for the items below before work starts.

### 6.1 Names that differ from the 2.3 plan

| The plan calls it | It shipped as |
|---|---|
| `effectiveRefs` | `collectFieldRefs` → `FieldRefEntry { ref, recordScope, tabLevel, authored }` |
| `flattenScopeValues(record, entries)` | `flattenFieldValues(entries, valueOf)` + `namesOfField(field, scope)` |
| `boundFor` | `arrayBoundFor(headers, config, plan?, lang?)` |
| `REFERER_INSIDE_ARRAY`, `REFERER_OVERRIDE_IGNORED` | No codes exist. `ConfigProblem` is `{ level, path, message }`, and the only way to tell one problem from another is by its message text. |
| `LIMIT_EXCEEDED` | `SHEET_TOO_LARGE` |

A Phase 1 spec that expects machine-readable problem codes (for `SchemaAdapter` validation, or plan v2 problems) has to introduce them. There is nothing to reuse.

### 6.2 New public API (core)

- **Field addressing:** `collectFieldRefs`, `FieldRefEntry`, `isRefOverride`, `namesOfField`, `flattenFieldValues`.
- **Plan and slot sizing:**
  - `upgradeLegacyRefs`;
  - `arrayBoundFor`, `inferArrayBound` and `DEFAULT_ARRAY_ROWS` (= 3).
- **CSV and cells:**
  - `detectDelimiter`, `completeFirstLine` and `decimalMarkFor`;
  - the types `CsvDelimiter` and `CsvReaderOptions`;
  - `SheetGrid` and `cellText`.
- **Rule vocabulary:** `RULE_OPERATORS` and `RULE_ACTION_TYPES`, which `RuleOperator` and `RuleActionType` are now derived from.

### 6.3 New fields and options

| Type | New in 2.3 |
|---|---|
| `LeafTarget` | `recordScope` |
| `ImportColumn` | `arrayRef?`, `arrayLabel?` |
| `CoerceOptions` | `decimal?: '.' \| ','` |
| `SheetData` | `delimiter?` |
| `ImportPreviewResponse` (wire) | `arrayBound?`, `delimiter?` |
| `SheetPreview` (server) | `arrayBound`, `delimiter?` |
| `ImportPreview` (Angular) | `arrayBound?`, `delimiter?` |
| `RunImportOptions` | `decimal?` |
| `SheetParser` | now returns `SheetGrid \| Promise<SheetGrid>`, so callers receive `unknown[][]` |

### 6.4 Behaviour that changed

| # | Change | Where | Stale in the analysis |
|---|---|---|---|
| B1 | A field's record address is `collectFieldRefs(…).ref`, not `refOf`. A tab-level container whose `refererField` moves it takes its whole subtree to the override, and the moved array is normalised there. A DE `SchemaAdapter` must take its paths from `collectFieldRefs`. `refOf` alone and `getTabData` are now wrong for moved containers. | `field-scopes.ts:220`, `import-engine.ts:913` | lines 165–169, 266, 421, 427–434, 506, 529 |
| B2 | Rules are evaluated **once**, against one flat map of the whole config (bare id and `[ref]`). Import no longer uses `filterRulesForTab` or `getTabData`. Precedence: hide beats show, show beats `showWhen`/`visibility: false`, a hidden container hides its children, and a hidden tab relaxes everything it owns. An ambiguous bare id hides every match. | `import-engine.ts:649-701` | lines 317–318, 534 |
| B3 | Stored 2.2 plans are upgraded on the fly. Un-indexed children of moved arrays go to slot 0, and moved-group children to their new address, with a plan warning. This happens in `validateMappingPlan`, `applyMapping` and the mapper. **Removal is due in 3.0**, so plan v2 has to say whether the alias carries over. | `import-columns.ts:408-468` | — |
| B4 | Array bound = `max(3, highest slot any header names, highest slot the plan maps)`, capped at 1000. Header numbers beyond `max(headers.length, 100)` are ignored. `DeriveColumnsOptions.maxArrayRows` is still live. Only `ApplyMappingOptions.maxArrayRows` is deprecated (removal due in 3.0). | `array-headers.ts:142-210` | lines 175, 208, 244–246, 450 |
| B5 | `suggestMapping` produces slot-numbered loose keys (`Phone 2 Number`, `phone_2_number`, `PhoneNumber2`, `Number (2)`, and `Phone 2` for a one-child array). Every such match is a `guess`. A key two fields answer to matches neither. | `import-engine.ts:532+`, `array-headers.ts` | line 524 (the candidate keys now include slot patterns) |
| B6 | CSV input is `,`, `;` or tab, detected from the header line outside quotes. A tie or a single column falls back to `,`, and `.tsv` always means tab. The server holds only the header line, capped. CSV *output* (`toCsv`, templates) is still comma-only. | `csv.ts:144-320`, `read-sheet.ts:126` | lines 343–347, 353, 362–367, 516 |
| B7 | A `;` file reads numbers with a decimal comma. `1,500` becomes 1.5, and a point-decimal number is rejected rather than guessed. The server lets callers override this; the browser doesn't. | `import-engine.ts:251-416`, `local-import-transport.ts:98` | line 298 ("commas stripped") |
| B8 | Typed cells reach the browser engine. A `Date` is read by its UTC components, and the SheetJS example needs `cellDates: true` and `UTC: true`. The server's `sampleText` is now an alias of core `cellText`. | `cell-text.ts`, `import-contracts.ts:58`, `EXTENDING.md:681` | lines 78, 94, 370–374, 394, 517 |
| B9 | A zip archive with no `xl/workbook.xml` is now `UNSUPPORTED_FORMAT` (415), not `MALFORMED_FILE`. | `guard-zip.ts:547` | — |
| B10 | `validateConfig` rejects more configs: an authored `refererField` inside an array, an unknown rule operator or action type, a non-`field`/`tab` target, `compareType: 'field'` without a `compareToField`, and a field-level `required`. Any adapter or fixture built from shipped configs must pass these checks. | `validate-config.ts` | — |
| B11 | The server and renderer peer ranges are `^2.3.0`. An engine version mismatch over HTTP is a warning. | `package.json`s, CHANGELOG | — |
| B12 | The analysis's line-number links into `import-engine.ts`, `import-columns.ts` and `validate-config.ts` (e.g. `import-engine.ts:808`) are out of date. These files grew by 100–225 lines. | — | throughout §3 |

### 6.5 Scope handed to plan v2

- **Positional arrays (Issue 2)** move to plan v2's `lists` options, together with the renderer contract for `null` slots (C14). The deferral note says the open question is that "A `null` slot also does not survive the form".
- **The parity suite** that the plan's Step 0 says "the extraction will later treat … as its parity suite" is `server/src/all-configs.spec.ts:149`. It covers only `test_data.json`, which has no container overrides. The moved-container behaviour is pinned only by `core/src/import-moved-containers.spec.ts`, which is not a snapshot.

---

## 7. Changes since `fb095e8` that the plan did not ask for

37 commits, 121 files, +7047 / −754. Eleven commits implement the plan or document it:

- `1b9903a` adds the plan and the extraction analysis;
- `a686e09` through `bf5cffd` are Steps 0–8;
- `8024f8b` updates the READMEs for the 2.3 import changes.

The other 26 were not asked for:

| Kind | Commits | Effect |
|---|---|---|
| **Changes inside the 2.3.0 release** (behaviour) | `aef35e6` validateConfig rejects rules the engine cannot apply (adds `RULE_OPERATORS`/`RULE_ACTION_TYPES`); `d9a4db6` rejects `required` set on the field; `4bed21f` a rule-hidden tab no longer blocks Save; `4d17401` builder: group children resolve and can be edited; `7df0323` builder row labels below 560px; `f7202fc` `ngx-dynamic-entity/styles.css` added to `exports` | All ship in `v2.3.0`. `aef35e6` and `d9a4db6` can make previously valid configs invalid. |
| **Data and demo fixes** | `ec4fb2b` `test_data.json` rules fire (`EQUALS`→`EQUAL`, etc.), and every shipped config is validated; `ef9691b` patientIntake rules; `fe52a54` seeded claims match their pattern; `cb571dd` the demo import applies `DEMO_RULES`. Fifteen demo fields moved to `validators.required` as part of `d9a4db6`. | `test_data.json` changed, but the Step 0 snapshot did not, because the snapshot records no rules. |
| **Release history** | `ca087a0` puts the unreleased 2.3.1 work into 2.3.0 and is where the tag `v2.3.0` sits. `bf5cffd` was the "release" commit, but it was never tagged or published. | The plan's Step 8 commit is not what shipped. |
| **E2E coverage** (its own plan, `docs/e2e-coverage-plan.md`) | `7e329cf` (the plan), `5e48eab` (its outcome), `da38bac`, `64e687b`, `8e52b60`, `47005b1`, `dab7c9b`, `42b2c96`, `1b9ae8a`, `33a1f5d` (Linux visual baselines and `scripts/check-snapshot-pairs.mjs` in `lint`) | Tests and CI only. `5e48eab` also wires `readOnlyFields` into the demo. |
| **Docs** | `3b2d9b1` updates every README for the releases since 1.x | — |
| **CI and dependencies (after the tag, unreleased)** | `fd76ef9` dev-dependency alerts; `76abe70` Dependabot grouping; `ec541c1` the release workflow runs e2e first; `d244ae0` Angular 21.2.24 → 21.2.25 | HEAD is not byte-identical to `v2.3.0`. The tests in §3 ran on Angular 21.2.25. |

---

## 8. Recommended next three tasks

Issue 1 (Step 1) is done, which unblocks extraction work. The rule that the plan v2 reader comes before grouping still stands. In order:

1. **Bring the Phase 1 spec up to date with what 2.3 shipped (S).** Work from §6:
   - Use the shipped names: `collectFieldRefs`, `flattenFieldValues`/`namesOfField` and `arrayBoundFor`.
   - State that `ConfigProblem` has no codes. If `SchemaAdapter` or plan v2 problems need codes, Phase 1 has to define them; reusing them isn't an option.
   - Make the DE adapter take its paths from `collectFieldRefs` and evaluate rules once, against the whole config (B1, B2).
   - Decide whether the 2.2 legacy-ref alias (B3) survives into plan v2.

   This comes first because every later task depends on those contracts.

2. **Harden the parity suite before anything moves (S–M).** These are the gaps from §2:
   - Add one shared preview fixture that runs through both `LocalImportTransport.preview` and the server's `previewSheet`, asserting that `arrayBound`, `delimiter` and the suggestion are equal (4.2).
   - Snapshot the moved-array and moved-group derivations alongside `all-configs` (0.2, §6.5).
   - Add the browser typed-parser test to `scripts/check-timezones.mjs` `SUITES`, so it runs at negative offsets (6.1).
   - Add a client-side unit test for the decimal comma (5.2).

   Step 0 says the extraction will use these specs as its parity suite. As they stand, they would not catch the browser and server drifting apart.

3. **Plan v2 reader, with positional `lists` designed in (M–L).**
   - Write the reader for the plan v2 additions in analysis §6.3.
   - Include Issue 2's deferred per-list options and the renderer contract for `null` slots (C14) in the same design.
   - Keep reading 2.2/2.3 plans unchanged: the `MappingPlan` shape is unchanged, and `upgradeLegacyRefs` already exists.

   Grouping comes after this.
