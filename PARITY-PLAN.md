# Parity Plan — Superpower_Web Dynamic Entity V2 → packages

_Target: the form-side feature set in `projects/Superpower_Web/docs/dynamic-entity-v2-architecture.md` (2127 lines, updated 2026-06-25), reproduced exactly in `@dynamic-entity/core` + `ngx-dynamic-entity` + `ngx-dynamic-entity-builder`._

_Status: **Phases 1–5 shipped.** 673 unit tests + 2 demo Karma + 46 e2e; build, lint, coverage and e2e green. Phases 6, 7, 8 outstanding._

| Phase | State |
|---|---|
| 1 — Record shape, `flatData`, `refererField` | ✅ shipped (`a5f7a71`) |
| 2 — Option value contract | ✅ shipped (`a5f7a71`) — see deviation note in §2 |
| 3 — Tab model completeness | ✅ shipped (`fe36e86`) |
| 4 — Record editor parity | ✅ shipped |
| 5 — Entity reference caching + preload | ✅ shipped |
| 6 — Named lookup lists + referenced fields | ⬜ not started |
| 7 — Builder tree + dialogs | ⬜ not started |
| 8 — Material UI layer | ⬜ not started |

---

## 0. Read this before approving

Three things about "ditto perfect same" that need a decision, because they cannot all be true at once.

**0.1 — Two features are contract breaks, not additions.** Record shape (§1) and option values (§2) change the data these packages read and write. Every config and every stored record produced so far is affected. They are first because everything else stacks on them, and doing them later means doing them twice.

**0.2 — UI toolkit: Angular Material, not PrimeNG. _(decided)_** Behavioural parity is exact; the visual layer is rebuilt on Material rather than reproducing PrimeNG markup. The builder already uses Material; the renderer is currently dependency-free HTML and moves onto Material too (§8). Where a PrimeNG construct has no Material equivalent, the closest Material pattern wins — no PrimeNG dependency is added.

**0.3 — Do not port the open bugs.** The doc's own issue registry lists defects that are still open. Porting "exactly" would import them:

| Ref | Defect | Plan |
|---|---|---|
| #7 | Rename entity deletes old key then re-POSTs; same key → unique violation | Not applicable — no backend here |
| #8 | `confirmAddModuleTab` predicts the tab id via `labelToId` but `addTab` generates its own → updates the wrong tab | Avoid: our `addTab()` already returns the real id (§3) |
| #16 | `clearCache()` drops all entity options, no granular invalidation | Fix in §5 — per-key invalidation |
| #18 | `getTabData()` may not resolve 3-level nesting consistently | Fix in §1 — explicit path resolution + tests |
| #22 | `labelCache` per service instance, lost on refresh | Fix in §5 — pluggable cache store |

These are listed as deviations so the difference is deliberate and reviewable.

---

## 1. Record shape — per-tab form groups, `flatData`, `refererField`

**The single biggest gap. Nothing else is worth doing first.**

Today [dynamic-form.component.ts](packages/ngx-dynamic-entity/src/lib/form/dynamic-form.component.ts) walks every tab and puts every field in **one flat `FormGroup`** keyed by `field.id`. The reference builds **one `FormGroup` per tab** and stores records at `doc.tabId.fieldId`, or at `doc.fieldId` when the tab sets `flatData`.

Consequence today: a nested record (`{ personal: { firstName } }`) silently fails to load — `form.get('personal')` finds no control, so the tab's values are dropped. `core` already ships `getTabData` / `setTabData` / `normalizeArrayStructures` honouring `flatData`, and **nothing calls them**.

**Deliver**
- `DynamicFormComponent` builds `tabGroups: { tab, form }[]`, one `FormGroup` per visible tab, recursing into `tab.children`.
- Read via `getTabData(tab.id, record, config)`; write via `setTabData` + `normalizeArrayStructures`.
- `refererField` honoured as the dot-path override for binding (`"tabId.fieldId"`), per `patchFormGroup` in §4.5 of the doc.
- Value emission and `submit()` assemble the full nested record, not a flat bag.
- `getControl()` becomes tab-aware; cross-tab rule evaluation reads a flattened *view* of values, keeping rule semantics unchanged.

