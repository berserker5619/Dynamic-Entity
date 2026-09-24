# Changelog

All notable changes to `@dynamic-entity/core`, `ngx-dynamic-entity`,
`ngx-dynamic-entity-builder` and `@dynamic-entity/server`. The four packages share a version
and are released together.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.0]

### Added
- **Interactive Rule & Dependency Graph (`ngx-rule-dependency-graph`)**:
  - Visual dependency graph dialog in the Form Builder mapping reactive triggers, condition targets, and rule actions across tabs and fields.
  - Node navigation with 1-click jump to select and edit any target field directly in the canvas and inspector.
- **Regex Validation Pattern Playground**:
  - Live interactive regex testing playground embedded in the Field Inspector's validation section.
  - Real-time pattern evaluation with dynamic status chips (`matches`, `does not match`, `invalid regex syntax`).
  - Pre-packaged regex presets (`Alpha`, `Alphanumeric`, `Digits`, `Postal Code`, `Phone`, `Slug`).
- **Enterprise Industry Templates**:
  - New production-grade demo schemas: `Insurance Claims`, `Patient Intake & Clinical Triage`, and `IT Asset & Fleet Lifecycle`.
  - Comprehensive automated E2E test coverage and visual regression baselines for all new configurations.

### Changed
- **Form Builder Section Discovery**:
  - Expanded all inspector sections by default (`Display`, `Visibility`, `Automation`, `Rules`, `Dependencies`, and `Reference`), providing authors immediate access to advanced configurations without requiring manual unfolding, while preserving collapse-on-click functionality.

---

## [2.0.2]

### Added
- **Dark Mode Theme Switcher (`Light` / `Dark` / `Auto`)**: Dynamic OS theme sync via `prefers-color-scheme: dark` media query listeners and `localStorage` persistence (`demo-theme`). Added curated dark theme palette tokens for `.ngx-form` and `.ngx-record-editor`.
- **Live JSON Schema & Record Data Inspector**: Integrated slide-over drawer in the demo app with real-time formatted preview of `EntityFormConfig` and current `VersionedRecord` data, 1-click clipboard copy with animated state feedback, and entity-specific `.json` file download.

### Fixed
- **WCAG AA Color Contrast**: Adjusted dark mode token pairings (`--ngx-color-accent: #818cf8; --ngx-color-accent-text: #090d16;`) to guarantee >= 6:1 contrast ratio across buttons, active tab headings, and navigation links.
- **Form Builder Canvas Theme Isolation**: Preserved light palette on the Angular Material builder canvas and live form preview, preventing dark theme text bleed on white surfaces and passing automated light/dark contrast audit sweeps with 0 violations.

---

## [2.0.1]

### Fixed
- **Record View, Data Only View & Form View Alignment**: Unified layout under the standard 12-column CSS Grid. Removed the `.ngx-form--readonly` auto-fit grid override that clashed with inline `grid-column: span` definitions, restoring symmetrical 50%/50% two-column layouts across all presentation modes.
- **Readonly Email Field Underline**: Prevented empty/null email fields from rendering an active `<a href="mailto:null">` link, eliminating the double-line artifact over the field baseline.
- **Field Component Block Display**: Added `:host { display: block; width: 100%; min-width: 0; }` to `DynamicFieldComponent` and `width: 100%;` to `.ngx-field` so all controls expand cleanly within their assigned grid tracks.
- **Radio & Month-Year Field Deserialization**: Fixed month/year dropdown option selection bindings and radio button comparison against deserialized records.

### Added
- **Visual Regression Test Suite**: Automated Playwright snapshot testing across Form, Record View, Data Only, List View, Form Builder, and Spreadsheet Import wizard modes.
- **Automated Performance Benchmarks**: Benchmark suite measuring rule evaluation (>440k ops/s), schema validation (>9k configs/s), record migration (>11M records/s), and streaming CSV parsing (>2k ops/s).
- **SSR Hygiene & Safety Gates**: Static AST check ensuring zero browser-specific global leaks across all 54 renderer source files and 21 field types, plus verification in both Zone.js and zoneless modes.

---

## [2.0.0]

The rules engine — the feature the README leads with — was the least finished part of the
system, and the docs described behaviour the code did not have. This release makes the
documented behaviour real, makes nested fields first-class everywhere, gives options an
identity independent of their text, and puts CI gates under the two headline claims that
nothing tested.

### Breaking changes

Read these first. Most configs need no edit; the first one changes what a running
application does.

- **Per-section save now enforces rules.** `filterRulesForTab` compared bare ids against a
  tab's *top-level* fields only, while the builder writes bracketed refs (`[personal.city]`)
  — so for every builder-authored config it matched **zero** rules, and
  `DynamicRecordFormComponent.saveSection()` applied no rule validation at all. It now
  resolves both spellings and reaches every field a tab owns, at any depth. **A section save
  that succeeded yesterday can be refused today**, by a `validation` rule that was always
  meant to apply. This is the highest-blast-radius change in the release: check your rules
  before upgrading a deployment that uses per-tab save.
- **Rule operators no longer coerce across types.** `EQUAL`, `NOT_EQUAL`, `CONTAINS`,
  `NOT_CONTAINS`, `IN`, `NOT_IN` and `VALUE_CHANGED` use a new `valuesEqual` instead of
  `valuesMatch`. `0` no longer equals `'0'`, `false` no longer equals `'false'`, and two
  options spelled alike in *different* languages no longer match. An option still matches the
  text that names it in any of its languages, which is how the builder's condition editor
  authors one, so ordinary rules are unaffected. `valuesMatch` is unchanged and stays where
  leniency is the feature — display, the choice components' `compareFn`, import coercion,
  lookup-list integrity, entity-reference selection.
- **`VALUE_CHANGED` fires differently.** It compared with `!==`, so every object-valued field
  — which is every choice field — read as changed on every evaluation, and a field the record
  had no value for could never fire at all. It now compares by value and treats filling in an
  empty field as a change.
- **`NOT_IN` against a non-array is now `true`.** It was `false`, so `IN` and `NOT_IN` against
  the same malformed target were both false and a rule and its negation could not partition
  anything.
- **`visibility: true` is no longer a no-op.** A rule that shows now overrides static hiding
  (`visibility: false`, an unmet `showWhen`). An explicit hide still beats a show, in either
  order. A config that used `value: true` expecting nothing to happen will now show fields.
- **`RuleEvaluationResult` gained `shownFields` and `shownTabs`.** Anything constructing one
  by hand must add them.
- **`getOptionStoredValue` is removed.** It was an exported identity function whose two
  branches returned their argument unchanged. Pass the option itself.
- **`@dynamic-entity/core` no longer exports the CLI.** `runValidateCli` and `ValidateCliIo`
  moved to the `@dynamic-entity/core/cli` subpath, so importing the library in a browser
  cannot pull in argv parsing. The `dynamic-entity` bin is unchanged; its wrapper is
  `bin.mjs` now, because `cli.mjs` is the subpath bundle. The cost of the split, stated: the
  subpath re-bundles the validator rather than sharing a chunk with the root, so the
  published tarball carries about 30 kB of duplicated code. The point was to keep it out of
  a browser bundle, and it is.
- **Both root barrels are now explicit.** `export *` made every helper semver surface the
  moment it was written. Dropped from `@dynamic-entity/core`: `compactArrays`, `getByPath`,
  `arrayBoundOf`, `parseArrayHeader`, `formatArrayHeader`, `MAX_ARRAY_BOUND` — import-engine
  plumbing with no external consumer and no documentation. `@dynamic-entity/server` still
  exports everything it did; each name is simply listed now.
- **New `validateConfig` errors.** A config that passed before can fail now: an unparseable
  `validators.pattern`, `min` above `max`, `minLength` above `maxLength`, a `defaultValue` a
  `number`/`boolean` field cannot hold, a field or tab id that is a reserved object key
  (`__proto__`, `constructor`, `prototype`), a rule missing `conditions`/`targets`/`action`,
  an option key starting with `$` other than `$key`, and a duplicate `$key`. These describe
  configs that already misbehaved at runtime.
- **Peer ranges move to `^2.0.0`** between the four packages.
- **Supported versions collapse to a policy**: 2.0.x supported, 1.x security fixes only.

### Fixed

- **A malformed rule no longer takes down the form.** `evaluateFormRules` called
  `rule.conditions.every` unguarded, so a rule authored without conditions threw from inside
  change detection. Such a rule is now skipped and reported through a new
  `onProblem` callback; the renderer turns that into one dev-mode warning per problem.
  `validateConfig` reports the same shapes — the loop there used `rule.conditions?.forEach`,
  which validated clean for exactly the shape that crashed.
- **A rule can reach a nested field.** `filterRulesForTab` never walked `group`/`array`
  children or sub-tabs. A new `fieldsUnderTab` in `field-scopes.ts` is the single walk both
  it and `collectFieldScopes` use.
- **A required field inside a `group`, hidden by a rule, no longer pins `form.invalid`
  forever.** `syncHiddenFieldState` walked a tab's own fields only — the exact bug its own
  docblock said it fixed. It and the render filter now share one predicate over
  `collectFieldScopes`, and a container's children are skipped once the container is hidden
  so a child's `enable()` cannot fight its parent.
- **Hiding a field no longer disables its namesake on another tab.** Controls were resolved
  by bare id with no tab, falling through to a first-match search of the whole form. They are
  addressed by path now.
- **"Jump to the first invalid field" finds a nested one**, and the error summary names the
  offending child rather than the `group` containing it.
