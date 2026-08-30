# Changelog

All notable changes to `@dynamic-entity/core`, `ngx-dynamic-entity` and
`ngx-dynamic-entity-builder`. The three packages share a version and are released together.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