**Breaking**: `initialData` / `formSubmit` change shape from flat to nested. The demo's `EMPLOYEES_RECORDS` already assume nested — they are currently broken and will start working.

**Tests**: `flatData` true/false, parent-true/child-false and the inverse (the doc's four-row table), 3-level nesting (defect #18), `refererField` override, array normalisation, round-trip load→edit→save.

---

## 2. Option value contract

Reference (§4.6, and the backend `options: [Mixed]`): **the stored value IS the `LocalizedText` object** — `form.value.status === { en: 'Active', de: 'Aktiv' }`. There is no `value`/`label` wrapper.

Ours: `DropdownOption { value: any; label: LocalizedText }` with a scalar value.

**Decided: adopt the reference shape outright.** No dual-mode flag. `FieldOption` becomes `LocalizedText`; dropdown / radio / multiSelect controls emit and accept the object. `core.normalizeField` already tolerates both on read, which covers loading older configs; writing switches to the reference shape.

Consequences to accept: every stored record's dropdown/radio/multiSelect value changes shape, `DropdownOption { value, label }` leaves the public API, and comparison operators (`EQUAL`, `IN`, `showWhen`) must compare resolved labels rather than scalars. That last point is the sharp edge — rule and `showWhen` evaluation gets an option-aware comparison path, with tests pinning it.

**✅ Shipped, then tightened to one shape.** The first cut left `DropdownOption` as a permissive four-way union, which made the public type unnarrowable and let a single field mix shapes. **Decided: language-keyed object only.**

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

**Deliver**: `DynamicChoice`-equivalent behaviour in dropdown/radio/multiSelect — `ControlValueAccessor`, `resolveLabel` display, per-option deterministic ids (`${fieldId}_${slug}`, already present on radio).

---

## 3. Tab model completeness

The builder's tab manager does add / label / move / remove only. Missing everything else in `TabConfig`.

**Deliver**
- **Nested tabs** (`children`, max 3 levels) — builder tree + renderer sub-tab navigation.
- **`moduleName` / `moduleInputs`** — a tab renders a consumer component instead of fields. `COMMON_MODULES_REGISTRY` already exists as a token and is unused; wire it, and render the module in the tab body.
- **`isPrimaryTab`** — flag, used by entity-ref label building (§5).
- **`visibility`, `maskData`, `systemDefault`** per tab in the inspector.
- **`systemDefault` protection** — edit/delete guarded (doc F12: IT roles for system fields/tabs). **Decided: consumer-supplied predicates.** A `SYSTEM_DEFAULT_GUARD` token providing `{ canEditSystemDefaults(ctx), canAddToSystemTab(ctx) }`; the library never hardcodes `IT` / `SuperUser`. Absent a provider, system defaults are locked — fail closed, not open.

---

## 4. Record editor parity (`EntityRecordComponent`)

Our `DynamicRecordFormComponent` has the header, `showOnMinimize` summary, and baseline tracking. The reference has considerably more.

**Deliver**
- **Per-tab section editing** — `editingTabId`, edit/save/cancel per section, validation scoped to the active tab (`filterRulesForTab`, already in `core`).
- **Inline array-row editing** — a drawer hosting `inlineRowForm`, built from `field.children`; add/edit/delete rows; re-evaluate visibility rules after save. The doc keeps this **outside** the tab container deliberately, to dodge `FormArray` init timing — replicate that structure.
- **`isProfileImage`** header avatar (replacing our initial-letter placeholder) and **`isHeaderToggle`** status switch.
- **Dismissible info banners** — `fieldInfoBanners` keyed by field id, dismissed until re-triggered. Ours render but cannot be dismissed.
- **Debounced `valueChange`** (300 ms), matching `DynamicFormsV2Component`.
- **`readOnlyFields[]`** and **`isReadOnly`** inputs.
- **Preview mode** — auto-push one empty row per array field, then `form.disable()`, so the builder preview shows structure.

Deliberately excluded: `stageActions` / `canMoveToNextStage` (PrimeNG `MenuItem[]`, app-domain workflow). Expose a generic action-slot instead.

---

## 5. Entity reference parity

We have loaders + cascade filtering. The reference adds caching and label resolution.

**Deliver**
- **Three-layer cache** in a new `EntityReferenceService`: options (keyed `entity_lang_sortedDisplayFields_filters` — note the doc sorts `displayFields` so field order does not fork the cache), config, and a synchronous label cache.
- **Granular invalidation** (`invalidate(entityKey)`), fixing defect #16, and a pluggable store so it can outlive a refresh (defect #22).
- **`CascadeDataService` preload API** — `initializeCascadeData()`, `getCachedChildOptions()`, `waitForData()`, `clearCache()`. Ours loads per field on demand; the reference preloads parents on form init so cascades respond with no round-trip.
- **Special entity keys** — `system:company`, `system:kanban`, `system:location`, `system:productservice` resolve through consumer-registered loaders, not built-in behaviour.
- **Label building from the primary tab's `displayFields`** (`buildLinkedLabelExpr` equivalent, client-side).

---

## 6. Named lookup lists + referenced fields

Present in `core` types, read by nothing. Confirmed by grep.

| Feature | Work |
|---|---|
| `listName` | **Required — decision reverted.** A named, centrally-managed option list resolved through a new `LOOKUP_REGISTRY`. See §6.1. |
| `lookupSource` | **Dropped _(decided)_.** Dead in Superpower_Web *and* in Superpower-App: stored, Joi-validated and copied on sync, but read by no service, pipeline or component. Removed from `NestedFieldConfig`; configs carrying it still round-trip, since `normalizeField` spreads unknown keys. |
| `isReferenced`, `referencedEntityKey`, `referencedFieldId`, `referencedSnapshot`, `hasDrift` | Live field references across configs + the referenced-field dialog and drift detection. |
| `systemDefault` | Edit/delete protection (§3). |
| `table.*` (`isName`, `isStatus`, `arrayVisible`, …) | Already in the model; consumer-facing metadata only — **no work**, we ship no table. |

### 6.1 `listName` — named lookup lists

The reference has a real feature behind this: `list.service.ts` fetches master lists by name
(`getListByNames`), and `mapDropdown(listName, allLists, lang)` turns one into options. A
master list is `{ listName, listValues: [{ code, name: { en, de }, sortOrder, _id }] }`.

Note what its mapper does: it displays `name[lang]` but stores `name['en']` as the value. Our
canonical option is the whole `LocalizedText`, which carries every language — strictly better,
and it means a list value maps to an option directly with no lossy projection.

**Deliver**
- `core`: `LookupListValue` type and `normalizeLookupValues()` — sorts by `sortOrder`, maps
  `name` to a `DropdownOption`, tolerates bare strings and `LocalizedText`.
- `renderer`: `LOOKUP_REGISTRY` token (list name → values, as array/Promise/Observable) and a
  `LookupRegistryService` that caches per list name and de-duplicates in-flight loads — the
  same shape as `EntityReferenceService`, since one list is typically used by many fields.
- Field options resolve in one place, not in three components: inline `options` win, else
  `listName` resolves through the registry. `dropdown`, `radio` and `multiSelect` read from
  that resolver.
- `builder`: data source becomes `none` | `manual` | `lookup` | `entity`, with the reference's
  mutual exclusion — picking one clears the others (doc §4.4). Inspector gets a list-name input.

### 6.2 Value identity — text, not `_id` _(decided)_

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

The backend's `listValues` also carry `isSystemDefined` and `from`, which the reference's
`mapDropdown` drops. Expose them on the value type so a consumer can act on them (e.g. block
deleting a system-defined value); the library itself will not.

---

## 7. Builder parity

- **Tree editor** (`ListNodeComponent`) — recursive tab/field tree with drag-drop, replacing the current flat palette+list.
- **Referenced-field dialog** and **connection-source config dialog**.
- **`applyEditorToField` semantics**, minus the id-change path. **Decided: keep the current id behaviour, do not revert to the reference's free-text ids.** New fields derive their id from the label; a config loaded from storage keeps every id it arrived with, because records are already stored under them. That is exactly the "new fields follow label→id, existing data untouched" rule, and it is already implemented and tested — no work in this phase.
- Dirty tracking and unsaved-changes guard.

---

## 8. UI layer — Angular Material

_Decision 0.2. Behavioural parity is exact; visual parity is "Material equivalent", not pixel-matched to PrimeNG._

The builder is already Material. The renderer's 18 field components are hand-rolled HTML with `ngx-field__*` classes and no Material dependency.

**Deliver**
- Rebuild the field components on Material: `mat-form-field` + `matInput` (text, textarea, number, currency, email, password), `mat-select` (dropdown, multiSelect, entity-ref), `mat-radio-group`, `mat-checkbox` / `mat-slide-toggle` (checkbox, boolean), `mat-datepicker` (date, datetime, monthYear), and Material surfaces for group/array/image/file.
- Tabs move to `mat-tab-group`; info/warning/error banners to a Material surface; the criticalField lock to `mat-icon-button`.
- Keep every current behaviour: the 5-input contract (ADR-008), masking, readonly rendering, contextual error messages, the lock, cascade hints.

**Contract change** — `@angular/material` and `@angular/cdk` are currently **optional** peer dependencies of `ngx-dynamic-entity`. They become **required**. That is a real cost for a consumer who wanted a dependency-free renderer; flagging it rather than burying it.

**Risk** — this rewrites the components the existing e2e specs assert against (`.ngx-field__input`, `option` elements, etc.). Budget for reworking those selectors. Do this **after** phases 4–7, so behaviour is settled before the markup churns; doing it earlier means paying the e2e rework twice.

---

## 9. Explicitly out of scope

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
| 6 | Named lookup lists + referenced fields | 3 | No | M | ⬜ |
| 7 | Builder tree + dialogs | 3, 6 | No | L | ⬜ |
| 8 | Material UI layer | 4–7 | **Yes** (peer deps) | L | ⬜ |

1 and 2 landed together, as planned — both were contract changes, and shipping them separately would have broken consumers twice. **8 goes last on purpose**: it churns the markup every e2e spec asserts against, so behaviour should be settled first.

**Next**: 4 (record editor parity). 5 is done, so its cache is already in place for it.

**Gate for every phase**: `turbo run build test lint` green, coverage thresholds held or raised, and e2e proving the feature in the browser. Same bar as the work already merged.

---

## Decisions — all resolved

| # | Question | Decision |
|---|---|---|
| 1 | Visual parity? | **Both** — behavioural parity exact, visual rebuilt on **Angular Material**, not pixel-matched to PrimeNG. No PrimeNG dependency. (§8) |
| 2 | Option values | **Follow Superpower_Web** — `LocalizedText` is the stored value. Shipped as a permissive union so old configs still load (§2). |
| 3 | Field ids | **New fields derive from the label; existing data keeps its ids.** Already implemented — no revert to free-text ids. (§7) |
| 4 | Role checks | **Consumer-supplied predicates** via token; no hardcoded role names, fail closed when absent. (§3) |

| 5 | Option shape | **Language-keyed object only.** Narrowed; legacy shapes upcast at the parse boundary. (§2) |
| 6 | Material peer deps | **Accepted** — `@angular/material` + `@angular/cdk` move from optional to required on `ngx-dynamic-entity` in §8. |
| 7 | Lookup lists | **`listName` in, `lookupSource` out.** The latter is dead in both the web app and the API. (§6.1) |
| 8 | Lookup value identity | **Text, not `_id`.** Consistent with §2; a list-value rename is a data migration. (§6.2) |
| 9 | Record editor mode | **`viewMode` input, default true.** View-first with per-tab section editing, matching `EntityRecordComponent`. Consumers set false for a directly editable record. (§4) |

## Still open

Nothing blocking. Next up is phase 6 (named lookup lists + referenced fields).
