# Pending Enhancements — dynamic-entity form packages

_Reviewed as senior architect against the current branch (`feat/form-builder-renderer-packages`). Build: `turbo run build` → **4/4 green**._

## Where we are

Three form-focused packages, unified on the **rich nested model** (`EntityFormConfig`); backend and data table removed.

| Package | State |
|---|---|
| `@dynamic-entity/core` | Rich model (`form-model.types`) + ported pure logic (`form-logic`) + rule **types**. Simple/flat model removed. |
| `ngx-dynamic-entity` (renderer) | `DynamicFormComponent` on `EntityFormConfig` with tab support + nested `group`/`array` (FormGroup/FormArray) + patch. **18** Material field components. |
| `ngx-dynamic-entity-builder` (builder) | `EntityBuilderComponent`/`BuilderStore` on the rich model; palette, inspector, tabs, RBAC, live-preview slot, `commonModules` input. **15** catalog types. |

---

## P0 — Correctness & coherence (do first; these are bugs/rot, not features)

1. **`showWhen` conditional visibility is not applied.** The model carries `showWhen`, `core` ships `evaluateFieldVisibility`, but `DynamicFormComponent.fieldsForActiveTab` ([dynamic-form.component.ts](packages/ngx-dynamic-entity/src/lib/form/dynamic-form.component.ts)) returns tab fields unfiltered. Conditional fields render unconditionally. → Filter visible fields by `evaluateFieldVisibility(field, formValue)`, re-evaluated on `valueChanges`.

2. **Core `form-logic` is unused → duplicated or dead.** The renderer imports none of `formatDisplayValue`/`resolveLabel`/`getTabData`/`setTabData`/`shouldMaskField`; instead each of the 18 field components re-implements label resolution, and masking lives in `rbac.service`. A published package shipping unused logic (or duplicating it) is a smell. → Either **wire `core/form-logic` into the renderer** (single source of truth) or delete the unused functions. Pick one.

3. **Builder catalog lags the renderer (15 vs 18 types).** Renderer has components for `image`, `file`, `monthYear`, `entity-ref`; the builder [field-catalog.ts](packages/ngx-dynamic-entity-builder/src/lib/field-catalog.ts) can't author them. → Add the 3–4 missing entries + inspector controls. **Root fix:** a single shared field-type catalog in `core` consumed by both, so this can't drift again.

4. **Core exports dead backend types.** [index.ts](packages/core/src/index.ts) still exports `adapter.interface` and `error-codes` (server-only — the server is deleted). Audit `versioning.types` / `constants` for live consumers. → Remove dead exports; curate the public surface before publish.

---

## P1 — Feature completeness (superpower form-side parity)

5. **Rules engine.** Types exist in `core`; nothing evaluates them. → `RulesEvaluationService` (visibility/validation/**info**, operators per type, `VALUE_CHANGED`, `filterRulesForTab`), builder `RuleFormComponent` + `FieldRulesListComponent`, renderer application (hide field/tab, errors/warnings, dismissible info banners).

6. **Record view/edit (`DynamicRecordFormComponent`).** The current renderer is the lean single-form. Missing the tabbed record editor: cross-tab rule application, inline array-row editing, header profile/toggle, `showOnMinimize` summary, `criticalField` lock + deferred `VALUE_CHANGED` banner (session-original baseline).

7. **Entity-reference service + cascades.** `entity-ref-field.component` exists but there is **no** `EntityReferenceService` (consumer loader-token backed) or `CascadeDataService`, and no builder `EntityReferenceConfigComponent`. Define the loader token contract: `(ctx: { parentValue?, filters?, lang }) => Observable<ReferenceOption[]>` where `ReferenceOption = { value; label; record? }` (the `record` feeds autoPatch).

8. **`autoPatch` / `patchOnTrue`.** Model carries them; no runtime. → Wire in the record form (patchOnTrue is field-local; autoPatch copies from a selected entity-ref's `record` into a target tab).

9. **`file`/`image` value contract.** Components exist but the value model and upload path are undefined. → Decide `FileRef = { url } | { file: File }` + optional consumer **upload-handler token** `(file) => Observable<{ url }>`; display via object URLs.

---

## P2 — Library-grade / DX (before npm publish)

10. **Tree-shakable field registry.** [field-registry.service.ts](packages/ngx-dynamic-entity/src/lib/services/field-registry.service.ts) is an eager `Map` — all 18 components + Material bundle regardless of use. → Registration-based tree-shaking (consumer registers the subset; built-ins opt-in). Not dynamic `import()`.

11. **Public API + docs + release.** Curate each `public-api.ts`; provider ergonomics (`provideDynamicEntity({...})`); per-package README + usage; semver; `npm pack --dry-run` for `core` + renderer + builder. Note `core` is a **3rd** published package (both libs depend on it).

12. **Test hygiene.** 3 pre-existing Karma/Jasmine specs remain excluded from Jest in [jest.config.js](packages/ngx-dynamic-entity/jest.config.js) (`dynamic-form`, `dynamic-field`, `entity-ref-field`) — now **stale** vs the migrated components. → Rewrite for the rich model (Jest) or delete. Add specs for the 18 field components (at least smoke). Confirm full `turbo test` green.

---

## Architectural debt / risks

- **Foundation-with-no-consumer:** `core/form-logic` (P0 #2) — wire or remove.
- **Two field-type sources of truth:** builder `field-catalog` vs renderer `field-registry` (P0 #3) — collapse into one shared catalog in `core`.
- **Duplicated masking:** demo `LocalStore` + renderer `rbac.service` + core `shouldMaskField` all implement masking. Consolidate on `core`.
- **Config versioning:** migration was intentionally dropped. Persisted `EntityFormConfig`s therefore have **no forward-compat path**. Acceptable for now, but stamp `version` and document the "no migration" contract so consumers aren't surprised on a breaking model change.
- **`any` at the record boundary:** `form-logic` tab/record helpers use `any`. Fine pragmatically; tighten to `Record<string, unknown>` where feasible.

## Suggested sequencing

**P0 (coherence)** → **P1 #5 rules + #7 entity-ref/cascade** (highest-value form features) → **P1 #6 record form** (depends on rules) → **P1 #8/#9** → **P2 (publish readiness)**. Spike the **rules engine** before committing its UI — it's the highest bug-density subsystem.