- **An `autoPatch` target inside a `group` or on a sub-tab now resolves.** It matched a tab's
  top-level fields only and silently copied nothing otherwise.
- **`validators.pattern` is checked.** An unparseable one was silently skipped server-side and
  **threw** client-side while the control was built, taking the whole form with it. It is a
  `validateConfig` error, and at runtime the field degrades to no format check with a warning.
- **An unresolved named validator says so.** `validators.custom` / `customAsync` naming
  something unregistered was dropped in silence — for an async uniqueness check, a duplicate
  saved with nothing anywhere having said so.
- **A field named `__proto__` is reported.** It passed `ID_PATTERN` and then every path guard
  refused to read or write it: a field that rendered, accepted input, and could never hold a
  value.
- **SECURITY.md's prototype claim is now true without qualification.** `applyAutoPatch` and
  `applyPatchOnTrue` wrote config-supplied keys into a fresh object unguarded. Nothing
  propagated, because `Object.entries` skips `__proto__` at the call site — but an invariant
  that holds because of a caller's choice of iterator is not one. Both skip such a mapping,
  `validateConfig` reports it, and `fuzz.spec.ts` covers it.
- **A field rename follows the rules that named it by path.** `renameField` repointed rules
  matching a *bare id* only, while the builder authors them by path — so renaming a field
  orphaned every rule the builder itself had written, leaving it pointing at a path nothing
  resolved to. A path's last segment is the field id, which is what makes the repoint exact:
  renaming `city` rewrites `[status.city]` and leaves `[status.statusCode]` alone.
- **`resolveLabel` cannot return a slug.** Its last fallback was `Object.values(...).find(Boolean)`,
  which for a keyed option authored in a language the caller does not have would have returned
  the `$key`.
- **Undo history is bounded.** The builder kept every step for the life of the session; it now
  caps at 200 and drops the oldest.
- **A markdown field no longer re-parses on every change-detection pass.** `rendered()` is
  called from the template, so the consumer's parser ran over the whole document on every pass
  of every markdown field. Memoised on the source.
- **`warnedAmbiguousIds` is per form, not per process.** It was `private static`: under SSR it
  accumulated for the life of the server, and the first render of a config silenced the
  warning for every request after it.
- **`tsc --noEmit -p tsconfig.spec.json` checked zero files** in both Angular packages. The
  base config excludes `src/**/*.spec.ts` and `exclude` is inherited, so the spec config
  included the specs and then excluded every one of them. Fixing it surfaced 27 type errors in
  specs that had never been checked — including two Jasmine matchers (`toBeTrue`,
  `toBeFalse`) that jest does not have, so those assertions were dead.
- **`verify-consumer.mjs` matched tarballs by filename prefix**, disambiguating
  `ngx-dynamic-entity` from `ngx-dynamic-entity-builder` with the leading digit of the version
  (`ngx-dynamic-entity-1`). It matched nothing at 2.0.0. Keyed by name and version now.

### Added

- **Stable option identity.** `DropdownOption` gains a reserved `$key`. When both sides of a
  comparison carry one the key decides and the text is display only, so renaming an option no
  longer orphans records; when either lacks one, matching is exactly what 1.x did. The builder
  mints a key on option create and never rewrites it on rename, shows it read-only in the
  inspector, and offers **Assign stable keys** for an existing config. `normalizeLookupValues`
  projects a list value's `code ?? _id`. `optionKeyMigration(config)` attaches keys to stored
  records, reaching choice values inside `group`s and in every row of an `array`. Every read
  of an option's translations routes through a new `languageEntries`, so the key is never
  mistaken for a language. See the README's *Option identity*.
- **`valuesEqual`, `optionKeyOf`, `languageEntries`, `OPTION_KEY`, `UNSAFE_PATH_KEYS`,
  `fieldsUnderTab`, `applyOptionKeys`, `optionKeyMigration`** are exported from core.
- **`validateConfig` takes `knownValidators`**, and the CLI takes `--validators a,b`.
- **`evaluateFormRules` takes an options object** with `onProblem`.
- **A tree-shaking CI gate.** `verify-consumer.mjs --size` builds a real consumer application
  twice — three field types registered, then all of them — and asserts a ceiling on each plus
  a minimum gap between them. "An app that uses three field types pays for three" previously
  rested entirely on a bundler eliding one unused exported function in a module that
  statically references all 21 components, and nothing tested it. Measured on Angular 20:
  **245 kB against 327 kB.** Wired into `ci.yml` as its own job.
- **Type-aware ESLint.** `parserOptions.project` across every package, with
  `@typescript-eslint/no-floating-promises` and `no-misused-promises`, plus `@angular-eslint`
  for components and templates. `no-unnecessary-condition` is deliberately left off, and the
  config says why: this codebase guards typed-but-untrusted config data on purpose, and that
  rule flags exactly those guards.
- **The builder can hand its rules to a host.** `EntityBuilderComponent` gained `[rules]` and
  `(rulesChange)`, and `BuilderStore.load` now takes the rules that belong with the config so
  the pair arrives as one snapshot — a builder is not undoable back past the act of opening
  it. It provides `BuilderStore` itself and emitted only an `EntityFormConfig`,
  so a rule authored in the builder **could not leave the component**: loading a config for
  editing dropped every rule already on it, and there was no supported way to persist a new
  one — which made per-section rule validation unreachable for anyone using the builder as
  shipped. The demo now stores rules beside each config, so the round trip has end-to-end
  coverage instead of being a manual step.
- **`FormStructureService`** — config ⇄ `FormGroup`, extracted from `DynamicFormComponent` and
  testable without a TestBed. Rule *interpretation* moved into `RulesEvaluationService`, which
  was a two-method passthrough: visibility precedence and the hidden-state sync now have one
  owner, because the bug above was two methods forty lines apart disagreeing about what
  "every field" meant. The component's public API is unchanged and delegates.

### Documentation

- A **Rules** section: how to name a field (bare id or `[path]`, never a bare dotted string),
  the visibility precedence, what `priority` does and in which direction, what happens to a
  malformed rule, and how a host round-trips rules through the builder.
- The builder README documents `[rules]` / `(rulesChange)`, and says plainly that saving the
  config alone drops what the user just authored.
- An **Option identity** section with the migration sequence.
- The server README qualifies "peak memory is a function of `batchSize`": exact for CSV, while
  for xlsx `guardZip` holds the rebuilt archive — compressed, bounded by `maxBytes` — before
  exceljs is constructed. `xlsx-source.ts` already said so in its own header.
- `provide-field-types.ts`, `field-registry.service.ts` and `field-dom-id.ts` said "nineteen"
  and "all 19"; there are 21.
- The `phase0`…`phase8` e2e specs are renamed to what they assert, and the demo now binds
  `[rules]` on both form components so the two behaviours only a round trip can show — a rule
  that *shows* a statically hidden field, and a per-section save a rule on a field inside a
  `group` refuses — have end-to-end coverage.

---

### Also in this release

The import work that had accumulated since 1.14.0 and was never published on its own. No
published API changes of its own: the import feature gained the coverage its shipped surface
always implied, and the half of it a person could not reach became reachable.

#### Added

- **`templateFormat` is reachable from the demo.** The wizard's `[templateFormat]` input
  shipped in 1.14.0 and the demo never set it, so `write-template.ts` — the xlsx writer —
  could not be exercised by anyone browsing the demo, and `LocalImportTransport`'s deliberate
  refusal of `xlsx` could not be seen. The import page now has a CSV/Excel picker, and
  `EXTENDING.md` documents the input and why binding it unconditionally is safe.
- **The import matrix runs over every config the repository ships.** Every automated import
  test used one or two hand-written configs covering five field types; `test_data.json` carries
  seven configs spanning sixteen, with pattern validators, bounded numbers, a repeating array,
  `file`/`image` columns a sheet cannot carry, and a `listName` that resolves against a lookup
  list. Per config, the generated template's own headers must map back **exactly**, and one
  synthesised row must produce an identical record three ways — `applyMapping` directly, the
  same row as CSV through `runImport`, and the same row as a **typed** workbook. The third is
  the only path that reaches `coerceTypedCell`, which exists because `String(date)` renders
  local time.
- **`config-rows.fixtures.ts`** derives a valid row from an `ImportColumn`, so a config added
  tomorrow is covered by the tests that already exist. It **throws** rather than blanking a
  field whose `pattern` no candidate satisfies — a synthesiser that quietly blanked a required
  field would turn every failure in the matrix into a pass, which is what the prototype did.
- **Stress at width.** `insuranceClaims` — thirty-five columns, four nesting levels — at 50,000
  rows as CSV and as xlsx, with backpressure and exact failure counts asserted at that scale.
  The collected-heap bound is set to discriminate rather than to be comfortable: 2.7 MB as
  written, 163 MB with the per-batch flush removed, bound at 16 MB.
- **Nine entities through a browser**, both transports — the picker's whole list, where the
  E2E suite previously drove two of the narrowest. Plus a twenty-thousand-row upload through
  the wizard and the real server, which is the only place the "the tab never holds the file"
  claim is made in a tab.

#### Changed

- **`check-timezones.mjs` sweeps the server's config matrix too.** The gate watched the string
  path in `core` and nothing else, so the typed path — a `Date` out of a workbook — had never
  run outside UTC. Verified to discriminate: reverting `coerceTypedCell` to local getters fails
  the new suite under `America/Los_Angeles`.
