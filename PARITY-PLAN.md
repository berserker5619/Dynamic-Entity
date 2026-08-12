# Parity Plan — Superpower_Web Dynamic Entity V2 → packages

_Target: the form-side feature set in `projects/Superpower_Web/docs/dynamic-entity-v2-architecture.md` (2127 lines, updated 2026-06-25), reproduced exactly in `@dynamic-entity/core` + `ngx-dynamic-entity` + `ngx-dynamic-entity-builder`._

_Status: **Phases 1–6 shipped.** 804 unit tests + 2 demo Karma + 50 e2e; build, lint, coverage and e2e green. Phases 7–9 outstanding._

| Phase | State |
|---|---|
| 1 — Record shape, `flatData`, `refererField` | ✅ shipped (`a5f7a71`) |
| 2 — Option value contract | ✅ shipped (`a5f7a71`) — see deviation note in §2 |
| 3 — Tab model completeness | ✅ shipped (`fe36e86`) |
| 4 — Record editor parity | ✅ shipped |
| 5 — Entity reference caching + preload | ✅ shipped |
| 6 — Named lookup lists (`listName`) | ✅ shipped |
| 7 — Builder tree + dialogs + test hooks | 🟡 7.3 shipped; 7.1, 7.2 outstanding |
| 8 — Referenced fields + drift | ⬜ design first |
| 9 — Material UI layer | ⬜ not started |

Phase 6 was previously "named lookup lists **+ referenced fields**". The two are unrelated —
one resolves a list by name, the other reads *another entity's config* — and only the first was
specified. Referenced fields are now §8, behind a design gate.

---

## 0. Ground rules

Three things about "ditto perfect same" that could not all be true at once. All three are settled; kept here because they explain why the packages differ from the reference where they do.

**0.1 — Two features were contract breaks, not additions.** Record shape (§1) and option values (§2) changed the data these packages read and write. Both shipped together, deliberately: shipping them apart would have broken consumers twice.

**0.2 — UI toolkit: Angular Material, not PrimeNG. _(decided)_** Behavioural parity is exact; the visual layer is rebuilt on Material rather than reproducing PrimeNG markup. The builder already uses Material; the renderer is still dependency-free HTML and moves onto Material in §9. Where a PrimeNG construct has no Material equivalent, the closest Material pattern wins — no PrimeNG dependency is added.

**0.3 — The reference's open bugs were not ported.** Its issue registry lists defects still open there. Copying "exactly" would have imported them:

| Ref | Defect | Plan |
|---|---|---|
| #7 | Rename entity deletes old key then re-POSTs; same key → unique violation | Not applicable — no backend here |
| #8 | `confirmAddModuleTab` predicts the tab id via `labelToId` but `addTab` generates its own → updates the wrong tab | Avoided — `addTab()` returns the real id (§3) |
| #16 | `clearCache()` drops all entity options, no granular invalidation | Fixed (§5) — invalidation is per entity |
| #18 | `getTabData()` may not resolve 3-level nesting consistently | Fixed (§1) — explicit path resolution, pinned by tests |
| #22 | `labelCache` per service instance, lost on refresh | Fixed (§5) — pluggable cache store |

Listed as deviations so each difference is deliberate and reviewable.

---

## 1. Record shape — per-tab form groups, `flatData`, `refererField` (shipped)

`DynamicFormComponent` builds one `FormGroup` per tab, recursing into `tab.children`, and
stores a record at `doc.tabId.fieldId` — or at `doc.fieldId` when the tab sets `flatData`.
Reads go through `getTabData`, writes through `setTabData` + `normalizeArrayStructures`;
`refererField` overrides the binding path. `getControl()` is tab-aware, and rules still see a
flattened view so their semantics did not change.

Before this, every field lived in one flat `FormGroup` keyed by `field.id`, so a nested record
silently dropped its values. `core` already had the `flatData`-aware helpers and nothing called
them.

**Breaking:** `initialData` / `formSubmit` moved from a flat bag to the nested record shape.

