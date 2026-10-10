# DE 2.4 — problem code inventory

**Baseline:** `d63b183` (2.3.1) · **Source:** Decisions 3 and 4, and the "Problem codes" table in
Reading rules, of [`Sheet Importer — Phase 1 Spec Plan v2 & Schema Adapter Contracts.md`](Sheet%20Importer%20—%20Phase%201%20Spec%20Plan%20v2%20&%20Schema%20Adapter%20Contracts.md)

Every place DE creates a `ConfigProblem`, with the code each gets in 2.4. Codes are stable
identifiers; messages are not, and are unchanged by 2.4. Line numbers are at `d63b183`.

## Where problems come from

`ConfigProblem` is built in exactly two places, each through a local `add(level, path, message)`:

| Producer | File | Emits |
|---|---|---|
| `validateConfig` and its inner helpers (`checkValidators`, `checkDefaultValue`, `checkOptions`, `visitField`, `visitTab`, `flagRef`, `flagUnsafe`, the `refererField` pass, the rules pass) | `core/src/validate-config.ts:139` | `CONFIG_*` |
| `validateMappingPlan` | `core/src/import-columns.ts:494` | `PLAN_*` |

The things that return or carry `ConfigProblem[]` without creating any: `isConfigValid`,
`formatConfigProblems`, the CLI (`core/src/cli.ts`), `ImportResult.planProblems`,
`ImportCommitResponse.planProblems`, the server's `checkPlan` (`server/src/run-import.ts:130`, a
call to `validateMappingPlan`), the router (`server/src/express.ts:278`), and
`HttpImportTransport` (`ngx-dynamic-entity/.../http-import-transport.ts:223`).

`upgradeLegacyRefs` (`import-columns.ts:463`) creates **no** problem; it only rewrites refs. The
legacy-ref warning is emitted by `validateMappingPlan` (P7 below).

**Not `ConfigProblem`, so out of scope:**
- `BuilderProblem` (`ngx-dynamic-entity-builder/.../builder-store.service.ts:29`), which is
  `{ level, message, fieldId? }` with no `path`.
- `RecordProblem` (`core/src/import-engine.ts:846`), which is row-level and belongs to Phase 1.
- `validateMigrations`, which returns strings.
- The server's `ImportError` codes (`INVALID_PLAN` in `multipart.ts:172`, `:179`).

## How checks become codes

- **One code per check.** A check is a predicate with one consequence. If several call sites emit the same check, they share one code.
- **Examples of one shared code:**
  - the four `defaultValue` type branches;
  - `conditions` and `targets` not being arrays;
  - every reference site that `flagRef` covers.
- **Split by kind of element:** checks on a field, a tab, an option and a rule get separate codes, even when the predicates look alike (for example `CONFIG_FIELD_ID_REQUIRED` and `CONFIG_TAB_ID_REQUIRED`).
- **The `path` grammar is not part of the contract.** A UI must not parse it to tell two checks apart.
- **`flagRef` (`:550`)** is one call site that emits three outcomes of `referenceProblem` (`:528`). A bracketed path that names nothing and a bare id that names nothing are the same check: *the reference resolves to no field*. Both get `CONFIG_UNKNOWN_FIELD_REF`. An ambiguous bare id is a different check with a different fix (use the path form), so it gets `CONFIG_AMBIGUOUS_FIELD_REF`.
  - The task's example name was `CONFIG_AMBIGUOUS_RULE_REF`. But the check also covers `showWhen`, cascade parents and `patchOnTrue`, so a `RULE` name would be wrong for three of its seven sites.

## `validateConfig` — `CONFIG_*`

All in `core/src/validate-config.ts`. `‹p›` is the field path (`tabs[0].fields[1]`, `….children[0]`), `‹t›` the tab path, `‹r›` = `rules[i]`.

### The config itself

| Line | Level | Path | Message | Code |
|---|---|---|---|---|
| 143 | error | `''` | Config is missing or not an object. | `CONFIG_NOT_AN_OBJECT` |
| 148 | error | `entity` | An entity name is required. | `CONFIG_ENTITY_REQUIRED` |
| 152 | error | `version` | version must be a positive number when present. | `CONFIG_INVALID_VERSION` |
| 508 | error | `tabs` | At least one tab is required. | `CONFIG_NO_TABS` |

### Fields (`visitField`, `:348`)