- **The demo's four TypeScript configs are JSON, and the import server serves them.** It used
  to serve five of the nine entities and 404 the rest, because the app overrode four with
  richer schemas and serving a *second copy* would have handed the browser one config and the
  server another. They now live in `src/app/mock/configs/`, read by both halves, so there is
  one source and nothing left to diverge. The E2E server leg covers nine entities instead of
  five — `employees`, whose repeating array becomes numbered columns, and `extensions`, whose
  `file` column a sheet cannot carry, had never run server-side at all.
- **The import wizard's dependency surface is smaller and documented.** 26 advisories down to
  8, with the critical and all twelve highs taken. What remains is accepted with a reason in
  `SECURITY.md` rather than left silent — chiefly `uuid` via `exceljs`, whose advisory covers
  `v3`/`v5`/`v6` with a `buf` argument while `exceljs` calls `v4()` with none. npm's suggested
  remedy is a *downgrade* to a version predating the dependency, and is not taken. Three of the
  four published packages declare no runtime dependencies at all, which is the number that
  actually matters to a consumer and is now a table in `SECURITY.md`.

#### Fixed

- **`LocalStore.createRecords`, in the demo.** Saving imported records one at a time re-read
  and re-serialised the whole table per record — O(n²), and the reason a 1,200-row in-browser
  import took 13.2s against the server's 3.6s for the same file. It also closes an id collision
  only a bulk insert could expose: `_id` was `${entity}_${Date.now()}`, so a thousand records
  written inside one millisecond all got the same one.
- **Two flaky builder E2E specs, root-caused.** One measured `boundingBox()` through the
  shell's 250ms `grid-template-columns` transition with no wait at all — a sound assertion
  taken too early, so it failed on whichever machine was slower. The other was the dev server
  live-reloading mid-test and detaching the element under the cursor; `ng serve` now runs with
  `--live-reload false`, since nothing in a test run edits application source.
- **README snippets that never compiled.** The import section's two examples were a bare class
  method (a syntax error) and a call naming three undeclared identifiers. CI compiles every
  documented snippet and had been red since they landed.

#### Internal

- **`check-lockfile-platforms.mjs`**, first in `npm run lint`. A lockfile regenerated on one
  platform carries only that platform's optional binaries, so `npm ci` fails everywhere else —
  which is how six green local gates preceded a red CI on every workflow. Verified against the
  real regression rather than a synthetic one.
- **`verify-server-consumer.mjs` reads the root README too.** Its `ts` blocks were compiled by
  neither consumer project, so a server-side snippet on the front page could go stale unnoticed.
  `CONTRIBUTING.md` now carries the full fence table, because `ts` genuinely means two different
  things in two places and the docs claimed it meant only one.

---

## [1.14.0] — 2026-09-18

A fourth published package. `@dynamic-entity/server` streams a spreadsheet import for files a
browser cannot hold, over the same `@dynamic-entity/core` functions the browser runs — and the
wizard components do not change at all, because they already talked to a transport.

### Added

- **`@dynamic-entity/server`** — streaming import, with an Express adapter at
  `@dynamic-entity/server/express`. `runImport` pulls rows in batches, hands each to core's
  `applyMapping`, **awaits** `onBatch`, and drops the batch: peak memory is a function of
  `batchSize`, not of file size. Four routes — `template`, `preview`, `validate`, `import` —
  and `express` is an optional peer, reached only through its own entry point, so a consumer
  wiring Fastify never pays for a framework they do not use.
- **`provideHttpImportTransport({ baseUrl })`** in `ngx-dynamic-entity`, built on `fetch`
  rather than `HttpClient` — this package has no `@angular/common/http` dependency and four
  requests is not the reason to acquire one.
- **`createCsvReader()`** in core: push chunks, pull whole rows, with the quote and CRLF state
  carried across chunk boundaries. `parseCsv` is now expressed in terms of it, so there is one
  set of quoting rules rather than two.
- **`CORE_VERSION`**, so a preview response can carry the engine that produced it and a client
  can notice that two separately deployed halves have diverged. `MappingPlan.configVersion`
  catches *config* drift and says nothing about *engine* drift.
- **Wire types in core** — `ImportPreviewResponse`, `ImportCommitResponse`,
  `ImportErrorResponse`. Plain interfaces with no HTTP in them, in core because both sides need
  them and core is the only thing both already depend on.
- `ImportResult` gains optional `imported`, `failed`, `errorCount` and `truncated`, for a
  transport that streams and therefore reports counts rather than returning records.
- An **E2E suite for the import wizard**, and an import section in `EXTENDING.md` covering the
  column contract, `maxArrayRows`, the validation-parity gap, and deduplication being yours.

### Fixed

- **A date cell arriving typed moved a day.** `coerceCell` stringified anything non-string, and
  `String(Date)` renders *local* time — so a spreadsheet's UTC-midnight date read back a day
  early at every negative offset. Reachable today by any consumer whose `sheetParser` returns
  typed cells, which is what a SheetJS or ExcelJS parser naturally does. Typed cells are now
  read by their UTC components, and `check-timezones.mjs` grows typed cases: the gate missed
  this because of what it was given, not because of where it ran.
- **A `time` cell's preview contradicted its own import.** The import read the clock and stored
  `09:05` while the review screen showed `1899-12-30T09:05:00.000Z` and reported "is not a
  time" — a failing row that would have succeeded. `time` now accepts a full ISO instant in
  UTC; offset-bearing forms stay an error, because `09:30+05:00` in a field that stores no zone
  is ambiguous and guessing is how a time moves.

### Security

- SECURITY.md gains a section for `@dynamic-entity/server`: an upload endpoint changes the
  threat model rather than extending it. Every limit has a finite default and each is enforced
  *during* streaming — `maxBytes`, zip-bomb bounds checked as entries inflate, row, column and
  cell caps, multipart bounds, idle and total timeouts, and an error envelope that carries
  nothing from below the package.
- It also says what the router does **not** do: authentication, authorization and concurrency
  limiting are the consumer's, an import is not transactional so `onImport` must be idempotent,
  and `validators.pattern` has become a server concern — a config-supplied regex with
  catastrophic backtracking now runs against attacker-chosen cell text.

---

## [1.13.0] — 2026-09-17

The builder's center column sections (Fields canvas and Live Preview) now support collapsible toggles with smooth accordion transitions, matching the left and right sidebar ergonomics.

### Added

- **Collapsible Fields Canvas & Live Preview.** The Fields canvas (top) and Live Preview (bottom) within the builder center column can now collapse and expand independently via toolbar toggle buttons, the canvas card header collapse button, or dedicated toggle rails when collapsed.
- **`fieldsOpen` / `previewOpen` two-way bindings** (`model()`), allowing consumer hosts to control and persist visibility state for both center sections.
- **Dedicated toggle rail bars** with accessible focus management, ARIA expansion states (`aria-expanded`, `aria-controls`), and localized action labels (`collapseFields`, `expandFields`, `fieldsRailLabel`, `collapsePreview`, `expandPreview`, `previewRailLabel`, `previewHeading`).

### Changed

- **Smooth CSS accordion transitions.** Vertical collapse/expansion uses CSS grid fractional track transitions (`grid-template-rows: 0fr` <-> `1fr`) alongside opacity and subtle vertical translation for 60fps animations.
- Added `@media (prefers-reduced-motion: reduce)` support to respect system reduced motion preferences.

---

## [1.12.0] — 2026-09-16

The builder's two side panels collapse, and the width they give up goes where the work is.
Alongside that, a colour audit that ran in both schemes for the first time and found a Save
button no light-mode check could see.

### Added

- **Collapsible builder sidebars.** The palette/settings column and the field inspector each
  collapse independently, from the toolbar, from a button in the card header, or back from
  the rail a collapsed panel leaves behind. A collapsed side keeps its grid track rather than
  dropping it — the rail button is a child of the same grid, so dropping the track pushed the
  inspector onto a second row underneath the canvas.
- **`leftSidebarOpen` / `rightSidebarOpen` are two-way bindable** (`model()`), so a host can
  persist panel state. The libraries still store nothing themselves — no package here touches
  `localStorage`, which is what keeps them safe to render on a server; the demo binds them to
  a `de_demo_` key to show the wiring.
- **A sticky builder toolbar.** Its toggles are the control of record for the panels, and the
  canvas is long enough that reopening one used to mean scrolling back to the top to find it.

### Changed

- **The canvas is narrower and the palette column wider, at every width.** A field row wants
  about 380px; past that the extra was gutter between a label and its badges, while the tab
  cards beside it truncated names to "Persona". `--deb-left-wide` is computed as
  `left + right - rail`, so collapsing the inspector hands its width to the palette and the
  canvas does not move at all.
- The inspector now stacks under the canvas below **1300px** (was 1240px). In that band three
  columns starved the canvas below the width a row needs.
- **`--deb-accent-ink`** splits the accent's two jobs. As a border it owes 3:1; as text or an
  icon glyph it owes 4.5:1, and `#6366f1` measured 4.47:1 — close enough that axe cleared it
  locally and failed it in CI on the same commit.
- The toolbar wraps instead of pushing the page sideways, and sheds its title and the Copy
  JSON label on narrow screens so a sticky bar stays thin.

### Fixed

- **The side panels clipped their own content.** `overflow: hidden` on a card zeroes a flex
  item's automatic minimum size, so inside a viewport-capped column the cards shrank to fit
  instead of overflowing it. The column's `overflow-y: auto` never fired and no scrollbar
  appeared anywhere: 641px of the palette and 801px of the inspector were unreachable.