Covered by `record-shape.spec.ts`: the doc's four `flatData` combinations, 3-level nesting
(defect #18), `refererField`, array normalisation, and a load to edit to save round trip.

## 2. Option value contract (shipped)

Reference (§4.6, and the backend `options: [Mixed]`): **the stored value IS the `LocalizedText` object** — `form.value.status === { en: 'Active', de: 'Aktiv' }`. There is no `value`/`label` wrapper.

Ours: `DropdownOption { value: any; label: LocalizedText }` with a scalar value.

**Shipped, then tightened to one shape.** The first cut left `DropdownOption` as a permissive four-way union, which made the public type unnarrowable and let a single field mix shapes. **Decided: language-keyed object only.**

```ts
export type DropdownOption = LocalizedText;                 // the one canonical shape
export type RawDropdownOption =                              // parse boundary only
  LocalizedText | { value: unknown; label: LocalizedText | string } | string | number;
```

`normalizeOption()` upcasts every legacy shape at the parse boundary, so old configs still load — a `{ value, label }` wrapper keeps its **label**, since the label is what the user picked and the displayed text is the stored value. All 503 options in `test_data.json` were already canonical, so the reference data needed no change.

Knock-on effects, all shipped:
- The builder's option editor is **one input per option**, not Value + Label. `setOptionValue` is gone — there is no separate value to set.
- The renderer re-exports `resolveLabel`, `resolveOptionLabel`, `formatDisplayValue`, `valuesMatch`, `normalizeOption`, `normalizeConfig`. A consumer now holds objects as values and needs these to render them without depending on `core` directly.
- Demo records store the option object (`status: { en: 'Active' }`), matching the reference contract.

**Known limitation:** a record saved under the old scalar (`"active"`) no longer matches an option whose text is `"Active"` — case differs, so `valuesMatch` fails and the raw stored text is displayed rather than an em dash. Pinned by a test. Migrating stored records is a consumer-side data task, deliberately out of scope.

The enforcement point matters: `normalizeConfigOptions()` runs where a config enters the
library — `DynamicFormComponent.ngOnChanges` and `BuilderStore.load()`. Without it the type
would be a compile-time claim the runtime never checks, which is what the first cut shipped.

---

## 3. Tab model completeness (shipped)

Nested tabs (`children`) with sub-tab navigation in the renderer and a tree in the builder;
`moduleName` / `moduleInputs` rendering a consumer component in place of fields via the
previously-unused `COMMON_MODULES_REGISTRY`; `isPrimaryTab`, `visibility`, `maskData` and
`systemDefault` authorable per tab.

**Decided — `systemDefault` protection is consumer-supplied.** A guard token provides
`canEditSystemDefaults` / `canAddToSystemTab`; the library never hardcodes `IT` or `SuperUser`
role names, and fails closed when no provider is given.

One bug fixed here later: `addTab()` only checked top-level ids, so with nested tabs a new
top-level tab could take an id a sub-tab already held. Tab ids are record storage paths, so
that made two tabs write to the same key.

## 4. Record editor parity (`EntityRecordComponent`) (shipped)

- **Per-tab section editing** — `editingTabId` with edit/save/cancel, validating the edited tab
  only: Angular validity of that tab's controls plus rules narrowed by `filterRulesForTab`. A
  required field on an untouched tab cannot block the tab being worked on (the reference's
  OV0-968 fix). New `sectionSave` output emits the tab id and the record.
- **Inline array-row editing** — a drawer built from `field.children`, rendered outside the tab
  panel as the reference does, to avoid racing the tab's own initialisation. Nothing reaches
  the `FormArray` until the row is saved.
- **`isProfileImage`** avatar from a persisted `FileRef`, falling back to the initial letter,
  and **`isHeaderToggle`** as a record-level status switch that bypasses section editing.
- **Dismissible info banners**, keyed by field id, persisting until dismissed rather than until
  the triggering value changes. Re-armed when a different record loads.
- **`changeDebounceMs`** (default 0; the reference uses 300 ms) and **`preview`**, which seeds
  one empty array row then disables the form.
- **`isReadOnly`** and **`readOnlyFields`**, folded with the field's own flag and the
  `criticalField` lock into a single `isFieldReadonly()`.

**Decided — `viewMode` defaults to true**, matching `EntityRecordComponent`: the record opens
read-only with a per-tab Edit control. Consumers set it false for a directly editable record.

Deliberately excluded: `stageActions` / `canMoveToNextStage`, which are PrimeNG `MenuItem[]` and
app-domain workflow. A generic action slot is the right shape if it is ever needed.

**Lesson worth keeping:** three separate stale-read bugs came from the record editor reading
`dynamicFormComp` (a ViewChild) during render. The rule now is that this component owns its own
state and the child reports changes through outputs (`activeTabChange`); row lists derive from
the record value signal, not the child's `FormArray`.

## 5. Entity reference parity (shipped)

`EntityReferenceService` puts three layers in front of consumer loaders: resolved options per
(entity, lang, displayFields, filters, and parentValue where the loader filters by it); the
in-flight Promise, so N fields referencing one entity trigger one load rather than N; and a
synchronous label cache for rendering a stored reference without awaiting a load.

Cache keys come from a pure core helper that sorts `displayFields` and stably serialises
filters, so two orderings of the same filters share one entry.

`CascadeDataService` gained the preload API — `initializeCascadeData()`,
`getCachedChildOptions()`, `waitForData()`, `clearCache()`. Where a cascade can be resolved
locally (`lookupFilter` / `lookupPath`) the unfiltered set is fetched once and filtered per
parent; otherwise `parentValue` goes to the loader and is folded into the cache identity.

Both reference defects are fixed rather than ported: **#16** invalidation is per entity, not
global; **#22** the store is pluggable via `ENTITY_REF_CACHE_STORE`, so a consumer can make the
cache outlive a refresh — the default stays in memory, since a library must not silently
persist tenant data.

One bug fixed here: a failed load was cached as an empty result, so a single transient error
served an empty dropdown permanently. Failure now rejects, the caller still gets an empty list,
and nothing is written.

Special entity keys (`system:company`, `system:location`, and so on) resolve through
consumer-registered loaders — no built-in behaviour.

## 6. Named lookup lists (`listName`) (shipped)

Model fields with no runtime, confirmed by grep across both Superpower codebases.

| Feature | Work |
|---|---|
| `listName` | **Required — decision reverted.** A named, centrally-managed option list resolved through a new `LOOKUP_REGISTRY`. **This phase**, §6.1–6.4. |
| `lookupSource` | **Dropped _(decided)_.** Dead in Superpower_Web *and* in Superpower-App: stored, Joi-validated and copied on sync, but read by no service, pipeline or component. Removed from `NestedFieldConfig`; configs carrying it still round-trip, since `normalizeField` spreads unknown keys. |
| `isReferenced`, `referencedEntityKey`, `referencedFieldId`, `referencedSnapshot`, `hasDrift` | Live field references across configs, the referenced-field dialog and drift detection. **Split out to §8** — it needs a config-source boundary the library does not have. |
| `systemDefault` | Edit/delete protection (§3). |
| `table.*` (`isName`, `isStatus`, `arrayVisible`, …) | Already in the model; consumer-facing metadata only — **no work**, we ship no table. |

### 6.1 The list contract

The reference has a real feature behind this: `list.service.ts` fetches master lists by name
(`getListByNames`), and `mapDropdown(listName, allLists, lang)` turns one into options. A
master list is `{ listName, listValues: [{ code, name: { en, de }, sortOrder, _id }] }`.

Note what its mapper does: it displays `name[lang]` but stores `name['en']` as the value. Our
canonical option is the whole `LocalizedText`, which carries every language — strictly better,
and it means a list value maps to an option directly with no lossy projection.

**Delivered**
- `core`: `LookupListValue` type, `normalizeLookupValues()` — sorts by `sortOrder`, tolerates
  bare strings and `LocalizedText`, keeps `_id` / `code` / `isSystemDefined` / `from` — and
  `lookupValuesToOptions()`, which projects the values onto `DropdownOption`. Two functions
  rather than the one this section first named: a single normalise-and-project call would have
  thrown away the metadata the same section promises to expose. Values without a `sortOrder`
  keep their incoming order, after those that have one.
- `renderer`: `LOOKUP_REGISTRY` token (list name → values, as array/Promise/Observable) and a
  `LookupRegistryService` with three layers, the same shape as `EntityReferenceService` since
  one list is typically used by many fields: resolved options per (list name, lang); the
  in-flight Promise, so N fields on one list trigger one load; and the **synchronous label
  layer** of §6.2.
- `dropdown`, `radio` and `multiSelect` resolve options through one path: inline `options` win,
  else `listName` through the registry. Placement is §6.3.
- `builder`: data source is `none` | `manual` | `lookup`, with the reference's mutual exclusion —
  picking one clears the other, and authoring an inline option moves a field back to `manual`.
  The inspector swaps the option editor for a list-name input. Config validation warns about a
  missing **list name** rather than missing options for a lookup-backed field.

  **Deviation — no `entity` source.** The reference offers it as a fourth value; here an entity
  reference is a field *type* (`entity-ref`), not a source a dropdown switches to, so offering
  it would mean mutating a field's type — and rebuilding its control — from a source picker.
  The exclusion that matters within a choice field is inline options vs `listName`.

  The builder does **not** offer a picker of registered list names: that would make
  `ngx-dynamic-entity-builder` depend on `ngx-dynamic-entity` for a hint, and a config is often
  authored before the app registers its lists. The name is free text.

### 6.2 Read-only is the primary render path — the registry needs a synchronous label layer _(decided)_

§4 settled `viewMode` to default true, so a record **opens read-only** and the first thing
`listName` has to do is render a stored value as text. The read-only branch of the three
choice components resolves that text by scanning `field.options`
([dropdown-field.component.ts:88](packages/ngx-dynamic-entity/src/lib/field-types/dropdown-field.component.ts#L88)).
Under `listName` that array is empty until the registry resolves, so a naive async-only
registry paints the raw stored text, then flips to the label — on every record open.

`EntityReferenceService` already solved exactly this in §5 with a synchronous label cache.
`LookupRegistryService` gets the same: `labelFor(listName, value, lang): string | undefined`,
reading the resolved store without awaiting, returning `undefined` on a miss so the caller
keeps its existing fallback. **The read-only path never awaits.** A list already warmed by any
other field on the page renders correctly on first paint; a genuine cold miss falls back to the
stored text, which is the §2 contract's own display value and therefore never wrong, only
unlocalised.

Pinned by tests: cold miss, warm hit, and one list feeding two fields loading once.

### 6.3 Where options resolve — injected service, five inputs unchanged _(decided)_

"Resolve in one place" means **one service, injected by the three components** — not a sixth
input pushed down by the parent. ADR-008 fixes the field-component contract at five inputs
(`field`, `control`, `language`, `readonly`, `masked`), and
[dynamic-field.component.ts](packages/ngx-dynamic-entity/src/lib/form/dynamic-field/dynamic-field.component.ts)
sets exactly those via `setInput()` for every type. Widening it for one feature would fork the
mounting engine.

The precedent is already in the codebase:
[entity-ref-field.component.ts:62-109](packages/ngx-dynamic-entity/src/lib/field-types/entity-ref-field.component.ts#L62-L109)
injects `CascadeDataService`, owns an `options` signal and a `loading` signal, and keeps its
five inputs. `dropdown`, `radio` and `multiSelect` follow that shape: an `options` signal seeded
synchronously from inline `options`, resolved through `LookupRegistryService` when `listName` is
set. The single resolution point is the service, not a component and not the form.

**One correction found while building it:** the trigger is the `field` / `language` **input
setters**, not `ngOnChanges`. `ngOnChanges` fires only for inputs Angular itself sets, and these
components are exported — a consumer holding a `ComponentRef` (and every existing field spec)
assigns `.field` directly, which would have rendered no options at all. `refreshChoiceOptions()`
holds the wiring so the three call sites stay one line each.

### 6.4 Value identity — text, not `_id` _(decided)_

A list value carries a stable `_id` and `code`, but the reference stores `name.en` — the text —
as the option value, and hedges with `isMatching(value | id | label)`. We keep **text as the
value**, consistent with §2, rather than storing an id for `listName` fields only.

The trade-off, accepted knowingly: renaming a list value orphans records saved under the old
text. That is worse here than for inline options, because master lists are centrally managed —
one admin edit reaches every record in every entity using that list. Treat a list-value rename
as a data migration.

Rejected alternative: store `_id`/`code` for `listName` fields and resolve text for display.
Correct for renames, but it gives `listName` fields a different value shape from inline-option
fields, reintroducing exactly the two-shape ambiguity §2 removed.

**Two mitigations ship with it**, neither of which touches the value shape. Accepting orphaning
is not the same as making it undetectable, and §8 detects drift for the analogous problem on
referenced fields:

- **`valuesMatch` matches on any language key, not just the active one.** Renaming the German
  text of a list value must not orphan a record whose English text still matches — the
  comparison was language-scoped, so it would have. Two objects match on a shared key; an object
  and a scalar match when any of the object's texts equals it, which covers a legacy
  single-language record. Note what this does *not* do: `resolveLabel` already falls back to the
  first available language, so two objects with no language in common but the same spelling
  matched before this and still do. This adds a rule; it tightens nothing.
- **`findUnmatchedValues(record, config, lists)` in `core`** — pure, returns every stored choice
  value with no matching option in its field's current list, as
  `{ path, tabId, fieldId, listName?, value }`, walking nested tabs, groups and array rows and
  indexing multiSelect entries. Covers inline options too, not only named lists. A field whose
  list is not supplied is **skipped, not reported** — unknown is not unmatched. That is the
  report a consumer needs to run a rename migration. The library reports; it never rewrites
  stored data.

The backend's `listValues` also carry `isSystemDefined` and `from`, which the reference's
`mapDropdown` drops. Expose them on the value type so a consumer can act on them (e.g. block
deleting a system-defined value); the library itself will not.

---

## 7. Builder parity + test hooks

Three separable pieces, listed in risk order so the tree can slip without blocking the rest.

### 7.1 Tree editor — the risk

`ListNodeComponent` equivalent: recursive tab/field tree with drag-drop, replacing the current
flat palette+list. Recursive drag-drop across three nesting levels is the only genuinely
uncertain work in this phase; everything else is ordinary. Ship it behind its own commit so a
schedule problem here does not hold 7.2 or 7.3.

### 7.2 Dialogs and dirty tracking — ordinary

- **Connection-source config dialog.** (The **referenced-field dialog** moves to §8 with the
  rest of that feature — a dialog for a runtime that does not exist is not shippable.)
- Dirty tracking and unsaved-changes guard.
- **`applyEditorToField` semantics**, minus the id-change path. **Decided: keep the current id behaviour, do not revert to the reference's free-text ids.** New fields derive their id from the label; a config loaded from storage keeps every id it arrived with, because records are already stored under them. That is exactly the "new fields follow label→id, existing data untouched" rule, and it is already implemented and tested — no work in this phase.

### 7.3 Test hooks for the Material rewrite — renderer work, carried here deliberately (shipped)

§9 rewrites the markup that all 46 e2e specs assert against, and §9's stated mitigation was
"budget for reworking those selectors". Most of that cost is avoidable, and the avoiding has to
happen *before* the markup churns:

Shipped ahead of 7.1 and 7.2, because the tree editor breaks the same selectors §9 does:
`.deb-field-row` alone had 22 assertions across five specs.

**The contract**
- A field root is `field-{fieldId}` and also carries `data-field-type`. Both exist because
  every *part* id also starts with `field-`, so `[data-field-type]` is the only way to say
  "a field" without matching its own children.
- Parts are `field-{fieldId}-{part}`: `input` / `value` / `masked` / `error` / `hint` /
  `loading`, `month` and `year` for monthYear, and `add` / `row` / `remove-{i}` for arrays.
- Form shell: `form-panel`, `module-panel`, `tab-strip`, `tab-{id}`, `subtab-{id}`,
  `form-actions`, `form-submit`, `form-reset`, `form-error`, `info-banner-{key}`,
  `rule-error-{key}`, `rule-warning-{key}`.
- Builder: `builder-field-row` (repeated, countable), `row-id-{id}`, `row-label-{id}`,
  `row-up|down|duplicate|delete-{id}`, `palette-{type}`, `tab-row-{id}`, `option-row`.

**State**: all 50 e2e specs assert through hooks or roles — **zero** presentational selectors
remain. Verified by renaming `deb-field-row`, `deb-field-id` and `deb-field-label` in the
builder template and re-running the builder-heavy specs: 13/13 still passed, which is the
property this phase exists to buy.

From here `data-testid` is the contract the e2e suite asserts on; class names are presentation
and free to change. Doing this inside §9 would have meant changing markup and selectors in the
same commits, which is how a rewrite loses its safety net.

---

## 8. Referenced fields + drift

_**Design gate.** This section is a problem statement, not yet a plan. It is not estimable — and
must not be started — until the three questions below are answered in writing here. It was
previously a single table row inside phase 6 sized M; it is at least L._

`isReferenced`, `referencedEntityKey`, `referencedFieldId`, `referencedSnapshot` and `hasDrift`
let a field in one entity's config track a field defined in **another entity's config**, and
flag when the source has changed under it.

**The boundary problem.** These libraries take exactly one config as an input. There is no
abstraction that hands you a second one:
[injection-tokens.ts](packages/ngx-dynamic-entity/src/lib/tokens/injection-tokens.ts) provides
registries for entity refs, field types, validators, hooks, common modules, uploads, the cache
store and the system-default guards — and nothing that resolves a config by entity key. In the
reference this is free, because the app has an API and a store; here it is a new seam through
the library's outer wall, and it is the whole of the work.

**Answer before starting**

1. **The seam.** A `CONFIG_SOURCE` token — `(entityKey) => EntityConfig | Promise | Observable` —
   with the same caching and in-flight de-duplication as `ENTITY_REF_REGISTRY`, and the same
   fail-closed behaviour when unprovided. Is a config source a thing this library is willing to
   depend on at all, or does the builder pass a config map in as an input and the renderer never
   resolves references at runtime? That choice decides everything below.
2. **When drift is computed.** On builder load only, or in the renderer too? Comparing
   `referencedSnapshot` against a live source on every render costs a config fetch per reference;
   computing it at author time only means a config can go stale in production undetected.
   Recommendation: **builder-load only**, with an explicit `refresh()` — drift is an authoring
   concern, and the renderer already has the snapshot it needs to render.
3. **What a drifted field renders as.** The snapshot's shape, the source's current shape, or a
   disabled field with a warning? Recommendation: **render the snapshot**, so a record stays
   editable and drift never breaks a running form; surface drift in the builder.

Then, and only then: the referenced-field dialog, snapshot capture, and the drift indicator.

---

## 9. UI layer — Angular Material

_Decision 0.2. Behavioural parity is exact; visual parity is "Material equivalent", not pixel-matched to PrimeNG._

The builder is already Material. The renderer's 18 field components are hand-rolled HTML with `ngx-field__*` classes and no Material dependency.

**Deliver**
- Rebuild the field components on Material: `mat-form-field` + `matInput` (text, textarea, number, currency, email, password), `mat-select` (dropdown, multiSelect, entity-ref), `mat-radio-group`, `mat-checkbox` / `mat-slide-toggle` (checkbox, boolean), `mat-datepicker` (date, datetime, monthYear), and Material surfaces for group/array/image/file.
- Tabs move to `mat-tab-group`; info/warning/error banners to a Material surface; the criticalField lock to `mat-icon-button`.
- Keep every current behaviour: the 5-input contract (ADR-008), masking, readonly rendering, contextual error messages, the lock, cascade hints.

**Contract change** — `@angular/material` and `@angular/cdk` are currently **optional** peer
dependencies of `ngx-dynamic-entity` (`peerDependenciesMeta.optional: true` in
[package.json](packages/ngx-dynamic-entity/package.json)). They become **required**. That is a
real cost for a consumer who wanted a dependency-free renderer; flagging it rather than burying
it. This is the change that sets the 1.0 line — see **Versioning and release**.

**Risk** — this rewrites the components the existing e2e specs assert against. §7.3 moves the
mitigation forward: by the time this phase starts, the suite asserts on `data-testid` hooks
rather than on `.ngx-field__input` and bare `option` elements, so the markup can change under a
green suite. What remains is genuine rework — interaction differences between a native `select`
and `mat-select`, and the overlay-based components (datepicker, select) needing different e2e
handling. Budget for that, not for a selector sweep. Last on purpose: behaviour settles before
markup churns.

---

## 10. Explicitly out of scope

Not portable into a form library; these belong to the consumer app or the backend.

Backend/API (`/configuration/dynamic_entity_v2`, `/formRule`, `/preferences`, connections API) · MongoDB pipeline (`buildDynamicEntityPipeline`, `correctPath`, `buildDisplayExpression`, `$lookup` label building) · `entity-data-table`, table preferences, `buildFlatRows`, `ArrayReadTableComponent` · Connections virtual tab (needs the connections API) · `syncDynamicFormsToMenu`, `showInMenu`, `entityFilter` · Mongoose plugins, factory models, audit.

`FieldTableConfig` stays in the model as consumer-facing metadata.

---

## Sequence and effort

| # | Phase | Depends on | Breaking | Size | State |
|---|---|---|---|---|---|
| 1 | Record shape / `flatData` / `refererField` | — | **Yes** | L | ✅ |
| 2 | Option value contract | — | **Yes** | M | ✅ |
| 3 | Tab model completeness | 1 | No | M | ✅ |
| 4 | Record editor parity | 1, 3 | No | L | ✅ |
| 5 | Entity reference caching + preload | — | No | M | ✅ |
| 6 | Named lookup lists (`listName`) | 3 | No | M | ✅ |
| 7 | Builder tree + dialogs + test hooks | 3, 6 | No | L | ⬜ |
| 8 | Referenced fields + drift | 6, 7 | No | L+ | ⬜ design first |
| 9 | Material UI layer | 4–8 | **Yes** (peer deps) | L | ⬜ |

1 and 2 landed together, as planned — both were contract changes, and shipping them separately
would have broken consumers twice.

The ordering rules that are not arbitrary: **9 goes last** because it churns the markup every
e2e spec asserts against, so behaviour settles first — and §7.3 puts stable test hooks in place
one phase ahead of it. **8 sits behind 7** because the builder tree is where a referenced field
is authored, and behind its own design gate because its cost is a new library boundary, not a
feature. **8 is not on 9's critical path** in any way except sequence: if its design gate does
not close, ship 9 without it.

**Next**: 7 (builder tree, dialogs, `data-testid` hooks), then 8's design gate, then 9.

**Gate for every phase**: `turbo run build test lint` green, coverage thresholds held or raised, and e2e proving the feature in the browser. Same bar as the work already merged.

Thresholds are a ratchet, not a target: they sit just under the current numbers and move up when
coverage genuinely improves (core 92/84/96/96, renderer 95/81/96/97, builder 95/75/95/96 —
statements/branches/functions/lines). A test that cannot fail is worse than no test; the suite
carries no conditional assertions or swallowed failures.

---

## Versioning and release

Three phases in this plan are breaking, and until now the plan said so without saying what it
costs. It currently costs nothing, and there is a narrow window to keep it that way.

**Where things stand.** All three packages are at `0.1.0`; the repo has one tag, `v0.0.1`; no
package declares `publishConfig`; there is no changelog. Nothing has been published to a
registry — so phases 1 and 2 broke no external consumer, and neither will 6–9.

**The rules from here**

- **Pre-1.0, breaking changes are free — spend them now.** Every contract change this plan
  contemplates lands before 1.0. Anything that ought to break should break in 6–9, not after.
- **`@dynamic-entity/core` and `ngx-dynamic-entity` version in lockstep.** The renderer's peer
  range on core is `^0.1.0`, which under semver matches only `0.1.x` — a core minor bump is
  already a renderer release. Treat the three packages as one release unit rather than
  pretending they version independently.
- **§9 is the 1.0 line.** It flips `@angular/material` and `@angular/cdk` from optional to
  required, which is the last planned break. Cut `1.0.0` when §9 lands; after that, peer-dep
  and contract changes cost a major.
- **Before any publish** (blocking, small): `ngx-dynamic-entity` and `ngx-dynamic-entity-builder`
  have no `files` field, so they would publish the whole working tree — `core` already restricts
  to `dist`. Add `files`, `publishConfig.access`, `repository`, `license` and a `sideEffects`
  flag for tree-shaking, and start a changelog at the first tag that matters.

**Not decided here**: whether these packages get published externally at all, or stay internal
to the Superpower apps. The rules above hold either way; only the urgency of the last bullet
changes.

---

## Decisions — all resolved

| # | Question | Decision |
|---|---|---|
| 1 | Visual parity? | **Both** — behavioural parity exact, visual rebuilt on **Angular Material**, not pixel-matched to PrimeNG. No PrimeNG dependency. (§9) |
| 2 | Option values | **Follow Superpower_Web** — `LocalizedText` is the stored value. Superseded in detail by #5. (§2) |
| 3 | Field ids | **New fields derive from the label; existing data keeps its ids.** No revert to the reference's free-text ids. (§7) |
| 4 | Role checks | **Consumer-supplied predicates** via token; no hardcoded role names, fail closed when absent. (§3) |
| 5 | Option shape | **Language-keyed object only.** Narrowed; legacy shapes upcast at the parse boundary. (§2) |
| 6 | Material peer deps | **Accepted** — `@angular/material` + `@angular/cdk` move from optional to required on `ngx-dynamic-entity` in §9; this is the 1.0 line. |
| 7 | Lookup lists | **`listName` in, `lookupSource` out.** The latter is dead in both the web app and the API. (§6) |
| 8 | Lookup value identity | **Text, not `_id`.** Consistent with §2; a list-value rename is a data migration — plus cross-language matching and an orphan report, so it is detectable. (§6.4) |
| 9 | Record editor mode | **`viewMode` input, default true.** View-first with per-tab section editing, matching `EntityRecordComponent`. Consumers set false for a directly editable record. (§4) |
| 10 | Lookup label rendering | **Synchronous label layer, mandatory.** Read-only is the primary path once `viewMode` defaults true; it never awaits. Same shape as §5's label cache. (§6.2) |
| 11 | Option resolution point | **One injected service, five inputs unchanged.** `LookupRegistryService` injected by the three choice components, following `EntityRefFieldComponent`; ADR-008's contract is not widened. (§6.3) |
| 12 | Phase 6 scope | **Split.** `listName` is phase 6; referenced fields become phase 8 behind a design gate — they need a config-source boundary the library does not have. (§8) |
| 13 | e2e test hooks | **`data-testid`, added in phase 7.** The Material rewrite must land under a green suite that does not assert on class names. (§7.3) |
| 14 | Release line | **§9 is 1.0.** Pre-1.0 breaks are free; the three packages release as one unit. (Versioning and release) |

## Still open

Three, all cheap, none blocking phase 7:

- **§8's design gate** — the `CONFIG_SOURCE` question, drift timing, and drifted-field
  rendering. Answer before phase 8 starts.
- **Publish or stay internal** — decides how much of the packaging checklist is urgent.
- **`changeDebounceMs` default** — currently 0 against the reference's 300 ms (§4). Deliberate,
  but worth revisiting once §9's Material inputs change the keystroke cost.