| Line | Level | Path | Message | Code |
|---|---|---|---|---|
| 350 | error | `‹p›` | Field is missing or not an object. | `CONFIG_FIELD_NOT_OBJECT` |
| 355 | error | `‹p›.id` | A field id is required. | `CONFIG_FIELD_ID_REQUIRED` |
| 362 | error | `‹p›.id` | "‹id›" is a reserved object key. A field with this id can never store a value… | `CONFIG_RESERVED_FIELD_ID` |
| 369 | warning | `‹p›.id` | "‹id›" is not a plain identifier; it is used as an object key in saved records. | `CONFIG_FIELD_ID_NOT_IDENTIFIER` |
| 378 | error | `‹p›.id` | Duplicate field id "‹id›" (also at ‹path›). Two fields in ‹scope› would share one control and one record key. | `CONFIG_DUPLICATE_FIELD_ID` |
| 389 | error | `‹p›.type` | A field type is required. | `CONFIG_FIELD_TYPE_REQUIRED` |
| 391 | error | `‹p›.type` | Unknown field type "‹type›". It will not render. Known types: … | `CONFIG_UNKNOWN_FIELD_TYPE` |
| 399 | warning | `‹p›.label` | No label; the field will render without one. | `CONFIG_FIELD_NO_LABEL` |
| 404 | warning | `‹p›.children` | A "‹type›" field with no children renders nothing. | `CONFIG_CONTAINER_NO_CHILDREN` |
| 407 | warning | `‹p›.children` | Children on a "‹type›" field are ignored. | `CONFIG_CHILDREN_IGNORED` |
| 411 | warning | `‹p›.listName` | Both inline options and listName are set; inline options win and listName is dropped. | `CONFIG_OPTIONS_AND_LIST_NAME` |
| 419 | error | `‹p›.step` | step must be a number greater than 0. The slider falls back to 1. | `CONFIG_INVALID_STEP` |
| 425 | error | `‹p›.validators` | A slider's max (‹max›) must be greater than its min (‹min›)… | `CONFIG_SLIDER_RANGE_EMPTY` |
| 433 | error | `‹p›.colSpan` | colSpan must be between 1 and 12. | `CONFIG_INVALID_COL_SPAN` |
| 440 | error | `‹p›.required` | \`required\` is not a field property, so this field is not required. Move it to \`validators.required\`. | `CONFIG_FIELD_LEVEL_REQUIRED` |
| 457 | error | `‹p›.children` | children must be an array; it will be ignored. | `CONFIG_CHILDREN_NOT_ARRAY` |

### Validators (`checkValidators`, `:190`)

| Line | Level | Path | Message | Code |
|---|---|---|---|---|
| 196 | error | `‹p›.validators.pattern` | pattern must be a non-empty string. | `CONFIG_PATTERN_NOT_STRING` |
| 202 | error | `‹p›.validators.pattern` | "‹pattern›" is not a valid regular expression (‹reason›)… | `CONFIG_INVALID_PATTERN` |
| 213 | error | `‹p›.validators` | min (‹min›) is greater than max (‹max›); no value can satisfy both. | `CONFIG_MIN_EXCEEDS_MAX` |
| 220 | error | `‹p›.validators` | minLength (‹n›) is greater than maxLength (‹m›); no value can satisfy both. | `CONFIG_MIN_LENGTH_EXCEEDS_MAX_LENGTH` |
| 236 | error | `‹p›.validators.custom` / `.customAsync` | ‹key› must be an array of validator names. | `CONFIG_VALIDATOR_LIST_NOT_ARRAY` |
| 241 | error | `‹p›.validators.‹key›[i]` | A validator name must be a non-empty string. | `CONFIG_VALIDATOR_NAME_INVALID` |
| 250 | error | `‹p›.validators.‹key›[i]` | No validator named "‹name›" is registered, so it is dropped and never runs.‹…› | `CONFIG_UNKNOWN_VALIDATOR` |

The slider check (425) and `min > max` (213) are distinct. A slider with `min === max` gets only
425, and a slider with `min > max` gets both.

236–250 run only when `knownValidators` is passed.

### Default values (`checkDefaultValue`, `:260`)

| Line | Level | Path | Message | Code |
|---|---|---|---|---|
| 265 | error | `‹p›.defaultValue` | A "‹type›" field's default must be a number; this is a ‹typeof›. | `CONFIG_DEFAULT_TYPE_MISMATCH` |
| 272 | error | `‹p›.defaultValue` | A "‹type›" field's default must be a boolean; this is a ‹typeof›. | `CONFIG_DEFAULT_TYPE_MISMATCH` |
| 279 | error | `‹p›.defaultValue` | A "color" field's default must be a lowercase #rrggbb colour. | `CONFIG_DEFAULT_TYPE_MISMATCH` |
| 282 | error | `‹p›.defaultValue` | A "tags" field's default must be an array of strings. | `CONFIG_DEFAULT_TYPE_MISMATCH` |

### Options (`checkOptions`, `:294`)

| Line | Level | Path | Message | Code |
|---|---|---|---|---|
| 303 | error | `‹p›.options[i]` | An option must be a language-keyed object. | `CONFIG_OPTION_NOT_OBJECT` |
| 309 | error | `‹p›.options[i].‹$key›` | "‹key›" is reserved. "$" cannot begin a language subtag… | `CONFIG_OPTION_RESERVED_KEY` |
| 321 | error | `‹p›.options[i].$key` | $key must be a non-empty string. | `CONFIG_OPTION_KEY_INVALID` |
| 325 | error | `‹p›.options[i].$key` | Duplicate option key "‹key›" (also at index ‹n›). | `CONFIG_DUPLICATE_OPTION_KEY` |
| 336 | warning | `‹p›.options[i]` | Two options both read "‹label›" in "‹lang›" (also at index ‹n›)… | `CONFIG_DUPLICATE_OPTION_LABEL` |

### Tabs (`visitTab`, `:462`)

| Line | Level | Path | Message | Code |
|---|---|---|---|---|
| 464 | error | `‹t›` | Tab is missing or not an object. | `CONFIG_TAB_NOT_OBJECT` |
| 469 | error | `‹t›.id` | A tab id is required. | `CONFIG_TAB_ID_REQUIRED` |
| 474 | error | `‹t›.id` | "‹id›" is a reserved object key. No field on this tab could store a value. | `CONFIG_RESERVED_TAB_ID` |
| 482 | error | `‹t›.id` | Duplicate tab id "‹id›" (also at ‹path›). | `CONFIG_DUPLICATE_TAB_ID` |
| 489 | warning | `‹t›` | Tab has no fields, no sub-tabs and no module; it renders empty. | `CONFIG_EMPTY_TAB` |
| 500 | error | `‹t›.fields` / `‹t›.children` | ‹key› must be an array; it will be ignored. | `CONFIG_TAB_LIST_NOT_ARRAY` |

### References (`flagRef` `:550`, `flagUnsafe` `:565`, the `refererField` pass `:618`)

`flagRef` message = `‹problem› ‹suffix›`. The problem text comes from `referenceProblem`; the suffix comes from the call site.

| Line | Level | Path | Message | Code |
|---|---|---|---|---|
| 553 (← 533) | error | any `flagRef` site | No field at path "‹ref›". ‹suffix› | `CONFIG_UNKNOWN_FIELD_REF` |
| 553 (← 535) | error | any `flagRef` site | References unknown field "‹id›". ‹suffix› | `CONFIG_UNKNOWN_FIELD_REF` |
| 553 (← 538) | error | any `flagRef` site | Ambiguous reference to "‹id›": defined in ‹scopes›. Name it by path instead, as [‹scope›.‹id›]. ‹suffix› | `CONFIG_AMBIGUOUS_FIELD_REF` |
| 567 | error | `‹p›.patchOnTrue[i].to`, `‹p›.autoPatch.mappings[i].target`, `‹p›.refererField` | "‹key›" names a reserved object key, so it is skipped rather than written. Rename the field it points at. | `CONFIG_UNSAFE_PATH` |
| 627 | error | `‹p›.refererField` | refererField is not allowed on a field inside an array: "‹ref›" cannot say which row it means. | `CONFIG_REFERER_INSIDE_ARRAY` |
| 635 | warning | `‹p›.refererField` | refererField on a ‹type› that is not directly on a tab is ignored… | `CONFIG_REFERER_OVERRIDE_IGNORED` |

These are the `flagRef` sites and their suffixes:

| Site | Path | Suffix |
|---|---|---|
| `:583` | `‹p›.showWhen` | This field will never show. |
| `:585` | `‹p›.entityReference.parentField` | The cascade will never load. |
| `:592` | `‹p›.patchOnTrue[i].from` | Nothing will be copied from. |
| `:593` | `‹p›.patchOnTrue[i].to` | Nothing will be copied to. |
| `:689` | `‹r›.fieldId` | The rule will never trigger. |
| `:720` | `‹r›.conditions[j].compareToField` | The comparison will never match. |
| `:748` | `‹r›.targets[j].id` | The action will never apply. |

### Rules (`options.rules`, `:643`; only when `rules` is passed)

| Line | Level | Path | Message | Code |
|---|---|---|---|---|
| 645 | error | `‹r›` | Rule is missing or not an object. | `CONFIG_RULE_NOT_OBJECT` |
| 659 | error | `‹r›.conditions` | conditions must be an array; the rule is skipped at runtime. | `CONFIG_RULE_LIST_NOT_ARRAY` |
| 662 | error | `‹r›.targets` | targets must be an array; the rule is skipped at runtime. | `CONFIG_RULE_LIST_NOT_ARRAY` |
| 665 | error | `‹r›.action` | An action object is required; the rule is skipped at runtime. | `CONFIG_RULE_ACTION_REQUIRED` |
| 676 | error | `‹r›.action.type` | Unknown action type "‹type›"; the rule changes nothing when it fires. Expected one of: … | `CONFIG_UNKNOWN_RULE_ACTION` |
| 686 | warning | `‹r›.targets` | This rule has no targets; it changes nothing when it fires. | `CONFIG_RULE_NO_TARGETS` |
| 693 | error | `‹r›.conditions[j]` | Condition is missing or not an object; the rule can never fire. | `CONFIG_CONDITION_NOT_OBJECT` |
| 700 | error | `‹r›.conditions[j].operator` | Unknown operator "‹op›"; the condition can never hold.‹ Did you mean "…"?› | `CONFIG_UNKNOWN_RULE_OPERATOR` |
| 713 | error | `‹r›.conditions[j].compareToField` | compareType "field" needs a compareToField; without one the condition compares against \`value\` instead. | `CONFIG_COMPARE_FIELD_REQUIRED` |
| 726 | error | `‹r›.targets[j].id` | References unknown tab "‹id›". | `CONFIG_UNKNOWN_TAB_REF` |
| 731 | warning | `‹r›.targets[j]` | A "‹type›" action on a tab has no effect — only "visibility" applies to a tab. Target the fields instead. | `CONFIG_TAB_ACTION_IGNORED` |
| 741 | error | `‹r›.targets[j].type` | Unknown target type "‹type›"; expected "field" or "tab". The action will never apply. | `CONFIG_UNKNOWN_TARGET_TYPE` |

**55 `CONFIG_*` codes, from 58 `add` call sites (plus the 7 `flagRef` and 3 `flagUnsafe` call sites that reach two of them).**

## `validateMappingPlan` — `PLAN_*`

All in `core/src/import-columns.ts`. Only names from the spec's table are used: the six the task permitted (`PLAN_UNKNOWN_REF`, `PLAN_DUPLICATE_REF`, `PLAN_SOURCE`, `PLAN_TARGET_MISMATCH`, `PLAN_LEGACY_REF`, `PLAN_UNSAFE_PATH`) and, by decision below, `PLAN_SHAPE`.

| # | Line | Level | Path | Message | Code |
|---|---|---|---|---|---|
| P1 | 499 | error | `''` | Mapping plan is missing or not an object. | `PLAN_SHAPE` |
| P2 | 503 | error | `entries` | entries must be an array. | `PLAN_SHAPE` |
| P3 | 508 | warning | `entity` | Plan targets "‹plan›" but the config is "‹config›". | `PLAN_TARGET_MISMATCH` |
| P4 | 515 | warning | `configVersion` | Plan was authored against config version ‹n›; the config is now ‹m›. | `PLAN_TARGET_MISMATCH` |
| P5 | 535 | error | `entries[i]` | Entry is not an object. | `PLAN_SHAPE` |
| P6 | 539 | error | `entries[i].ref` | An entry needs a target field ref. | `PLAN_SHAPE` |
| P7 | 545 | warning | `entries[i].ref` | "‹old›" is the 2.2 address of "‹new›"; it is read as "‹new›" until 4.0 (2.3.1: "until 3.0"). Save the plan again to update it. | `PLAN_LEGACY_REF` |
| P8 | 551 | error | `entries[i].ref` | References unknown field "‹ref›". | `PLAN_UNKNOWN_REF` |
| P9 | 556 | error | `entries[i].ref` | "‹ref›" is mapped more than once. | `PLAN_DUPLICATE_REF` |
| P10 | 563 | error | `entries[i]` | An entry takes either a column or a constant, not both. | `PLAN_SOURCE` |
| P11 | 566 | error | `entries[i]` | An entry needs either a column or a constant. | `PLAN_SOURCE` |
| P12 | 569 | error | `entries[i].column` | column must be a zero-based integer index. | `PLAN_SOURCE` |

**Not produced by 2.3: `PLAN_UNSAFE_PATH`.** `validateMappingPlan` has no `isUnsafePath` check.
A ref such as `__proto__.x` is reported as P8 (`PLAN_UNKNOWN_REF`), because no field can have
that address.

### Decided: the four shape checks

P1, P2, P5 and P6 matched none of the six permitted names. Decided on 2026-10-10: all four are
`PLAN_SHAPE`, a name already in the spec's table, so DE mints no new one. P1 and P2 are exactly
the table's "Not an object, or no `entries` array"; P5 and P6 are the same failure one level
down, and the spec's row is widened to say so.

### Decided: `PLAN_UNSAFE_PATH` is not exported

No 2.3 check produces it, so `PLAN_PROBLEM_CODES` leaves it out, and every exported code is
produced by something. The importer adds it with the check that produces it.

### Decided: "until 3.0" in P7's message

Decision 3 moves the alias's removal from 3.0 to 4.0, so P7's "until 3.0" became false. Decided on
2026-10-10: it is corrected to "until 4.0" with the Decision 3 correction. That is the only message 2.4 changes.