- **A "collapsed" sidebar stayed fully visible.** `[hidden]` takes its `display: none` from the
  user-agent sheet, which loses to any author rule setting `display` on the same element —
  and `.deb-col` sets `display: flex`.
- **Contrast below AA** on the width badge (4.34:1), the type chip (3.99:1), the required
  marker (3.76:1), the active sidebar toggle (3.99:1), the drag handle (2.56:1) and the
  inspector chevron (2.45:1). The chip was a duplicate `.deb-chip` rule in the inspector
  shadowing the shared one; it is gone rather than corrected.
- **Field rows overflowed their card on phones.** Four 40px action buttons stay visible under
  `(hover: none)` because there is no hover to reveal them; the row wraps below 560px.
- Keyboard and screen-reader gaps: collapsing destroyed the button that was pressed and
  dropped focus to `<body>`; the toggles now carry `aria-expanded` and `aria-controls`, and
  focus moves to whichever control stands in for the panel.
- **Demo:** the record form's Save was near-black on indigo (3.0:1) for anyone whose machine
  was set to dark. The renderer re-declares its palette under `prefers-color-scheme: dark` on
  the same selectors, at the same specificity, that a consumer overrides tokens on — and the
  demo pinned `--ngx-color-accent` without `--ngx-color-accent-text`. All four tokens it was
  leaving to the dark block are now pinned.

### Notes

- **`ngx-dynamic-entity-builder` now requires Angular >= 17.2** (was >= 17.0). The two-way
  bindable sidebar inputs use `model()`, which Angular added in 17.2.0 — `export declare const
  model` is absent from 17.1.3 and present in 17.2.0. The range is narrowed rather than left
  to fail at a consumer's build: `^17.0.0` would have installed happily on 17.0 and 17.1 and
  then not compiled. The renderer and core are unaffected and still support `^17.0.0`.
- New `contrast-aa.spec.ts` computes composited contrast ratios in **both** colour schemes
  across five views. The dark pass is the point: the Save defect above passed every
  light-mode check, and axe alone would not have caught a pairing between two stylesheets.
- `PLAYWRIGHT_ALL_BROWSERS=1` adds a Firefox project over the CSS-sensitive specs. It is off
  by default because CI installs chromium only. WebKit is deliberately absent: it will not
  launch on a Windows host.

---

## [1.11.0] — 2026-09-16

A UI/UX pass over the two things a person actually uses: the form that gets rendered, and
the builder that authors it. Most of what follows is not new capability — it is capability
that existed in the schema and had no way to reach the screen.

### Added

- **`hint` on a field — help text, as an info icon beside the label.** Available on every
  field type, follows `language` like any other authored string, and is authored in the
  builder's inspector beside the label. The text appears on hovering the icon *and* for as
  long as the field has focus — which is what makes it usable by keyboard and on touch, and
  what keeps it on screen while the field is actually being filled in. It is also named by
  the control's `aria-describedby`, so a screen reader is read it without hovering anything.

  Deliberately not the same thing as `placeholder`: a placeholder is an example of the value
  and disappears at the first keystroke, so a format, a rule, or "where to find the number we
  are asking for" cannot live there — which has not stopped authors putting it there, because
  it was the only box on offer.
- **The error summary says what is wrong, not just where.** Each entry now carries the
  field's name *and* the message the field itself shows — "Email — Invalid format." — so a
  refused save can usually be fixed without visiting each field to ask it what it wanted.
- **`layout` on `ngx-dynamic-form` and `ngx-dynamic-record-form`.** `colSpan` has been in
  the model since the 12-column grid existed, and a field that did not set one took the
  full row — so a form of eight short text fields rendered as an eight-row ladder two
  thirds empty. `layout="auto"` sizes an unset field by its type instead: a date is a third
  of a row, a text field is half, a textarea or a nested group still takes all twelve. An
  authored `colSpan` always wins, and the default stays `stack`, so no existing config
  renders differently unless it asks to.
- **A Width control in the builder's field inspector.** The same `colSpan`, which the
  visual builder had no control for at all: every form authored there came out a
  single-column ladder, and the only way to put two fields on one row was to hand-edit the
  JSON. Five steps — ¼, ⅓, ½, ⅔, full — and the canvas row shows the width when it is not
  the default.
- **An error summary and per-tab error counts when a save is refused.** Pressing Save on an
  invalid form used to mark every control touched and stop, which on a tabbed form is
  indistinguishable from a broken button: the errors appear on whichever tabs hold them and
  the user is looking at a different one. A refused save now names the count, lists each
  field as a link that jumps to it, badges every tab with how many of its fields are at
  fault, and moves focus to the first. New `uiText` keys: `errorSummaryTitle`,
  `tabErrorCount`.
- **A filter and grouping in the builder's field palette.** Twenty-two buttons in a flat
  two-column grid, with the labels clipped mid-word — "Boolean Toggl", "Entity Referen",
  "File Attachmen" — so a third of the palette could not be read. Labels now wrap, the
  types are filed under Basic / Choice / Date & time / Rich & files / Structure, and the
  filter matches descriptions as well as labels, so "money" finds Currency.
- **The builder's issue list is now a list.** The toolbar showed a count whose tooltip said
  to "hover items in the list" — a list that existed nowhere in the builder. The count
  opens the problems themselves, and an entry that names a field selects it.
- **`ngx-form-sticky-actions`.** An opt-in class that keeps Save and Reset in view down a
  long form. Opt-in because `position: sticky` resolves against the nearest scrolling
  ancestor: a form embedded mid-page would detach its bar and float it over whatever is
  below, which is exactly what the builder's live preview does.

### Changed

- **Save stays available while a form is invalid.** It was disabled, and a disabled button
  is the worst possible answer to "why can't I save?" — it cannot be clicked, so the form
  never gets a moment to say which field is at fault or which tab it is on. The save is
  still refused; what changed is that refusing it now produces an explanation instead of
  silence. Save is still withheld for what a retry cannot fix: a save in flight, and an
  async validator whose answer has not come back. Ctrl+S behaves the same way, where it
  previously did nothing at all on an incomplete form. `submitBlocked` keeps its meaning as
  the submit guard; the button reads the new `submitDisabled`.
- **The record editor's header names the record.** It showed the entity twice — "clients",
  with "Entity: clients" underneath — so the one question a record header exists to answer
  was the one thing it did not say. The heading is now the record's own name, taken from a
  `showOnMinimize` field or else the first text/email field with a value, falling back to
  the entity label as before. `recordTitle` is unchanged and still the entity; the new
  `recordHeading` is the record.
- **The base stylesheet is a starting point you can ship.** `ngx-dynamic-entity/styles.css`
  gained a dark palette that follows `prefers-color-scheme`, visible focus rings, an
  invalid state, larger touch targets on radios and toggles, a consistent select arrow
  across browsers, and a read-only record that lays its values out as a table rather than
  one per row. Everything is still driven by the custom properties, and the token names did
  not change.
- **The builder's three columns no longer fight each other.** Both side rails scroll within
  the viewport instead of setting the page height, so a 1200px-tall palette no longer sits
  beside a 140px canvas. The live preview moved out of the footer — it was below a collapsed
  JSON accordion, roughly 1500px under the canvas — to directly beneath the field list, so a
  change and its effect can be seen in one glance. The inspector's fifteen divider-separated
  blocks are now collapsible sections that report what they hold when closed.

### Fixed

- **Sixteen field types never announced their error message.** Only `text`, `number` and
  `dropdown` set `aria-describedby`; on every other type the message was on screen and
  invisible to a screen reader. All nineteen leaf types now point at whatever is describing
  them — the hint, the error, or both, in that order — and
  `hint-reaches-every-field.spec.ts` walks the real registry to check each id resolves, so a
  type added later cannot quietly skip it.
- **One table of validation keys instead of nineteen copies.** Each field component carried
  its own near-identical list of which error to report first. That was survivable while the
  field was the only thing rendering a message; it stopped being survivable when the summary
  started rendering one too, because a `dropdown` would have said "This field is required"
  in the summary and "Please select an option" under the control.
  `ValidationMessagesService.resolveForField` is now the single source both read.
- **The builder's shared styles now reach the components that use them.**
  `.deb-field-row`, `.deb-section-title`, `.deb-hint`, `.deb-chip` and `.deb-empty` are
  written in seven child components' templates and defined only in the builder's own
  stylesheet — and under emulated encapsulation a parent's rules never reach a child, so the
  field rows, the inspector's section titles and the canvas's empty state have been
  rendering unstyled since they were split out. `.cdk-drag-preview` was the same fault seen
  from the other end: the CDK attaches a drag preview to `document.body`, outside the
  component entirely. The stylesheet is no longer scoped, and the duplicate `.deb-row` /
  `.deb-option-row` blocks somebody had copied into `entity-reference-config` to work around
  it are gone.
