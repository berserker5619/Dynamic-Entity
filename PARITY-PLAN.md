# Parity Plan — Superpower_Web Dynamic Entity V2 → packages

_Target: the form-side feature set in `projects/Superpower_Web/docs/dynamic-entity-v2-architecture.md` (2127 lines, updated 2026-06-25), reproduced exactly in `@dynamic-entity/core` + `ngx-dynamic-entity` + `ngx-dynamic-entity-builder`._

_Baseline: `main` @ `4f426b5` — 538 unit tests, 32 e2e, all green._

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

**Deliver**: `DynamicChoice`-equivalent behaviour in dropdown/radio/multiSelect — `ControlValueAccessor`, `resolveLabel` display, per-option deterministic ids (`${fieldId}_${slug}`, already present on radio).

---

## 3. Tab model completeness

The builder's tab manager does add / label / move / remove only. Missing everything else in `TabConfig`.

**Deliver**
- **Nested tabs** (`children`, max 3 levels) — builder tree + renderer sub-tab navigation.
- **`moduleName` / `moduleInputs`** — a tab renders a consumer component instead of fields. `COMMON_MODULES_REGISTRY` already exists as a token and is unused; wire it, and render the module in the tab body.
- **`isPrimaryTab`** — flag, used by entity-ref label building (§5).
- **`visibility`, `maskData`, `systemDefault`** per tab in the inspector.
- **`systemDefault` protection** — edit/delete guarded (doc F12: IT roles for system fields/tabs). Ship as a `canEditSystemDefaults` predicate the consumer supplies; the library must not hardcode role names.

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

## 6. Field-level features with no runtime

Present in `core` types, read by nothing. Confirmed by grep.

| Feature | Work |
|---|---|
| `listName`, `lookupSource` | A `LOOKUP_REGISTRY` token: named list key → options. Plus the builder's **single-data-source enforcement** (`none` \| `manual` \| `lookup` \| `entity`) — selecting one clears the others (doc §4.4). |
| `isReferenced`, `referencedEntityKey`, `referencedFieldId`, `referencedSnapshot`, `hasDrift` | Live field references across configs + the referenced-field dialog and drift detection. |
| `systemDefault` | Edit/delete protection (§3). |
| `table.*` (`isName`, `isStatus`, `arrayVisible`, …) | Already in the model; consumer-facing metadata only — **no work**, we ship no table. |

---

## 7. Builder parity

- **Tree editor** (`ListNodeComponent`) — recursive tab/field tree with drag-drop, replacing the current flat palette+list.
- **Referenced-field dialog** and **connection-source config dialog**.
- **`applyEditorToField` semantics** — including the id-change path. Note ours now derives ids from labels and renders the id read-only, which is a **deliberate divergence** from the reference's free-text id. Flagging it: parity here would mean reverting that.
- Dirty tracking and unsaved-changes guard.

---

## 8. Explicitly out of scope

Not portable into a form library; these belong to the consumer app or the backend.

Backend/API (`/configuration/dynamic_entity_v2`, `/formRule`, `/preferences`, connections API) · MongoDB pipeline (`buildDynamicEntityPipeline`, `correctPath`, `buildDisplayExpression`, `$lookup` label building) · `entity-data-table`, table preferences, `buildFlatRows`, `ArrayReadTableComponent` · Connections virtual tab (needs the connections API) · `syncDynamicFormsToMenu`, `showInMenu`, `entityFilter` · Mongoose plugins, factory models, audit.

`FieldTableConfig` stays in the model as consumer-facing metadata.

---

## Sequence and effort

| # | Phase | Depends on | Breaking | Rough size |
|---|---|---|---|---|
| 1 | Record shape / `flatData` / `refererField` | — | **Yes** | L |
| 2 | Option value contract | — | **Yes** | M |
| 3 | Tab model completeness | 1 | No | M |
| 4 | Record editor parity | 1, 3 | No | L |
| 5 | Entity reference caching + preload | — | No | M |
| 6 | `listName`/`lookupSource`, referenced fields | 3 | No | M |
| 7 | Builder tree + dialogs | 3, 6 | No | L |

1 and 2 land together in one release — both are contract changes, and shipping them separately breaks consumers twice.

**Gate for every phase**: `turbo run build test lint` green, coverage thresholds held or raised, and e2e proving the feature in the browser. Same bar as the work already merged.

---

## Open decisions

1. **§0.2** — behavioural parity (this plan) or visual parity as well (adds PrimeNG, replaces the renderer)?
2. **§2** — adopt `LocalizedText`-as-value outright, or dual-mode behind a flag?
3. **§7** — keep label-derived read-only field ids, or revert to the reference's free-text ids?
4. **§3/§6** — role checks: consumer-supplied predicates (recommended) or hardcoded IT/SuperUser names as the reference does?
