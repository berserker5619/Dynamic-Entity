# Pending Enhancements — dynamic-entity form packages

_Audited and cleared on 2026-08-09 against `main`. Packages at **0.1.0**._

**Status: the P1/P2 backlog in the previous revision is done.** Verification on this tree:

| Gate | Result |
|---|---|
| `turbo run build` | **4/4 green** |
| `turbo run test` | **7/7 tasks** — 75 core + 116 renderer + 59 builder Jest specs, 2 demo Karma |
| `turbo run lint` | **4/4 green** — now type-checks specs too (see below) |
| Playwright e2e | **26/26 green** |
| `npm pack --dry-run` | clean for all three packages at 0.1.0 |

## Where we are

| Package | State |
|---|---|
| `@dynamic-entity/core` | Model, `form-logic`, `rules-engine`, shared `field-catalog` (19 keys), entity-reference contracts + pure cascade filtering, canonical `FileRef`. No framework, no rxjs. |
| `ngx-dynamic-entity` | `DynamicFormComponent` (tabs, `showWhen`, rules, autoPatch/patchOnTrue, criticalField lock) + `DynamicRecordFormComponent`. `CascadeDataService`, `FileUploadService`, tree-shakable field registry. |
| `ngx-dynamic-entity-builder` | Palette, inspector, tab manager, `RuleFormComponent` + `FieldRulesListComponent`, `EntityReferenceConfigComponent`. Catalog re-exported from core. |
| `demo-angular` | 13 seeded entities, 26 Playwright specs. |

---

## What was closed

**P1 — feature completeness**

1. **`autoPatch` / `patchOnTrue` now have runtime.** Entity-ref fields publish the selected
   record on `EntityRefSelectionService` (scoped per form instance); the form applies
   `applyAutoPatch` to the configured target tab. `patchOnTrue` fires on the false→true
   transition only, so a later manual edit is not clobbered.
2. **Cascades are real.** `CascadeDataService` resolves the loader, coerces array/Promise/
   Observable, and applies `lookupFilter` / `lookupPath`. A cascade child watches its parent
   through `control.parent`, reloads on change, drops a stale selection, and offers nothing
   until the parent has a value. Builder authoring via `EntityReferenceConfigComponent`.
3. **`criticalField` does something.** Renders read-only behind a lock toggle; once unlocked
   and changed it raises a deferred notice against the session baseline — the same baseline
   that feeds `VALUE_CHANGED` rules.
4. **`FieldRulesListComponent`** — per-field rule list with reorder (priorities renumbered
   contiguously), enable/disable, edit, delete. Rules live in `BuilderStore` beside the config.

**P2 — publish readiness**

5. **The registry is actually tree-shakable now.** `FieldRegistryService` imports no
   components; built-ins are opt-in via `provideBuiltInFieldTypes()` or a narrower
   `provideFieldTypes({...})`, composed through the multi-provider `FIELD_TYPE_SETS`.
   Verified in the build output: `dist/esm2022/.../field-registry.service.mjs` imports only
   `@angular/core` and the token module. An unregistered type warns once in dev builds.
   **Breaking:** apps must now register field types explicitly.
6. **Release mechanics.** All three at `0.1.0`; peer pins moved to `^0.1.0`; removed a
   dangling `peerDependenciesMeta` entry in the builder for a package that was never a peer
   dependency. `npm pack --dry-run` verified for all three.
7. **Test hygiene.** The 3 excluded specs are rewritten for the rich model and running; all
   18 field components now have specs; new coverage for cascade, autoPatch, patchOnTrue,
   criticalField, the registry contract, and the core entity-reference/file helpers.
   Renderer Jest went 43 → 116 tests.

## Bugs found and fixed along the way

These were latent, not on the previous list:

- **`defaultValue` was never applied** — controls were always built with `null`.
- **Array rows were built as bare controls**, so an `array` field with `children` could not
  hold row values (`contacts[0].get('phone')` was undefined).
- **`valueChanges` subscriptions stacked** on every config/data change; the form now
  unsubscribes on rebuild and destroy.
- **Tab-level masking never applied** — `DynamicFieldComponent` was never given
  `currentTabId`, so `maskData` on a tab was ignored.
- **Two competing `FileRef` types** (core vs. a local one in `image-field`) and an
  `UPLOAD_HANDLER` typed Observable-only against a Promise-typed core handler. Consolidated
  on core; handlers may now return a value, Promise, or Observable.
- **Image preview minted a new signal per change-detection pass** and never previewed
  unpersisted files. Now cached per `File` with object URLs revoked on replace/destroy.
- **`lint` type-checked specs against jasmine globals**, which is why jest-only matchers
  slipped through. `tsc --noEmit` now runs twice — library, then `tsconfig.spec.json`.
- **`DynamicRecordFormComponent` injected `RulesEvaluationService` and never used it**, and
  seeded its baseline from the first keystroke rather than the loaded record.

---

## Remaining debt (accepted, not blocking)

- **Config versioning has no migration path.** Unchanged and deliberate. Now documented as a
  contract in the core README so consumers are not surprised by a breaking model change.
- **`any` at the record boundary.** `form-logic`'s tab/record helpers and several registry
  tokens still use `any`. Pragmatic; tighten to `Record<string, unknown>` opportunistically.
- **`DynamicRecordFormComponent.jumpToField` uses `setTimeout` + `getElementById`.** Works,
  but it reaches around Angular; a `ViewChild`/`afterNextRender` approach would be cleaner.
- **Rules are stored outside `EntityFormConfig`.** Deliberate (they are persisted per form),
  but it means two things to load and export — easy for a consumer to wire up half of.
- **No visual regression or a11y test layer.** E2E asserts behaviour and some ARIA
  attributes; nothing guards styling or full a11y conformance.

## If you publish

1. Decide whether `0.1.0` or `1.0.0` matches your stability promise — the field-registry
   change is breaking for any existing consumer.
2. `core` publishes first; the two Angular packages peer-depend on `^0.1.0`.
3. Publish from `packages/*/dist` for the Angular packages, from `packages/core` for core.