- **`--primary-50` / `--deb-accent-soft` were not colours.** Both were `#eeef2` — five hex
  digits, which no browser parses — so every surface tinted with them (the builder's type
  badges and chips, the demo's hover states) silently fell back to transparent. Now
  `#eef2ff`, the indigo-50 they were meant to be.
- **The demo stops re-implementing the published stylesheet.** Every `.ngx-field__input`,
  `.ngx-form__tab` and banner rule existed both in the demo and in the library, and the two
  had drifted — the demo grew focus states and a tab treatment the shipped stylesheet never
  got, so what we demonstrated looked nothing like what we published. The demo imports it
  and overrides the tokens, which is what a consumer does.

---

## [1.10.0] — 2026-09-03

Two seams that were configurable in principle and partly ignored in practice: date
formatting reached some surfaces and not others, and a `beforeSave` veto could be
walked around and could not be observed. Found while wiring the demo to exercise
every documented extension point, which is what made both visible.

### Added

- **`saveRejected` on `ngx-dynamic-record-form`.** The record editor embeds
  `ngx-dynamic-form`, so a whole-record save always did run `beforeSave` and always
  did refuse when the hook said no — but nothing carried that refusal out to a host
  binding the record editor. The veto worked and was indistinguishable from a Save
  button that did nothing, which is the exact failure `saveRejected` was added to
  prevent in 1.8.x, one layer up.

### Fixed

- **`saveSection` no longer bypasses `beforeSave`.** The record editor saves one tab
  at a time, and that button emitted `sectionSave` without consulting the hook. The
  payload is `extractRecord()` — the *whole* record, the same object the Save button
  sends — so identical data reached persistence by two routes, only one of which
  could be vetoed. A hook registered to refuse a save is a data-integrity mechanism;
  a second way around it made it advisory. A refused section save now emits
  `saveRejected` and leaves the section open, so the refused values are still in
  front of the user.

  `sectionSave` still fires **synchronously** when no hook is registered. Awaiting an
  already-resolved promise would have deferred the emit by a microtask for every
  consumer, to no purpose; only the hook path defers.

- **`setDateFormatters` now reaches `date` and `datetime` fields.** Both formatted
  with their own `toLocaleDateString()` / `toLocaleString()` calls rather than
  through core's `formatDisplayValue`, so a host that configured formatters got them
  in the record summary and on `time` fields, and silently did not get them on the
  two field types most likely to be the reason it configured formatters at all. Both
  now go through the shared formatter, and are handed the form's `language`.

  No visual change without configuration: the default formatters are the same
  `toLocale*` calls these fields made directly. An unparseable stored value is still
  shown verbatim and never reaches a formatter — records outlive schemas.

  `monthYear` is deliberately unchanged. It renders a month *name*, not a formatted
  date, and routing it through `formatters.date` would print a day component the
  field does not have.

### Notes

No API removed or renamed. `DynamicRecordFormComponent.saveSection()` now returns
`Promise<void>` rather than `void`; callers that ignored the return value are
unaffected.

---

## [1.9.1] — 2026-09-02

The npm README pages now document `MASKED_PLACEHOLDER` and `setDateFormatters`.
Both shipped in 1.9.0, but only `EXTENDING.md` mentioned them, and npm does not
show that file. No runtime change.

### Docs

- Root, core and renderer READMEs cover the masked placeholder, date formatters,
  and that `XXXXXXXXX` is the default rather than the only text. The core Quick
  Start comment on catalog length is 21, matching the list above it.
- The builder README points those two knobs at the renderer and core, so a
  reader of that page is not left looking for a builder token that does not
  exist.

---

## [1.9.0] — 2026-09-02

Every word the libraries render themselves is now translatable, and every
rendered control has a name and an id of its own. Work since 1.8.1.

### Added

- **The libraries' own text is translatable.** Field labels, placeholders and options
  were `LocalizedText` and already followed `language`; the chrome _around_ them —
  Save, Reset, "No rows yet.", every tooltip and panel heading in the builder — was
  English literals in the templates. An application in German rendered German labels
  around English buttons, and there was no way to change that short of forking a
  component.

  The libraries do no translating. They publish the keys they render and resolve
  whatever the host hands back, per key: 49 keys in the renderer (`UI_TEXT`,
  `provideNgxDynamicEntity({ uiText })`) and 149 in the builder (`BUILDER_TEXT`, plus
  a `uiLanguage` input on `EntityBuilderComponent`). A value may be `LocalizedText` —
  the same shape a field label uses, resolved against the same `language` — a flat
  string, or a resolver `(key, defaultText, language) => string` for a host that
  already has ngx-translate, Transloco or `$localize`.

  `DEFAULT_UI_TEXT` and `DEFAULT_BUILDER_TEXT` are exported with their English source
  strings, so a translation file can be generated rather than transcribed. Anything
  left out keeps its English default, so an unconfigured install renders exactly what
  it rendered before.

  The vocabularies are deliberately separate: an app that ships only the renderer
  should not see the builder's keys in completion. What they share is `resolveUiText`.

  `uiLanguage` is **not** `languages`. `languages` is the vocabulary a label is
  authored in; `uiLanguage` is the language of the builder's own interface. Tying the
  chrome to the authoring language would flip the whole panel every time an author
  switched the label language they were editing.

- **The masked placeholder is configurable.** `MASKED_PLACEHOLDER` replaces the
  `XXXXXXXXX` literal that was repeated across twenty-one templates. Bullets read as a
  redaction, a word reads as a permission, and English reads as neither if the app is
  not in English. Defaults to `XXXXXXXXX`.

- **Date display is configurable.** `setDateFormatters({ date, datetime, time })` in
  `@dynamic-entity/core`. The default remains the browser's locale rather than the
  form's `language`: `language` selects which `LocalizedText` key to read, which is a
  different question from how to punctuate a date, and tying them would silently
  change the format on upgrade for every consumer whose browser is set to something
  else. A partial object overrides one kind; `setDateFormatters()` restores the
  defaults.

### Fixed

- **Five field types rendered a control with no accessible name.** `multiSelect`,
  `currency`, `email`, `password` and `monthYear` drew a `<label>` beside their
  control without pointing at it, so a screen reader announced an unlabelled combo
  box and clicking the label focused nothing. The accessibility scan never saw it:
  it ran over a demo config made of text and dropdowns, and none of the five are in
  it. `monthYear` additionally names each of its two selects, because one label in
  front of a pair does not say which half the reader has landed on.

  A per-component sweep now asserts that every rendered control has a name, so a
  field type added later is covered the day it is registered rather than the day
  someone points an axe run at a page that happens to contain it.

- **A field rendered twice put duplicate ids on the page.** A control's DOM id came
  straight from `field.id`, which is unique in a config and not in a document: an
  `array` renders the same child fields once per row, so a two-row Contacts array
  produced two `#name` inputs. `<label for>` resolves to the first match in document
  order, so the second row's label focused the first row's input and announced the
  same association twice — and duplicate ids on focusable elements are a WCAG failure
  in their own right.

  Ids now carry a per-instance token: `email-de7`. They were never a public contract
  — address a control through its `data-testid` or its label — and the e2e suite,
  which had been reaching for `#fullName`, now does what its own helper file says it
  should. `radio` also gained a `data-testid` per option, which it had no stable hook
  for at all.

- **A common module registered by selector took its tab down.** `CommonModuleEntry`
  typed `component` as a string, the token's own example showed one, and
  `COMMON_MODULES` — the catalogue the builder's picker offers — is made of them. The
  renderer passes that value to `ngComponentOutlet`, which mounts a component *type*
  and throws an assertion on a string. Following the documented shape broke the
  feature, which is worse than the feature not existing.

  `component` is now `string | ComponentClass`, a selector resolves to nothing
  renderable and warns once naming the fix, and the examples show a class.

- **`resolveUiText` could return something that was not text.** `map[key]` walks the
  prototype chain, so a key of `toString` answered with a function and `__proto__`
  with an object — both of which reached the template. A resolver that threw took
  the whole form down rather than one label, and a `{placeholder}` matching an
  inherited name substituted a function body into a sentence. Keys are typed, but
  these values arrive from a translation catalogue, a JSON file, or a host written in
  JavaScript, and none of that is checked at the boundary.

- **Configured validation messages now reach every field type.** They reached three of
  fifteen. The other twelve rendered a fixed "This field has an error", so a consumer
  who configured `validationMessages` saw it on text, number and dropdown and the
  generic string everywhere else — a documented feature working on a fifth of its
  surface. Four field types had no error UI at all. A sweep spec walks the real field
  registry, so a type added later is covered the day it is registered.

- **`core` reports a collection that is present but is not an array.** `tabs: {}` or
  `fields: 'x'` was silently ignored rather than reported, which read as an empty
  entity instead of a malformed one.

### Internal

**1,550 unit tests and 148 E2E**, up from 1,337 and 124 at 1.8.1. What is new is the
*kind*: two source sweeps that assert the published key lists and the templates agree
in both directions; two rendering sweeps that mount every field type and the whole
builder with every key overridden and assert no English default survives in the
markup; a per-component accessible-name sweep; property-based fuzzing of
`resolveUiText` over 1,500 seeded override shapes per property; and an E2E that
asserts German text does not push the page into a horizontal scroll at 412px. The
three fixes above were all found by one of them.

The demo's reference stylesheet also gained `flex-wrap` on the tab strip and
shrinkable header rows: a five-tab form was wider than a phone, and the narrow
Playwright project had been rendering that horizontal scroll on every run without
asserting on it.

### Notes

Only `noRows` and the field-list wording in the critical-field banner changed shape
internally; rendered text is identical. `<strong>Add field</strong>` in the builder's
canvas empty state lost its bold — an emphasis span embedded mid-sentence cannot
survive translation, so the sentence is now one key.

### Upgrading

Control DOM ids are no longer `field.id`. An `array` row repeats the same child
ids, so two `#name` inputs were on the page and the second row's label focused
the first. Ids now look like `email-de7`. Address a control through its
`data-testid` or its label; `#fullName` is not a contract.

`MASKED_PLACEHOLDER`, `setDateFormatters`, `UI_TEXT` /
`provideNgxDynamicEntity({ uiText })` and `BUILDER_TEXT` / `uiLanguage` are
additive. An unconfigured install renders what it rendered in 1.8.1, including
the English chrome.

---

## [1.8.1] — 2026-09-01

Hardening, almost all of it found by adding property-based fuzzing over `core` and
integration tests across the three packages.

### Fixed

- **`core` no longer throws on a malformed config.** Seven crashes, all the same
  shape: `?.` guards `undefined` and nothing else, so a config holding a string, a
  number or `null` where a collection belongs reached `.map` or `.forEach` and
  threw. `validateConfig`, `collectFieldScopes`, `normalizeConfig`,
  `normalizeConfigOptions`, `parseFieldRef` and `evaluateFormRules` were all
  affected — including the validator failing on the input it exists to describe,
  which took `dynamic-entity validate` down with it in CI.

  `normalizeConfig` also skipped its object-to-array conversion for every *falsy*
  non-array, because the guard was `x && !Array.isArray(x)`.

- **The builder no longer saves a config `validateConfig` rejects.** An entity
  with no tabs is an error to core — nothing can render — while the builder
  reported a warning and left Save enabled. The builder now defers to core, in
  core's wording.

- **Focus no longer scrolls the page.** `focusActivePanel` exists to tell a screen
  reader the panel changed; the default `focus()` also scrolls it into view, which
  jumps the layout on a short viewport. It now passes `preventScroll`.

### Upgrading

`BuilderStore.isValid()` returns `false` for an entity with no tabs, where it
returned `true`. Nothing is stuck: `addField` creates the first tab when there is
none, so one field is enough. If you drive the builder programmatically and
asserted on the old value, that assertion changes.

### Internal

1,337 unit tests and 124 e2e across two Playwright projects — the second is a
narrow viewport, which the responsive grid collapse never had. Core is fuzzed with
1500 seeded runs per property, and the seed is printed on failure so a red run is
reproducible.

---

## [1.8.0] — 2026-09-01

Work since 1.7.0: undo and redo in the builder, and three defects found by
covering the branches that had none.

### Added

- **Undo / redo in the builder.** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, plus toolbar
  buttons that disable at the ends of the history. `BuilderStore` gains `undo()`,
  `redo()`, `canUndo` and `canRedo`.

  History records the `{config, rules}` pair — they are two signals, and undoing
  one without the other could leave a rule pointing at a field that no longer
  exists. Consecutive edits coalesce inside 400ms *when the structure is
  unchanged*, so typing a label is one undo step while a fast double-click on the
  palette is still two.

  The shortcut ignores keystrokes aimed at an input, textarea or contenteditable:
  those have their own undo stack, and hijacking it would discard a structural
  edit when the author wanted one character back.

### Fixed

- **`validateConfig` crashed on a malformed config.** A `null` in `fields` or
  `tabs` threw "Cannot read properties of null" — it failed on exactly the input
  it exists to describe, and took `dynamic-entity validate` down with it in CI.
  The main pass guards; the *second* pass that re-walks the tree for references
  did not. It now reports the entry and carries on.

- **A `date` field showed "Invalid Date".** `new Date('nonsense')` does not throw
  and `toLocaleDateString()` returns that string, so the try/catch meant to fall
  back to the stored value was dead code. Records outlive schemas — a field
  retyped from text to date can hold anything — so an unparseable value is now
  shown as stored.

- **Radio options with no value shared one input id.** The `?? 'opt'` fallback
  could not fire, because option resolution returns `''` rather than null.
  Duplicate ids break the `for` that ties each label to its input.

- **The form returned to the wrong tab.** A form kept mounted while `initialData`
  was swapped opened the next record on the previous one's tab. Fixed in two
  steps: 1.7.0's reset was placed after an early return that a swap could skip,
  so it is now cleared before that guard. `activeTabConfig` already falls back to
  the first visible tab, which is what makes clearing safe on its own.

### Internal

Branch coverage rose to 90% in core, 88% in the renderer and 85% in the builder,
and the thresholds moved up to hold it. 1,317 unit tests, 102 e2e.

---

## [1.7.0] — 2026-08-31

Work since 1.6.0: a second long-form field type, and a builder that will open the
per-scope configs the rest of the stack has accepted since 1.4.0.

### Added

- **A `markdown` field.** `textarea` was the only long-form input. The important
  decision is what it stores: **markdown source, never HTML**, so the record stays
  plain text — diffable, portable, safe to log, and impossible to turn into stored
  XSS by writing it to a database.

  It works with nothing configured — the editor is a textarea, and a read-only
  view shows the source with its line breaks preserved and nothing interpreted.
  That default exists because these packages declare no runtime dependencies
  beyond `tslib`, and a markdown parser is a large thing to force on someone who
  wanted a form library. To render, provide `MARKDOWN_RENDERER`, in the same shape
  as `UPLOAD_HANDLER` and the lookup registries; a Preview tab appears only when
  one exists, since without it Preview could only echo the source back.

  Rendered HTML is bound through `[innerHTML]`, so Angular's sanitizer strips
  scripts, inline handlers and `javascript:` URLs — a backstop, not a licence, and
  one the specs assert rather than assume. A renderer that throws falls back to the
  source instead of taking the form down.

  Field types go from 20 to 21. `FIELD_TYPE_CATALOG`, the JSON Schema enum and both
  documented lists move together.

### Fixed

- **The builder can open a config with the same id in two scopes.** `people` ships
  `personal.address` and `work.address`; loading it raised "Duplicate field id" and,
  because an error disables Save, made the whole config a dead end where unrelated
  edits could not be saved either. Id uniqueness is now counted per scope, using
  core's `collectFieldScopes` rather than a second copy of the rule. Two ids in one
  scope remain an error — there they share a control and a record key.

  Relaxing only the check would have turned a safe failure into a corrupting one:
  every matcher in the store compared bare ids, so `mutateField` rewrote *both*
  `address` fields on a rename, `removeField` deleted both, and `moveField` moved
  whichever came first. Each now resolves the target once and matches on identity.

- **A `markdown` field re-renders when its value changes from outside.** Under
  OnPush the rendered output read `control.value`, which is neither an input nor a
  template event, so `patchValue`, a rule or an `autoPatch` mapping left the
  previous document on screen.

### Documentation

- **[How a field is addressed](EXTENDING.md#how-a-field-is-addressed).**
  `refererField` is the substance of 1.4.0 through 1.6.0 and had appeared in no
  documentation file at all. It now leads `EXTENDING.md`: what opens a scope, why
  `[work.address]` is the form to write, and the two errors the model prevents.

---

## [1.6.0] — 2026-08-31

Work since 1.5.0. The headline is that `permissions.edit` now means what it says:
it decides whether the fields are editable, not merely whether a Save button is
drawn.

### Fixed

- **`permissions.edit` is honoured by the fields, not just the actions block.**
  A role outside the edit list received a fully editable form — it could type
  into every field and only discovered the record was not its to change when no
  Save button appeared, which is after the typing rather than before.
  `DynamicFormComponent.isFieldReadonly` consulted the `readonly` input, the
  field's own flag, `readOnlyFields` and the critical-field lock, but never the
  permission. Unlocking a `criticalField` had the same hole, so a viewer could
  open the one control that exists to make an edit deliberate.
- **`DynamicRecordFormComponent` computes permissions at all.** It declared a
  `userRoles` input and read it from nowhere: no `RbacService`, no permissions,
  so the record view was editable for every role. It now resolves them on the
  same terms as the plain form, cached against `config` and `userRoles` and
  invalidated when either changes.

A config that declares no `permissions` is unaffected —
`hasPermission(roles, undefined)` is true, so the unrestricted case stays
editable. That is the common case, and a unit test pins it alongside the denied
case, the granted case, and re-evaluation after a role switch.

**Upgrading:** if you relied on RBAC-denied fields staying editable, they are
read-only now. Pass `readonly="false"` semantics through your own inputs, or
widen `permissions.edit`, whichever matches what you meant.

### Demo

The demo is published at
<https://berserker5619.github.io/Dynamic-Entity/> and now seeds records for
every entity rather than three of eight — `insuranceClaims`, the richest config
here, previously opened to an empty list. It also exposes all three record
presentations the renderer supports: the editable form, the record view with its
per-tab "Edit section" flow, and a data-only view (`isReadOnly`) that had no
route to it, since a role that could edit always saw the Edit section button.

---

## [1.5.0] — 2026-08-30

Work since 1.4.0: nothing in the builder names a field by typing any more, the
validator understands the paths the builder authors, and the rule editor stopped
locking the browser.

### Added

- **`validateConfig` understands field paths, and can check rules.** A `showWhen` keyed
  `[work.address]`, or a cascade parent written the same way, used to be reported as an
  unknown field — the form the builder authors after 1.4.0. Those paths now resolve to the
  one field they name. Pass `rules` (or `--rules rules.json` on `dynamic-entity validate`)
  to apply the same check to a rule's trigger, `compareToField` and field targets; without
  that option, rules remain an `@Input` the config file cannot see and the renderer still
  warns in development.

### Changed

- **The `people` entity in the reference dataset** has an `address` on Personal Details
  and another on Work Details, with `deskNumber` shown only when `[work.address]` is
  `HQ` — a config the validator used to refuse, now the fixture the path tests hold.
- **Every field reference in the builder is now chosen from a list.** 1.4.0 covered the
  rule form; `showWhen`, both ends of a `patchOnTrue` mapping and an `autoPatch` target
  were still text boxes, and the cascade parent was a list of bare ids. All of them offer
  the same field paths. Typing was the one way left to author a reference that names two
  fields at once.
- **A Tab picker on the field inspector.** `moveFieldToTab` shipped in 1.4.0 with nothing
  calling it. Moving a field rewrites its path and repoints the rules that named it.
- **`setActiveTab(tabId, { focusPanel: false })`.** Activating a tab moves focus into its
  panel, which is right for a keyboard user pressing a tab. A quick-jump also switches tabs
  and then focuses the field it was aiming at — and the panel focus runs on
  `requestAnimationFrame`, after `afterNextRender`, so it landed second and took the focus
  back. A caller that will focus something more specific can now say so.

### Fixed

- **The rule editor locked the browser.** `[ngModel]` on the targets multi-select was bound
  to a method returning a fresh array on every call, so `ngModel` saw a new value on each
  change-detection pass: it wrote, which scheduled another pass, which built another array.
  Clicking "Rule" froze the page outright. The array identity is now held stable while its
  contents are unchanged.
- **A new `showWhen` condition seeded the literal string `field`**, which is not a field id
  — so the condition referenced nothing and hid the field until someone noticed. It seeds a
  real field, falling back to the placeholder only when there is nothing else to watch.
- **The cascade parent offered the field as its own parent.**
- **Three capabilities the demo could not reach**, and so nothing tested: the builder always
  opened a blank entity and can now open any saved one; the record editor — the only host of
  the quick-jump links — was never rendered; and no entity marked a field `showOnMinimize`.

---

## [1.4.0] — 2026-08-29

Work since 1.3.0: a field is now addressed by its path rather than its id, so two
tabs may each have an `address`; the builder can relocate a field and show the ones
nested in sub-tabs; and rules are chosen from a list instead of typed.

### Added

- **`dynamic-entity validate`.** `validateConfig` was an API you had to wrap yourself.
  The core package now ships a bin that reads a JSON file, prints every problem, and
  exits 1 when any of them is an error — so a consumer can gate configs in CI with
  `npx dynamic-entity validate ./form-config.json`. `--additional-field-types` and
  `--fail-on-warnings` cover the two options the function already had. This is not a
  new check; it is the existing one on a command line.
- **A stated SSR position, and a job that exercises it.** The renderer is intended to
  work under Angular SSR; the builder is a Material visual editor and is not an SSR
  target. CI packs the published tarballs and calls `renderApplication` on Angular 20,
  so the claim is a passing job rather than the absence of `document` access.
- **Zoneless SSR.** The renderer does not use `NgZone`. CI now
  `renderApplication`s the same form under `provideZonelessChangeDetection()`
  with no `zone.js` on the machine. The demo still loads zone because it is an
  Angular 17 Material app; that is the demo, not the library.
- **A field is addressed by its path.** `refererField` now carries the scopes a
  field's value nests under, then its id — `work.address`. A rule or condition names
  a field by bracketing it, `[work.address]`, and the builder authors that form for
  every new rule. A bare id still resolves, so every config and rule written before
  this keeps working; the runtime emits both keys and `evaluateFormRules` needed no
  change at all. The path is maintained rather than derived: the builder restamps it
  after each structural edit and repoints the rules that named what moved. A
  `refererField` the config declares is never rewritten — it has always been a
  binding override, and taking one over as an identity would silently rebind data.
- **`moveFieldToTab`.** The builder could add, remove, duplicate and reorder a field
  but never relocate one, so a field authored on the wrong tab had to be deleted and
  rebuilt — losing its validators, options and every rule aimed at it.
- **Rule fields are chosen, not typed.** The rule form had a free-text trigger id and
  no targets UI at all, so a rule could only ever act on the field it triggered from.
  Both are now pickers over the config's fields, each option carrying its path, which
  closes the last route to authoring an ambiguous reference.

### Changed

- **Choice-field `any` is gone.** `dropdown` / `radio` / `multiSelect` already
  store a `DropdownOption` (`LocalizedText`) — the displayed text is the value —
  so a generic on the field config would have described a contract the library
  does not have. `getOptionStoredValue` and `resolveOptionValue` return `unknown`
  and `string | number | boolean` rather than `any`, and the three field
  components follow.
- **Field ids are unique per scope, not across the config.** A record nests by tab,
  the form builds a `FormGroup` per tab, and `getControl` already resolved a field in
  its own tab first — so Personal Details and Work Details could each hold an
  `address` all along, stored and submitted separately. Only `validateConfig` refused
  such a config. It now enforces uniqueness within a scope, computed exactly as
  `buildForm` computes it: a tab opens one, a `flatData` tab shares its parent's, a
  `group` field opens one for its children. Two fields sharing an id inside one scope
  is still an error. What cannot be duplicated is an id something *points at* by bare
  name: `showWhen` and cascade parents are reported as ambiguous, and the renderer
  warns in dev when a rule does the same, since rules arrive as an `@Input` the
  validator cannot see.
- **The workspace toolchain moved to Angular 21.** The published peer range was
  already 17–22; only the repo's own build and test stack was still on 17.

### Fixed

- **Fields on a sub-tab were invisible in the builder.** The canvas read a view that
  stopped at top-level tabs — nine of the demo's twenty-eight `insuranceClaims`
  fields never appeared, and could not be selected or restructured. The same view
  also fed the entity-reference picker, which could not offer a nested field as a
  cascade parent, and the drift check, which looked a nested field up, found nothing
  and returned without checking. Showing them exposed a second defect: drag-and-drop
  reorders by index and the canvas passed that index with no tab, so it reordered
  `tabs[0]` regardless of what was dragged. The canvas now renders one drop list per
  tab.

---

## [1.3.0] — 2026-08-29

Work since 1.2.0: `datetime` stopped discarding the time it advertised, `time`
joined the vocabulary, the quick-jump links started working for the fields they
could never reach, and two accessibility specs that had been skipping themselves
started running.

### Added

- **A `time` field type.** A bare time of day, with no date and no zone.
  `TimeFieldComponent` renders `<input type="time">` and stores `HH:mm` — the value
  the input already reads and writes, so the control binds straight through. This is
  deliberately not `datetime`: a 09:00 opening time is not a moment in time, and
  storing it as UTC would move it whenever the offset changed. Twenty field types
  now, one component each.

### Fixed

- **`datetime` rendered a date-only input, so editing truncated the time.** The
  type was in `RichFieldType`, in the published JSON Schema, accepted by
  `validateConfig`, and offered by the builder palette as "Date & Time — Date and
  time picker" — and it resolved to `DateFieldComponent`, whose input is
  `type="date"`. Saving a record whose `datetime` field held a time silently
  dropped it. The two display paths disagreed as well: `formatDisplayValue` showed
  the time, the field's own readonly branch did not. `DateTimeFieldComponent`
  renders `datetime-local`, stores ISO 8601 UTC, and displays with
  `toLocaleString()`. It reads a legacy date-only value as **local** midnight,
  because `new Date('2020-01-01')` is UTC midnight and renders as the previous day
  west of Greenwich — and every value written by the old input has that shape.
- **Quick-jump links did nothing for any field in a sub-tab, and never moved
  focus.** `jumpToField` searched top-level `fields` only, so a sub-tab field was
  never found; its target was a plain `div`, so `el.focus()` was a no-op; and it
  waited on a 50 ms `setTimeout` that touched an unguarded `document` and was never
  cancelled on destroy. It now walks sub-tabs and selects them, schedules with
  `afterNextRender`, and the field slot carries `tabindex="-1"`. There is no longer
  any raw `document` or `window` access in either library.

### Changed

- **Field slots carry `tabindex="-1"`** so a programmatic jump can focus them.
- **The builder's per-file coverage floor rose from 76/50/50/79 to 85/75/85/85**,
  matching the other two packages; global rose to 95/82/97/97. Reaching it meant
  first specs for the canvas and tree-node components, edge coverage for the
  inspector and rules editor, and deleting a dead
  `onDrop`/`fieldTypeLabel`/`fieldTypeIcon`/`fieldLabel` block that the canvas
  extraction had left on `EntityBuilderComponent`.
- **Two accessibility specs stopped skipping themselves.** Both guarded on what the
  fixture happened to contain: the tab-focus spec loaded an entity with exactly one
  tab, so it had never run, and the builder spec needed two rows from a builder that
  opens empty. The suite is 72 passed, 0 skipped.

---

## [1.2.0] — 2026-08-28

Work since 1.1.0: config can be checked before it is stored, a save can be
vetoed, referenced-field drift is visible on the form, and the field components
stopped re-rendering on every change-detection pass.

### Added

- **`validateConfig` and a JSON Schema.** A config is data, so TypeScript cannot
  police it — this repository's own dataset shipped field types that do not exist
  and nothing noticed. `validateConfig` reports every problem (unknown types,
  duplicate ids, `showWhen`/`parentField` pointing nowhere, `colSpan` outside the
  12-column grid). `entity-form-config.schema.json` ships as
  `@dynamic-entity/core/schema` for editor completion.
- **Async validators and an abortable `beforeSave`.** Name them with
  `validators.customAsync` and `provideNgxDynamicEntity({ asyncValidators })`.
  Pending checks block submit. The `${entity}:beforeSave` hook can now return
  `false` or throw to stop the save; `(saveRejected)` reports why.
- **Runtime drift.** `hasDrift` was written by the builder and ignored at
  runtime. A referenced field whose source has changed now shows a `role="status"`
  note naming that source.
- **A stylesheet, a typed field contract, and overridable validation messages.**
  `ngx-dynamic-entity/styles.css` is optional. Custom fields implement
  `DynamicFieldComponentContract`. Messages resolve through
  `ValidationMessagesService`, overridable per key via
  `provideNgxDynamicEntity({ validationMessages })`.
- **`insuranceClaims` in the demo dataset**, with Playwright coverage for the
  happy path, hostile edges, and composed multi-feature flows.

### Fixed

- **`autoPatch` actually appears.** Entity-ref selection publishes after the
  control updates, readonly text tracks the patched value, and hosted fields
  share the form's selection bus so a concurrent form cannot leak a pick.
- **The builder cache is dropped on save.** `ConfigSourceService.clearCache`
  existed and was never called, so a referenced-field lookup after an edit still
  saw the copy loaded before it.
- **`@Input() config` is no longer mutated.** Normalisation is an accessor over a
  copy. The builder's label setters copy only the path to the edited field
  instead of cloning the whole config per keystroke.
- **core no longer publishes its build toolchain.** A derived `dist` manifest
  ships; scripts and `devDependencies` do not.
- Icon-only builder actions have accessible names; builder rows are keyboard
  operable; tab switches move focus into a `tabpanel`; three contrast failures
  below WCAG AA are corrected.

### Changed

- Field components are **OnPush**. External mutations (`markAllAsTouched`,
  `patchForm`, `autoPatch`, `patchOnTrue`) refresh the hosted component so an
  OnPush field does not keep showing a stale value.

### Documentation

- CONTRIBUTING, SECURITY.md, issue and PR templates. `mongodb-memory-server`
  removed from the root (unused, ~200MB).

---

## [1.1.0] — 2026-08-28

The headline of this release is that **1.0.0 could not be installed**. Its peer ranges
admitted Angular 17 only, its `main` field pointed at a path absent from the tarball, and the
builder shipped a wildcard runtime dependency that installed a second copy of the renderer.
Everything below follows from fixing that and then verifying the rest of the claims the
packages were making.

### Upgrading

Behaviour changes that can affect an existing app are listed under **Changed** — most
notably `permissions.view` is now honoured. Everything else is additive or a bug fix.
No config or record migration is required to move from 1.0.0.

### Fixed — packaging

- **Angular 17 through 22 are supported.** Peer ranges were pinned to `^17.0.0`, so
  `npm install` failed with `ERESOLVE` on any newer Angular. Each major is now verified in
  CI by installing the packed tarballs and AOT-compiling a consumer component.
- **`main` no longer points outside the tarball.** A hand-written `main` was copied verbatim
  into the published manifest, where it resolved to `dist/dist/…`. Anything falling back to
  `main` — Jest's resolver, CJS `require`, SSR tooling — could not load the package.
- **The builder no longer installs a second copy of the renderer.** `ngx-dynamic-entity` was
  declared as both a wildcard `dependency` and a `peerDependency`. Because Angular resolves
  `InjectionToken` by object reference, a duplicate copy meant registries provided by the
  host application were invisible to the builder and fields rendered blank.
- `@angular/material` and `@angular/cdk` are no longer peers of `ngx-dynamic-entity`, which
  imports neither. The builder still requires both.
- `sideEffects: false` added to `@dynamic-entity/core`.
- `repository`, `homepage`, `bugs` and `author` added to all three manifests.

### Fixed — correctness

- **Submission is blocked while a `validation` rule is failing.** `submit()` checked only
  Angular form validity, while the record editor's `saveSection()` also honoured rule
  errors — so the same rule blocked one save path and merely showed a banner on the other,
  and anything wired to `(formSubmit)` persisted records the rules engine had rejected.
- **A hidden required field no longer deadlocks the form.** Fields hidden by a rule or a
  `showWhen` condition kept their validators, holding `form.invalid` true forever with the
  Save button disabled and nothing on screen to explain it. Hidden controls are now disabled,
  which excludes them from validity while preserving their values and validators.
- **`permissions.view` is enforced.** It was computed and discarded: a user whose roles
  failed it still received the complete form with every value in the DOM.
- **The record editor's summary reads through the tab nesting.** It read values flat while
  the form patched by tab path, so a flat record rendered real values in the summary over a
  form whose controls were all empty — data loss disguised as a successful load.
- **Dot-paths cannot reach an object's prototype.** `setValueByPath` walked config-supplied
  paths with no guard, so a `refererField` of `__proto__.isAdmin` polluted
  `Object.prototype`. `__proto__`, `constructor` and `prototype` are now refused on both the
  read and write paths.
- **Drift detection is key-order independent.** It compared with `JSON.stringify`, so a
  config round-tripped through a backend that orders keys differently reported drift on every
  referenced field.
- **`SYSTEM_DEFAULT_CAN_EDIT` receives real roles.** It was invoked with a hardcoded empty
  array, so any predicate that inspected roles answered `false` for everyone. The token was
  also declared twice under the same name in two packages; since token identity is by
  reference, providing the documented one did nothing. There is now a single token.
- **The email validator no longer collides with `pattern`.** The builder expressed "email" by
  writing a regex into `validators.pattern`, so a field could not have both, a custom pattern
  made the Email box appear ticked, and un-ticking Email deleted the pattern.
- **Referenced-field drift is checked against the edited field**, not whichever field happened
  to be selected.
- The builder's remove, duplicate, move and reorder now reach fields on sub-tabs, and id
  uniqueness is validated across the whole tree rather than top-level tabs only.

### Added

- **Schema migration.** `EntityFormConfig.version` and `VersionedRecord._configVersion` were
  declarations nothing read. `@dynamic-entity/core` now exports `migrateRecord`,
  `needsMigration`, `stampRecord`, `validateMigrations` and the `RecordMigration` type — pure,
  so the same steps run in a browser and on a server. Register them with
  `provideNgxDynamicEntity({ migrations })` and they are applied where a record enters the
  form. An unstamped record is deliberately left alone, and a gap in the chain throws rather
  than half-upgrading. See the README's **Schema versioning** section.
- **A dev-mode warning when `initialData` is silently dropped.** A record is nested by tab id
  unless the tab sets `flatData: true`; passing a flat record to a nested tab populated
  nothing and reported nothing. The renderer now names the keys that went unused.
- **`registerFieldType`** opens the field-type catalog. The lookup index was frozen at module
  evaluation, so a custom type pushed onto `FIELD_TYPE_CATALOG` was invisible to the builder's
  palette and to `createFieldConfig`.
- **All 18 field components are exported.** Only 8 were, which defeated the
  `provideFieldTypes({ … })` tree-shaking seam the package documents: wanting eleven of them
  meant bundling all of them.
- `FieldValidators.email` and `FieldValidators.custom`. Custom validators registered through
  `provideNgxDynamicEntity({ validators })` were reachable only from the untyped `string[]`
  form, so naming one from a typed schema required casting to `any`.
- `DynamicFormComponent.canDelete`, `canView`, `ruleValidationErrors` and `submitBlocked`.
- `EntityBuilderComponent.userRoles`, distinct from `availableRoles` — who is editing, rather
  than the role vocabulary a schema may reference.
- `HookFn` type, replacing `Function` in the hook registry.

### Changed

- `permissions.view` now hides the form. Previously it was ignored, so a config that set it
  rendered as though it had not. **This is presentational only** — masking and permissions
  stop the browser drawing data, they do not stop it reaching the browser. Authorize on the
  server.
- The builder writes `validators.email` instead of a regex in `validators.pattern`. Configs
  authored by the previous builder are still recognised, and are migrated as they are edited.
- `ConnectionSourceConfigComponent` has been **removed** from
  `ngx-dynamic-entity-builder`'s public API. It wrote a `connectionSource` property that is
  not part of `NestedFieldConfig` and that nothing read.

### Documentation

The READMEs described an API the packages did not have, and the Quick Start did not compile.
Removed: the `SHOW_WHEN` / `ENABLE_WHEN` / `REQUIRE_WHEN` / `CALCULATE` rule types (the real
action types are `visibility`, `validation` and `info`), the `READ_WRITE` / `READ_ONLY` /
`MASKED` / `HIDDEN` permission levels (the model is `view`/`edit`/`delete` role lists plus
`maskData`), and "dynamic table rendering" — the package ships no table. Corrected the field
type list (19 types, `entity-ref` not `entityRef`), the Quick Start bindings (`initialData`
and `userRoles`, not `initialValue` and `role`), and `FIELD_CATALOG` → `FIELD_TYPE_CATALOG`.
Added sections on record shape, security, styling and schema versioning.

Every fenced code block in every README is now extracted and compiled in CI.

### Internal

- CI was an empty directory. There are now three workflows: verification (lint, build, test,
  coverage) plus an Angular 17–22 consumer matrix and a README-snippet compile; a Playwright
  job; and a tag-driven release that verifies before it publishes and authenticates through
  npm trusted publishing rather than a long-lived token.
- eslint could not load a TypeScript file — `@typescript-eslint/parser` was declared but never
  installed — so every rule had been dormant and `lint` had quietly become `tsc --noEmit`.
- `npm run test:coverage` had never passed in any package. It does now, in all three.
- Deleted `src/lib/stores/`, an abandoned extraction of 162 unreferenced lines.
- `test_data.json` used three field types that do not exist; the spec that "rendered" it
  watched only for uncaught exceptions and passed green over them.

---

## [1.0.0]

Initial public release.

[1.2.0]: https://github.com/berserker5619/Dynamic-Entity/releases/tag/v1.2.0
[1.1.0]: https://github.com/berserker5619/Dynamic-Entity/releases/tag/v1.1.0
[1.0.0]: https://github.com/berserker5619/Dynamic-Entity/releases/tag/v1.0.0
