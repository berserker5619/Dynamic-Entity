# Changelog

All notable changes to `@dynamic-entity/core`, `ngx-dynamic-entity` and
`ngx-dynamic-entity-builder`. The three packages share a version and are released together.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/berserker5619/Dynamic-Entity/releases/tag/v1.1.0
[1.0.0]: https://github.com/berserker5619/Dynamic-Entity/releases/tag/v1.0.0
