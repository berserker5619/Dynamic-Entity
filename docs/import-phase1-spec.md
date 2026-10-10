# Sheet Importer — Phase 1 Spec: Plan v2 & Schema Adapter Contracts

Oct 4, 2026 · @Nizamudeen S · revised Oct 10, 2026 · canonical copy: `docs/import-phase1-spec.md`

## Purpose and scope

This spec fixes two contracts before any code moves: **MappingPlan v2**, which is persisted and crosses the wire, and the **SchemaAdapter** family, which replaces the engine's hard dependency on `EntityFormConfig`. Phase 2 (the extraction) and Phase 3 (grouping, split lists, JSON Schema) implement against it.

Baseline is **Dynamic Entity 2.4.0** (published 2026-10-10). 2.3.0 was audited at `d244ae0` in `docs/import-progress-report.md`; the parity suite was hardened in `d244ae0..fc20004` (`docs/import-parity-hardening.md`); 2.3.1 fixed the two browser/server differences that suite found; 2.4.0 added problem codes to `ConfigProblem` (`docs/de-2.4-problem-codes.md`). The 2.2 analysis (`docs/import-extraction-analysis.md`, `fb095e8`) is still the map of the code, but its line numbers and several behaviours are stale; where they disagree, the reports and the section below win.

**In scope**

- Plan v2 types, reading rules, v1 compatibility and strictness.
- Grouping semantics (one-to-many), including the streaming runner.
- List semantics: split cells and positional versus compacted arrays.
- `ValueKind`, `ImportTarget`, `TargetSet`, `SchemaAdapter`, and the generic engine signatures.
- Result, error and version-stamp changes.

**Non-goals for v2**

- Nested repeating lists (`orders[].items[].sku`). Still reported as unsupported.
- Several columns feeding one target (concatenation) and per-entry value maps.
- Server-side staging of uploads (the file is still uploaded twice).
- The generic Angular mapper UI (Phase 4).

**Package boundaries**

The importer is a new standalone package (Decision 1). Dependencies point one way only:

- **The importer depends on nothing in Dynamic Entity.** It MUST NOT import `@dynamic-entity/*`, at runtime or in its types. The generic engine, `readPlan`, the coercers, `jsonSchemaAdapter` and `exampleJsonAdapter` live in it.
- **`entityFormConfigAdapter` lives in Dynamic Entity**, in `@dynamic-entity/core`, and imports the importer. It is the only code that knows both sides. The deprecated re-exports of Decision 2 go the same direction: core re-exports from the importer, never the reverse. A design that needs the importer to import core is a cycle, and a spec bug.
- **The browser entry point has no runtime dependencies.** exceljs, busboy and anything else Node-only live behind a separate `/node` subpath (readers, `runImport`, the router factory). Today `@dynamic-entity/core` publishes with zero dependencies, and every DE browser app imports it; once it re-exports the importer, it must not pull in the xlsx stack.
- **`@dynamic-entity/server` becomes a thin DE router** over the importer's generic router factory, keeping its DE wiring (config source, rules, lookups, template names).

**Using this with Claude Code**

Treat every MUST as a test case. Implement in this order: types and reader (§3, §4), adapters contracts (§7), engine (§8), then grouping (§5) and lists (§6). Anything this spec leaves open is listed in Open questions; do not decide those silently in code.

## Baseline: what 2.3 and 2.4 already ship

2.3 and 2.4 built several pieces this spec originally described as new. Phase 1 reuses them and MUST NOT re-implement them.

| Concern | Shipped in 2.3 / 2.4 | Used in this spec |
| --- | --- | --- |
| Record addresses | `collectFieldRefs(config)` → `FieldRefEntry { ref, recordScope, tabLevel, authored }`; a moved tab-level container takes its subtree to the override | DE adapter's target refs (§7) |
| Rule evaluation | Once, against one flat map of the whole config (`flattenFieldValues`, `namesOfField`), bare id and `[ref]`; hide > show > `showWhen`; ambiguous bare id hides every match | DE adapter's `validate` (§7) |
| Legacy plans | `upgradeLegacyRefs`: 2.2 un-indexed refs of moved containers resolve with a `PLAN_LEGACY_REF` warning; removal moved to 4.0 in 2.4.0 (Decision 3) | Reading rules (§4) |
| Slot sizing | `arrayBoundFor`, `inferArrayBound`, `DEFAULT_ARRAY_ROWS` = 3, cap 1000, header numbers past `max(headers, 100)` ignored | Per-array `slots` (§6, §8) |
| Slot headers | `array-headers.ts` grammar: `A n C`, `A C n`, `C n`, `C (n)`, one-child `A n`; all `guess`; a key two fields answer to matches neither | `suggestMapping` (§6) |
| CSV input | `detectDelimiter`, `createCsvReader({ delimiter })`, `parseCsv(…, { delimiter })`, `completeFirstLine`; `.tsv` is tab | Readers move as-is (Phase 2) |
| Decimal mark | `CoerceOptions.decimal`, `decimalMarkFor`; `;` implies a decimal comma; server can override, browser cannot | Generic coercion (§8) |
| Typed cells | `SheetGrid { headers; rows: unknown[][] }`, `cellText` (server `sampleText` is an alias); `SheetParser` returns `SheetGrid` | Engine rows, group keys (§5, §8) |
| Problems | 2.4.0: `ConfigProblem { level, code?, path, message }`, `code` set on every problem DE emits; `CONFIG_PROBLEM_CODES` (55) and `PLAN_PROBLEM_CODES` exported as `const`. `validateMappingPlan` already emits `PLAN_SHAPE`, `PLAN_TARGET_MISMATCH`, `PLAN_LEGACY_REF`, `PLAN_UNKNOWN_REF`, `PLAN_DUPLICATE_REF`, `PLAN_SOURCE`. Row errors have **no code**. Server `ImportErrorCode` has `SHEET_TOO_LARGE`, `UNSUPPORTED_FORMAT`, `INVALID_PLAN` | The six plan codes keep their meaning; the rest of §4's table and the row codes (§9) are new in Phase 1 |
| Config validation | `validateConfig` now rejects authored `refererField` inside arrays, unknown rule operators/actions, field-level `required`, and more | DE adapter fixtures must pass it |
| Deferred | Positional arrays (Issue 2): a `null` slot does not survive the form (rendered as an empty row, saved back as an object) | `lists.compact` (§6) |

**Changed in 2.3.1**, and binding on the extraction:

- The server reads a `.tsv` upload by tabs. The filename is a delimiter hint only, applied after magic-byte format detection; it never decides the format.
- Tab-level placement (write at the position **and** at the `refererField`) is one core function shared by the form's `extractRecord` and import. Imported and saved records now have the same shape. The DE adapter's `finalize` MUST call that function, not re-implement it.

## Terminology and conventions

The address language stays exactly as today: dot paths with numeric segments for array rows, never brackets (rules already use `[ref]` tokens).

| Term | Meaning | Example |
| --- | --- | --- |
| ref | Concrete dot path of one leaf in a record | `customer.phones.1.number` |
| shape ref | A ref with numeric segments removed (today's `stripIndices`) | `customer.phones.number` |
| array ref | Shape ref of a repeating container | `customer.phones`, `items` |
| slot | One numbered position of an unrolled array, from numbered columns | `phones.0`, `phones.1` |
| sheet row | One data row of the source, 1-based, header = row 1 | row 7 |
| record | One output object produced by the engine | one order |
| group | The sheet rows that produce one record when grouping is on | rows 4–6 |
| collected array | An array ref whose items accumulate across a group's rows | `items` |
| adapter | The object that tells the engine what the targets are and how to coerce and judge them | `jsonSchemaAdapter(schema)` |

Keywords MUST, MUST NOT, SHOULD and MAY are used in their RFC 2119 sense. Column indices are zero-based; sheet row numbers are one-based.

## MappingPlan v2

Every v2 addition is optional, so a v1 plan is a valid v2 plan once read through the aliases in §4. The source side stays index-based; `header` remains display and drift detection only.

```typescript
export interface MappingEntry {
  ref: string;                      // concrete ref; at most one entry per ref
  column?: number;                  // zero-based source column
  header?: string;                  // header text at authoring time (display, drift)
  constant?: unknown;               // literal for every row; exclusive with column
  confidence?: 'exact' | 'guess';
  split?: string;                   // v2: separator; only valid on a list target (§6)
}

export interface ListOptions {
  compact?: boolean;                // v2: default true (today's behaviour); false = positional
}

export interface GroupSpec {
  key: number[];                    // column indices; non-empty; values joined form the group key
  collect: string[];                // array refs that accumulate across the group's rows; non-empty
  contiguous?: boolean;             // default true; see §5
}

export interface MappingPlan {
  planVersion?: 2;                  // absent = v1
  target: string;                   // v2 name; v1 alias: entity
  schemaVersion?: number;           // v2 name; v1 alias: configVersion
  sourceHeaders?: string[];
  entries: MappingEntry[];
  lists?: Record<string, ListOptions>;  // keyed by array ref
  group?: GroupSpec;
}
```

| Field | Rule |
| --- | --- |
| `planVersion` | MUST be `2` when any v2-only field (`split`, `lists`, `group`) is present. Writers MUST always emit it. |
| `target`, `schemaVersion` | Compared with the adapter's `id` and `version`. Mismatch is a warning, never an error (unchanged from v1). |
| `entries[].ref` | MUST resolve to a target the adapter produced for this plan's array bound. Duplicate refs are an error. |
| `entries[].column` / `constant` | Exactly one MUST be present. `column` MUST be a non-negative integer. |
| `entries[].split` | Non-empty string, max 8 characters. Error if the target's value kind is not `list`. |
| `lists` | Keys MUST be array refs the adapter knows. Unknown key is an error. |
| `group` | See §5. Every `collect` entry MUST be an array ref; every `key` index MUST be a valid column. |

The array bound stays derived from the plan (`arrayBoundOf`, max 1000), so a plan with slot 4 is never truncated to a UI default.

The header is always sheet row 1, and data starts at row 2 (Decision 8). v2 has no `headerRow`. It is specified, unscheduled, in the appendix **Deferred: header row**.

## Reading rules

Every plan enters the engine through one function, `readPlan(input: unknown): { plan: MappingPlan; problems: PlanProblem[] }`. Nothing else parses a plan, on either side of the wire.

1. **Shape check.** Input MUST be a plain object with an `entries` array. Anything else is an `error` and no plan is returned.
2. **Aliasing.** `entity` is read as `target` and `configVersion` as `schemaVersion`. If both names are present with different values, that is an `error`. If both agree, a `warning` asks the writer to drop the old name.
3. **Version.** Absent `planVersion` means v1. `planVersion: 2` means v2. Any other value is an `error`: a reader MUST NOT guess at a future version.
4. **v1 plans with v2 fields.** A plan without `planVersion` that carries `split`, `lists` or `group` is an `error`, not an upgrade. This catches a v2 writer that forgot to stamp the version.
5. **Unknown keys.** On a **v2** plan, any top-level or entry key not in §3 is an `error`. Ignoring `group` would silently import N records instead of 1, so strictness is the default.
   - On a **v1** plan, an unknown **top-level** key is a `PLAN_UNKNOWN_KEY` **warning**, and the key is dropped from the returned plan. 2.3's `validateMappingPlan` never checked keys, so consumers have stored v1 plans carrying their own fields (`id`, `name`, `createdAt`). Those plans must keep importing after an upgrade. They cannot carry v2 semantics either: a v1 plan with a v2 field is already an error under rule 4.
   - An unknown **entry** key is an `error` on both versions.
   - A reader MAY offer `{ allowUnknownKeys: true }` for tooling, never for `runImport` or the HTTP router.
6. **Unsafe refs.** Every ref, `lists` key and `collect` entry passes `isUnsafePath`. A failing path is an `error`.
7. **Normalisation.** The returned plan always has `planVersion: 2`, `target` and `group.contiguous` (default true) filled in. Downstream code never re-applies defaults.

`PlanProblem` is DE 2.4's `ConfigProblem` shape with the code required: `{ level: 'error' | 'warning'; code: PlanProblemCode; path: string; message: string }`. DE 2.4 already emits six of the codes below from `validateMappingPlan`, with the meanings given here; the rest are new in Phase 1. Any `error` stops the run before the first row is read. On the server this is the existing `INVALID_PLAN` error code, returned from `/validate` and `/import` with `planProblems` attached. `/preview` takes no plan, so it never returns `INVALID_PLAN`.

**Writing.** The mapper and `suggestMapping` MUST emit v2 names only, with `planVersion: 2`. Stored v1 plans are never rewritten in place; they are upgraded when next saved.

**Talking to an older server.** A DE 2.x server reads every plan as v1, and ignores keys it does not know. So a v2 plan with `group`, posted to it, is accepted and imports one record per row: a silent wrong result, which rule 5 exists to prevent. A warning about the engine version (§9) is not enough, so:

- Preview responses carry `planVersions: number[]`, the plan versions the server reads. A response without it, from any pre-v2 server, means `[1]`.
- Before committing, a client MUST check the plan against the server it is talking to. If the plan uses any v2-only feature (`split`, `lists`, `group`) and the server does not list `2`, the client MUST refuse to commit, and say the server needs upgrading.
- A plan that uses no v2-only feature MAY be sent to such a server in v1 form (`entity`, `configVersion`, no `planVersion`), since it means the same thing there.

**Legacy refs.** 2.3's `upgradeLegacyRefs` rewrites 2.2 refs of moved containers with a `PLAN_LEGACY_REF` warning. It moves behind an optional adapter hook, `upgradeRefs?(plan): { plan; problems }`, which `readPlan`'s caller runs after reading and before `validatePlan`. The DE adapter implements it with `upgradeLegacyRefs`; generic adapters omit it. The alias is kept through DE 3.x and removed in 4.0 (Decision 3).

**Problem codes.** Codes are stable identifiers; messages may change. Tests and UIs MUST compare codes, never message text.

| Code | Level | When |
| --- | --- | --- |
| `PLAN_SHAPE` | error | Not an object, no `entries` array, or an entry that is not an object or has no ref |
| `PLAN_VERSION` | error | `planVersion` other than absent or 2; or v2 fields without `planVersion` |
| `PLAN_UNKNOWN_KEY` | error / warning | Key not in §3: an error, except an unknown top-level key on a v1 plan, which is a warning (rule 5) |
| `PLAN_ALIAS_CONFLICT` | error | `entity`/`target` (or `configVersion`/`schemaVersion`) disagree |
| `PLAN_ALIAS_USED` | warning | An old name present and agreeing |
| `PLAN_UNSAFE_PATH` | error | A ref, `lists` key or `collect` entry fails `isUnsafePath` |
| `PLAN_UNKNOWN_REF` | error | Ref not among the adapter's targets |
| `PLAN_DUPLICATE_REF` | error | Two entries share a ref |
| `PLAN_SOURCE` | error | Not exactly one of `column`/`constant`, or a bad column index |
| `PLAN_SPLIT_TARGET` | error | `split` on a non-list target |
| `PLAN_LIST_OPTION` | error | Bad `lists` key, `compact` on a `collect` array, or `compact: false` on an adapter without positional support |
| `PLAN_GROUP` | error | Bad `group` (empty `key`/`collect`, non-array `collect`, bad key column), or `contiguous: false` in `runImport` (Decision 7) |
| `PLAN_LEGACY_REF` | warning | A ref rewritten by `upgradeRefs` |
| `PLAN_TARGET_MISMATCH` | warning | `target`/`schemaVersion` differ from the adapter's `id`/`version` |

DE's own `ConfigProblem` gained the same shape in DE 2.4.0, with 55 `CONFIG_*` codes (for example `CONFIG_REFERER_INSIDE_ARRAY`); see Decisions, item 4. Code namespaces never overlap: `PLAN_*`, `CELL_*` and `RECORD_*` belong to the importer, `CONFIG_*` to DE.

## Grouping (one-to-many)

With `group` set, consecutive sheet rows sharing a key produce one record, and each `collect` array gains one item per row. Without `group`, behaviour is exactly v1: one row, at most one record.

**Keys**

- The group key is the tuple of trimmed cell text at `group.key` columns, compared exactly (case-sensitive). Typed cells are keyed by their `cellText` rendering, so a date cell and its ISO text group together.
- Keys are compared **as tuples**, never as joined text. Joining with a separator lets `["a|b", "c"]` and `["a", "b|c"]` collide. An implementation that needs one string per key MUST use an unambiguous encoding, such as the JSON text of the array.
- A row whose key cells are all blank is its own group (never merged), and gets a `RECORD_GROUP_NO_KEY` warning (§9): "no group key; imported as its own record".
- `key` columns SHOULD also be mapped to a target, but need not be.

**Building a grouped record**

1. Each row is mapped as in v1 into a row record. Entries whose ref sits under a `collect` array produce that row's item for the array; every other entry is a *parent field*.
2. The first row's parent fields seed the record. Later rows' parent fields are compared with it: a blank cell is ignored, an equal value is fine, a different value is a `RECORD_GROUP_CONFLICT` warning ("rows disagree on customer.email; kept row 4"). First row wins.
3. Each row's collected item is appended to its array, unless every leaf of the item is blank. Items are not de-duplicated: two identical line items are two items.
4. Non-collected arrays (numbered-column slots) follow the parent-field rule as a whole.
5. `finalize` and `validate` run once, on the finished record, after the last row of the group.

**Contiguity**

- `contiguous: true` (default) requires a group's rows to be adjacent. The engine keeps the set of *closed* keys; a closed key that appears again fails the import with `GROUP_NOT_CONTIGUOUS`, naming the key and both row numbers. The closed-key set holds keys only. Two new limits bound it, because a count alone does not bound memory (200,000 keys of a few long cells can reach hundreds of megabytes):
  - `maxGroups` (default 200,000) bounds the number of keys;
  - `maxGroupKeyBytes` (default 8 MiB) bounds their total encoded length.
  Exceeding either fails the import with `TOO_MANY_GROUPS`.
- `contiguous: false` lets rows of a group appear anywhere. The browser transport MAY support it, since it holds the whole sheet. `runImport` MUST refuse it before reading a row: the `INVALID_PLAN` error, carrying a `PLAN_GROUP` problem whose message says "non-contiguous grouping is not supported for streaming imports; sort the sheet by the key columns" (Decision 7).

**Streaming (`runImport`)**

- A batch boundary never splits a group. The runner carries the open group across the boundary and flushes it at the next key change or at end of file.
- Peak memory becomes bounded by `batchSize` plus the largest group. A new limit `maxGroupRows` (default 10,000) fails the import with `GROUP_TOO_LARGE` rather than buffering without bound.
- `onBatch` still receives finished records only.

**Errors and counts**

- Grouped errors and warnings carry `rows: number[]`, the sheet rows of the record in ascending order, in addition to `row` (= `rows[0]`). A list, not a `[first, last]` range: under `contiguous: false` a group's rows need not be adjacent. See §9.
- Group warnings go in `warnings`, never in `errors` (§9). A record with warnings is imported.
- `rowsRead`, `skipped` and `failed` keep counting sheet rows; `imported` counts records. `failed` counts rows with an **error** only. The reconciliation becomes `rowsInImported + skipped + failed === rowsRead`, where `rowsInImported` is reported too.
- If any row of a group fails coercion, the whole record fails and all its rows count as `failed`.

## Lists

An array reaches a sheet in one of three layouts. v2 gives each an explicit, testable rule.

| Layout | Target | Plan | Example |
| --- | --- | --- | --- |
| Numbered columns | Array of objects or primitives, unrolled into slots | One entry per slot ref (`phones.0.number`) | `Phone 1 Number`, `Phone 2 Number` |
| Split one cell | Array of primitives (`ValueKind` `list`) | One entry on the list ref, optional `split` | `festive; cotton` |
| One item per row | Array of objects listed in `group.collect` | Entries on item refs with no slot index (`items.sku`) | three rows of one order |

**Split cells**

- The separator is `entry.split`, else the target's `ValueKind.list.separator`, else `;`.
- Each part is trimmed; empty parts are dropped. Each part is coerced with the list's item kind (`of`), so `"3; 5"` into a `number` list gives `[3, 5]`.
- A part that fails coercion fails the cell with `CELL_LIST_ITEM`, and the message names the part's position ("item 2: not a number").
- A typed cell (number, date, boolean) is a one-item list.
- The DE adapter maps today's `tags` and `multiSelect` onto `list` with separator `;`, so DE behaviour is unchanged.

**Positional versus compacted slots**

- `lists[arrayRef].compact` defaults to `true`: 2.3's `compactArrays` behaviour, holes removed and items renumbered.
- `compact: false` keeps position: data only in slot 2 yields `[null, {…}]`, with `null` for every empty slot before the last filled one. Trailing empty slots are trimmed. This is Issue 2, deferred from 2.3.
- `compact` applies only to numbered-column arrays. Setting it on a `collect` array is `PLAN_LIST_OPTION`.
- **Adapter capability.** Each entry in `TargetSet.arrays` declares `positional: boolean`. `compact: false` on an array whose adapter says `false` is `PLAN_LIST_OPTION`, never silently compacted.
- **DE adapter: `positional: false` until the renderer keeps `null` slots.** Today a `null` slot renders as an empty row and is saved back as an object, so a record would differ depending on whether it came from import or the form. Turning it on requires a renderer contract (render a placeholder row, save `null` back) shipped in DE first. JSON Schema and example adapters declare `positional: true`.

**Header recognition for slots** (feeds `suggestMapping`)

- The grammar already shipped in 2.3 (`array-headers.ts`): `A n C`, `A C n`, `C n`, `C (n)` (normalises to `C n`), and `A n` for a one-child array; singular is the trivial `-s` strip for names longer than 3 characters. Phase 2 moves it unchanged; the extraction MUST NOT re-derive it.
- Every slot match is `confidence: 'guess'`. A key that two different targets answer to matches neither.
- **v2 change: bounds become per array.** 2.3's `arrayBoundFor` returns one bound for the whole config. v2's `slots` is `Record<arrayRef, number>`, each `max(DEFAULT_ARRAY_ROWS, highest slot the headers name for that array, highest slot the plan maps)`, capped at 1000, with header numbers past `max(headers.length, 100)` ignored as in 2.3. The 2.3 single-bound function stays as the max over all arrays, for DE callers.

## Schema adapter contracts

The engine needs four things from a schema: its targets, how a cell becomes a value, what to do to a finished record, and how to judge it. `ImportTarget` replaces `ImportColumn`; its `field` becomes adapter-owned `meta`.

```typescript
export type ValueKind =
  | { kind: 'string'; minLength?: number; maxLength?: number; pattern?: string; format?: 'email' | 'url' | 'phone' }
  | { kind: 'number'; integer?: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'date' } | { kind: 'datetime' } | { kind: 'time' } | { kind: 'month' }
  | { kind: 'enum'; values: readonly unknown[]; labels?: readonly string[] }
  | { kind: 'list'; of: ValueKind; separator?: string; minItems?: number; maxItems?: number }
  | { kind: 'custom' };               // adapter.coerce MUST handle it

export interface ImportTarget<TMeta = unknown> {
  ref: string;                        // concrete ref, slot indices included
  shapeRef: string;
  header: string;                     // generated template header
  matchKeys?: readonly string[];      // loose candidates for suggestMapping
  required: boolean;
  value: ValueKind;
  format?: string;                    // template help-row hint, e.g. YYYY-MM-DD
  arrayRef?: string;                  // nearest repeating ancestor (2.3: ImportColumn.arrayRef)
  arrayLabel?: string;                // its resolved label (2.3: ImportColumn.arrayLabel)
  arrayIndex?: number;                // slot, when unrolled
  meta: TMeta;
}

export interface TargetSet<TMeta = unknown> {
  targets: ImportTarget<TMeta>[];
  arrays: { ref: string; label: string; itemKind: 'object' | 'primitive'; required: boolean; positional: boolean }[];
  unsupported: { ref: string; reason: string }[];
}

export interface SchemaAdapter<TMeta = unknown, TCtx = unknown> {
  readonly id: string;                // compared with plan.target
  readonly version?: number;          // compared with plan.schemaVersion
  readonly adapterVersion: string;    // semver of the adapter implementation
  targets(opts: { slots: Record<string, number>; lang?: string }): TargetSet<TMeta>;
  upgradeRefs?(plan: MappingPlan): { plan: MappingPlan; problems: PlanProblem[] };
  coerce?(t: ImportTarget<TMeta>, raw: unknown, ctx: TCtx): CoerceOutcome | null;
  finalize?(record: Record<string, unknown>, ctx: TCtx): Record<string, unknown>;
  validate?(record: Record<string, unknown>, ctx: TCtx): RecordProblem[];
}
```

**Rules**

- `targets` MUST be pure and deterministic for the same inputs. `slots` maps array ref to slot count; an array absent from `slots` gets 1 slot for suggestion and 0 for apply. `applyMapping` receives no headers, so it sizes `slots` from the plan alone: per array, the highest slot the plan maps plus one (`arrayBoundOf`, per array).
- `upgradeRefs` runs once per plan, after `readPlan` and before `validatePlan`. It MUST only rewrite refs and report `PLAN_LEGACY_REF` warnings; it MUST NOT add or drop entries.
- `coerce` returning `null` means "use the generic coercer for `t.value`" (§8). A `custom` kind with no `coerce` is an adapter bug and throws at construction.
- `finalize` defaults to identity; `validate` defaults to the generic checks in §8. Both run after grouping and compaction.
- `RecordProblem` gains a required `code` from the row-code table in §9, and the engine copies it onto the `ImportRowError` it reports. The DE adapter maps its checks to `RECORD_REQUIRED`, `RECORD_FORMAT`, `RECORD_RANGE` and `RECORD_RULE`; a generic validator uses the same four. A `coerce` failure carries `CELL_FORMAT`, `CELL_UNKNOWN_OPTION` or `CELL_LIST_ITEM`.
- Adapters MUST NOT read files, mutate the plan, or hold per-run state outside `TCtx`.

**Adapters in scope**

| Adapter | `meta` | Notes |
| --- | --- | --- |
| `entityFormConfigAdapter(config, { rules, lookups })` | `NestedFieldConfig` | Target refs come from `collectFieldRefs`, never `refOf` or `getTabData`, so moved tab-level containers land at their override. `validate` evaluates rules once against the whole config through `flattenFieldValues`, with 2.3's precedence. `upgradeRefs` = `upgradeLegacyRefs`. `positional: false` on every array. `coerce` = `coerceCell` with `decimal`. MUST be behaviour-identical to 2.3; the hardened parity suite (§10) is the gate. |
| `jsonSchemaAdapter(schema, { validator? })` | JSON Schema node | Local `$ref`, `allOf`, first non-null `oneOf`/`anyOf`. `enum` stores the raw value. `positional: true`. Optional Ajv via `validator` (peer dependency, not bundled). |
| `exampleJsonAdapter(sample)` | inferred node | Kinds inferred from values; array lengths seed `slots`. Nothing is `required`. `positional: true`. |

## Engine API and coercion

The engine is 2.3's algorithm with `config` replaced by `adapter` and grouping added. Rows are already `unknown[][]` end to end in 2.3 (`SheetGrid`), so typed cells need no new work. The decimal mark becomes an engine option on both sides, closing 2.3's gap where only the server could override it.

```typescript
export function readPlan(input: unknown, opts?: { allowUnknownKeys?: boolean }): { plan?: MappingPlan; problems: PlanProblem[] };
export function validatePlan<M, C>(plan: MappingPlan, adapter: SchemaAdapter<M, C>): PlanProblem[];
export function slotsFor<M, C>(headers: readonly string[], adapter: SchemaAdapter<M, C>, plan?: MappingPlan): Record<string, number>;
export function suggestMapping<M, C>(headers: readonly string[], adapter: SchemaAdapter<M, C>): MappingPlan;
export function applyMapping<M, C>(
  rows: readonly (readonly unknown[])[],
  plan: MappingPlan,
  adapter: SchemaAdapter<M, C>,
  ctx: C,
  opts?: { firstRowNumber?: number; decimal?: '.' | ',' },
): ImportResult;
export function coerceValue(kind: ValueKind, raw: unknown, opts?: { decimal?: '.' | ',' }): CoerceOutcome;
```

`suggestMapping` derives `slots` from the headers (§6), then returns a v2 plan. `applyMapping` calls `readPlan` and `validatePlan` itself; callers MAY call them earlier to fail fast. `firstRowNumber` defaults to 2, because the header is sheet row 1.

**Generic coercion** (`coerceValue`), lifted from today's `coerceCell` and `coerceTypedCell`. `null`, `undefined` and blank text are always "no value".

| Kind | Text input | Typed input |
| --- | --- | --- |
| `string` | Trimmed | Rendered with `cellText` (midnight-UTC `Date` → `YYYY-MM-DD`, else ISO) |
| `number` | `NUMERIC` shape. Decimal `.`: commas are grouping and stripped. Decimal `,` (default when the delimiter is `;`): `1,5` → 1.5, `1.234,5` → 1234.5, `1,500` → 1.5, point-decimal rejected. `integer` rejects fractions | Number as-is |
| `boolean` | `true t yes y 1` / `false f no n 0`, case-insensitive | Boolean as-is |
| `date` | Bare ISO read textually (no TZ shift, rejects 2024-02-30), else parsed → `YYYY-MM-DD` | `Date` by UTC parts |
| `datetime` | Parsed → ISO string | `Date` → ISO |
| `time` | `H:mm[:ss]` or UTC instant → `HH:mm` | `Date` UTC hours and minutes |
| `month` | `YYYY-M(M)` or any calendar date → `YYYY-MM` | `Date` UTC year and month |
| `enum` | Case-insensitive match against `values` (as text) and `labels`; stores the matching value. No match is `CELL_UNKNOWN_OPTION` | Matched by `cellText` form; no match is `CELL_UNKNOWN_OPTION` |
| `list` | Split per §6, each part via `of` | One-item list |

**Generic validation** (when the adapter has no `validate`): `required` (absent, or an empty list), `number` min/max, `string` min/max length, `pattern`, `format`, `list` min/max items. `pattern` runs on input bounded by `maxCellLength`, as today. Array items are validated per existing item; an empty optional array passes.

## Results, errors and versions

The result types change by additive, optional fields only, and no existing field changes type. Two kinds of code depend on the shapes and both must still compile: code that reads a 2.x result, and code that *builds* one. `ImportTransport.commit` returns an `ImportResult`, so every custom transport builds one.

```typescript
export interface ImportRowError {
  row: number;                 // first sheet row of the record
  rows?: number[];             // v2: every sheet row of a grouped record, ascending
  ref: string;                 // unchanged, still required; '' for a problem that belongs to the whole record
  column?: number;
  code?: RowProblemCode;       // v2: optional on the type; set on everything the engine emits
  message: string;
  raw?: unknown;
}

/** What `applyMapping` and `ImportTransport.commit` return. Holds every record and problem. */
export interface ImportResult {
  records: Record<string, unknown>[];
  errors: ImportRowError[];    // errors only: each row here is a failed row
  warnings?: ImportRowError[]; // v2: never fail a record, never counted as failed
  skipped: number;
  planProblems: PlanProblem[];
  rowsRead?: number;           // v2, optional on the type, always set by the engine
  imported?: number;           // records produced
  rowsInImported?: number;     // sheet rows those records came from (= imported without grouping)
  failed?: number;             // sheet rows with an error
}
```

**Warnings are not errors.** `errors` keeps exactly its 2.x meaning: every entry fails its record. The server counts `failed` as the distinct rows in `errors` (`run-import.ts`), and clients treat a non-empty `errors` as failure. So group warnings (`RECORD_GROUP_CONFLICT`, `RECORD_GROUP_NO_KEY`) go in `warnings` and nowhere else.

**The server keeps its own result type.** `runImport` streams, and retains only `maxReportedErrors` errors, so it returns `ImportRunResult`, not `ImportResult`. That type already has `imported`, `failed`, `rowsRead`, `errorCount` and `truncated`. v2 adds three fields:
- `rowsInImported`;
- `warnings`, retained under the same `maxReportedErrors` bound as errors;
- `warningCount`, the true total, as `errorCount` is for errors.

The two types are not merged.

**Row codes.** Every row error and warning the engine emits carries one. As with plan codes, tests and UIs compare codes, never messages.

| Code | Level | When |
| --- | --- | --- |
| `CELL_FORMAT` | error | A cell that cannot be read as its target's kind: not a number, a date, a time or a boolean |
| `CELL_LIST_ITEM` | error | One item of a split cell fails its list's item kind (§6); the message names the item's 1-based position |
| `CELL_UNKNOWN_OPTION` | error | An `enum` cell matching no value or label |
| `RECORD_REQUIRED` | error | A required target with no value, or an empty required list |
| `RECORD_FORMAT` | error | `pattern` or `format` (email, url, phone) not met |
| `RECORD_RANGE` | error | `min`/`max`, length, or list item count out of bounds |
| `RECORD_RULE` | error | A rule's validation message (DE adapter) |
| `RECORD_GROUP_CONFLICT` | warning | Rows of one group disagree on a parent field; the first row's value is kept (§5) |
| `RECORD_GROUP_NO_KEY` | warning | A row with a blank group key, imported as its own record (§5) |

**Version stamps.** One `engineVersion` no longer identifies behaviour after extraction. Preview and commit responses carry both:

| Field | Value | Compared at |
| --- | --- | --- |
| `engineVersion` | Importer package semver | major.minor, as today |
| `adapter` | `{ name, version }`, e.g. `{ name: "dynamic-entity", version: "3.0.0" }` | major |

A client whose versions differ from the server's at those levels MUST show a warning before committing, and SHOULD re-run `/validate`.

Preview responses also carry `planVersions: number[]`, the plan versions the server reads, and absent means `[1]`. Unlike the version stamps, a mismatch here is not a warning. A plan using v2-only features MUST NOT be committed to a server that does not list `2` (§4, "Talking to an older server").

**New error codes**

| Code | HTTP | When |
| --- | --- | --- |
| `GROUP_NOT_CONTIGUOUS` | 422 | A closed group key reappears (§5) |
| `GROUP_TOO_LARGE` | 413 | A group exceeds `maxGroupRows` |
| `TOO_MANY_GROUPS` | 413 | Closed keys exceed `maxGroups` or `maxGroupKeyBytes` |

Plan-reading failures, including unknown keys and unsupported `contiguous: false` on the server (`PLAN_GROUP`), stay under the existing `INVALID_PLAN` code with `planProblems` attached.

Existing server codes keep their meaning: `SHEET_TOO_LARGE` for row, column, cell and header-line limits (2.3 never had the `LIMIT_EXCEEDED` its plan named), `UNSUPPORTED_FORMAT` for non-workbook zips. New limits are `maxGroups`, `maxGroupKeyBytes` and `maxGroupRows`, added to `ImportLimits` with the defaults in §5.

## Acceptance criteria

Phase 1 is done when these types compile and the reader and contract tests below pass. The parity gate applies to Phase 2.

**Parity prerequisites.** Done in `d244ae0..fc20004`, with both differences found fixed in 2.3.1. Every item below MUST stay green, with no `it.failing` left, through every Phase 2 commit:

- [x] One shared preview fixture file run through both `LocalImportTransport.preview` and server `previewSheet`, asserting equal `arrayBound`, `delimiter` and suggested plan.
- [x] Snapshots of the moved-array and moved-group derivations (`import-moved-containers.spec.ts` fixtures) alongside `all-configs.spec.ts`.
- [x] The browser typed-parser tests added to `scripts/check-timezones.mjs` `SUITES`, so they run at negative offsets.
- [x] A browser unit test for the decimal comma (`;` file, `1,500` → 1.5).
- [x] One test that imports the same xlsx workbook through the browser (typed parser) and the server and asserts identical records.

**Plan reading**

- [ ] A stored v1 plan from each fixture in server/src/`all-configs.spec.ts` reads without errors and normalises to `planVersion: 2`.
- [ ] `entity` + `target` with different values → `error`; same values → `warning`.
- [ ] On a v2 plan, an unknown top-level key or an unknown entry key → `error`, no plan returned. `planVersion: 3` → `error`, no plan returned.
- [ ] A v1 plan carrying `id`, `name` and `createdAt` → reads, with one `PLAN_UNKNOWN_KEY` warning per key, and the keys are dropped from the returned plan. An unknown *entry* key on a v1 plan → `error`.
- [ ] A plan without `planVersion` carrying `group` → `error`.
- [ ] `split` on a non-list target, `compact` on a `collect` array, `collect` on a non-array ref → `error`.
- [ ] `__proto__`, `constructor` and similar in any ref position → `error`.

**Grouping**

- [ ] 7 order rows with 4 distinct contiguous keys → 4 records; line items preserved in sheet order.
- [ ] Parent-field disagreement → one `RECORD_GROUP_CONFLICT` entry in `warnings` (none in `errors`) with `rows`. The first row's value is kept, the record is imported, and `failed` is 0.
- [ ] A closed key reappearing → `GROUP_NOT_CONTIGUOUS` naming both rows.
- [ ] A group straddling a batch boundary at `batchSize: 2` → one record, identical to the unbatched result.
- [ ] `contiguous: false` → accepted by `applyMapping`, refused by `runImport` with `INVALID_PLAN` carrying a `PLAN_GROUP` problem, before any row is read.
- [ ] Keys `["a|b", "c"]` and `["a", "b|c"]` → two groups.
- [ ] Closed keys whose total encoded length exceeds `maxGroupKeyBytes` → `TOO_MANY_GROUPS`, though their count is under `maxGroups`.
- [ ] `rowsInImported + skipped + failed === rowsRead` on every grouping fixture.
- [ ] Peak heap with 50,000 rows in groups of 5 stays under the existing 16 MB `stress.spec.ts` bound.

**Lists**

- [ ] `"festive; cotton"` → `["festive","cotton"]`; `split: "|"` honoured; `"3; x"` into a number list → a `CELL_LIST_ITEM` error whose message names item 2.
- [ ] An `enum` cell matching no value or label → `CELL_UNKNOWN_OPTION`, on text and typed input alike.
- [ ] Slot 2 only, `compact: false` → `[null, {…}]`; default → one item at index 0.
- [ ] Headers `Phone 1 Number`, `Phone 2 Number`, `phone_3_number` suggest slots 0–2 of `phones.number`.

**Adapters**

- [ ] `entityFormConfigAdapter`: the full existing core and server suites pass unchanged against the generic engine, except for the additive `code` and `warnings` fields. A test that compared a whole error object may add the code, and nothing else (Phase 2 gate).
- [ ] `jsonSchemaAdapter` on the order schema from the prototype produces the same records as the prototype's sample run.
- [ ] `exampleJsonAdapter` on the student example infers 2 guardian slots and a split `clubs` list.
- [ ] A `custom` kind without `coerce` throws at adapter construction.

**Added after the 2.3 audit**

- [ ] Every plan problem carries a code from the §4 table; no test compares message text.
- [ ] A 2.2 plan with `phones.number` against a moved array reads through the DE adapter's `upgradeRefs` with one `PLAN_LEGACY_REF` warning, identical to 2.3's result.
- [ ] `compact: false` on a DE array → `PLAN_LIST_OPTION`; on a JSON Schema array → positional output.
- [ ] `slotsFor` returns per-array bounds: headers naming `Phone 6` and `Guardian 2` give `{ phones: 6, guardians: 3 }` (3 is the default floor).
- [ ] `applyMapping({ decimal: '.' })` on a `;` file reads `1.5` as 1.5 in the browser engine, matching the server override.
- [ ] DE adapter targets for a moved tab-level array equal 2.3's `deriveImportColumns` output for the same config.

**Added in the spec review (2026-10-10)**

- [ ] Every row error and warning the engine emits carries a code from §9's row-code table.
- [ ] Contract test: an `ImportTransport` written against 2.x, whose `commit` returns `{ records, errors, skipped, planProblems }` with no new field, still compiles.
- [ ] The importer package imports nothing from `@dynamic-entity/*` (a lint rule, not a convention). Its browser entry point bundles with no exceljs or busboy.
- [ ] A preview response lacking `planVersions` (a 2.x server) and a plan with `group` → the client refuses to commit. The same server and a plan with no v2-only feature → committed in v1 form.
- [ ] A v2 plan carrying `headerRow` → `PLAN_UNKNOWN_KEY` error (v2 has no such field). The first data row of every import is sheet row 2.

## Decisions

Settled on 2026-10-10. These are binding; Claude Code MUST NOT reopen them in code.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Package name and scope | A new standalone name, not under `@dynamic-entity`. The name itself is still open (below). |
| 2 | Re-exports from `@dynamic-entity/core` | Keep deprecated re-exports of moved functions through 3.x; remove in 4.0. |
| 3 | Legacy-ref alias | Keep `upgradeLegacyRefs` behind the DE adapter's `upgradeRefs` through 3.x, with its warning; remove in 4.0. Correct the 2.3 changelog note that announced removal in 3.0. *(Correction shipped in DE 2.4.0.)* |
| 4 | Problem codes in DE | Add an optional `code` to `ConfigProblem`, same `{ level, code, path, message }` shape. DE owns `CONFIG_*`; the importer owns `PLAN_*` and `RECORD_*`. Additive, so it ships in **DE 2.4**, before any extraction. *(Shipped in DE 2.4.0; see `docs/de-2.4-problem-codes.md`.)* |
| 5 | Positional arrays in DE | DE stays compact-only (`positional: false`). No renderer null-slot work in 3.x unless a user asks. Generic adapters are positional from day one. |
| 6 | Group key comparison | Exact after trimming, no option in v2. A match option may be added later, additively. |
| 7 | Non-contiguous grouping on the server | Refused with `PLAN_GROUP`, and the message says to sort by the key columns. The browser path supports it. |
| 8 | Header row | *Revised by the owner on 2026-10-10:* "Cut from v2. The header is always sheet row 1. Choosing another row needs reader, SheetParser and preview changes and comes in a later version, with the Phase 4 header-row hint." The specification is kept in the appendix **Deferred: header row**. |
| 9 | Dual write of moved containers | Kept in 3.0. Storing once is a separate later release using DE's migration system, not part of the extraction. |

**Still open**

- [ ] **The package name.** Check npm availability for the name and for any org scope before Phase 2 creates the package. Phase 1 code uses a placeholder workspace name.

**Later** (not v2, recorded so they are not lost)

- Case-insensitive group key option.
- External sort for non-contiguous grouping on the server.
- Renderer null-slot contract, so DE can be positional.
- Store moved containers once, with a record migration.
- A chosen header row, with the header-row hint in the mapper (Phase 4). Specified in the appendix **Deferred: header row**.

**Order of work that follows from these:** DE 2.4 (problem codes on `ConfigProblem`, plus the changelog correction for decision 3) is **done** (2.4.0, 2026-10-10). Next is Phase 1 (types, `readPlan`, adapter contracts, generic engine), then Phase 2 (extraction under the chosen name).

## Appendix — Deferred: header row (specified, not scheduled)

Cut from v2 by the revised Decision 8 (2026-10-10). The text below was written for v2 while `headerRow` was in scope, and is kept unchanged so a later version can pick it up. Picking it up means doing all of these together:
- restoring `headerRow?: number` to `MappingPlan` and its field-table row;
- listing it among the v2-only features of §3 rule 4, "Talking to an older server" and `planVersions`;
- defaulting it in normalisation;
- adding the `INVALID_OPTIONS` server code it introduces.

**Header row.** `headerRow` has to reach the readers, which today take row 1 as the headers. It also has to reach the preview, which runs before any plan exists. Decision 8 keeps it explicit, so the input path is specified here, not left to Phase 4:

- **Readers.** `readSheet` takes `headerRow?: number` (default 1). It reads and discards the rows above it, and they count against the same row, column and cell limits as data rows, so a workbook cannot hide rows above its header. The browser treats a `SheetParser`'s `SheetGrid` as `[headers, ...rows]`, that is, sheet rows from row 1. With `headerRow: n`, row `n` of that list is the header and the rows after it are data. The `SheetParser` contract does not change.
- **Preview.** `previewSheet` and `LocalImportTransport.preview` take `headerRow?: number`. `/preview` accepts it as a multipart field, and the preview response echoes it. A `headerRow` that is not an integer ≥ 1 is refused with the new server code `INVALID_OPTIONS` (400). A `headerRow` past the last row yields no headers and no rows; that is not an error.
- **Commit.** `runImport` and `applyMapping` take the header row from the plan, and `firstRowNumber` defaults to `plan.headerRow + 1`.

## Revision log

**2026-10-10: architecture review fixes, and the 2.4.0 baseline.** Each review finding and where it landed:

| # | Finding | Change |
| --- | --- | --- |
| 1 | Warnings inside `errors[]` broke `failed` (the server counts distinct rows in `errors`) and every client that treats `errors` as failure | `ImportResult.warnings` and `ImportRunResult.warnings`/`warningCount` are separate. `errors` keeps its 2.x meaning, and group warnings go to `warnings` only (§5, §9) |
| 2 | "Additive only" was false: `ImportRowError.ref` became optional, and new required `ImportResult` fields broke every `ImportTransport` that builds one | `ref` stays required (`''` for a whole-record problem). Every new result field is optional on the type. The server keeps `ImportRunResult` (§9) |
| 3 | Row errors had no code, though "UIs MUST compare codes" | `ImportRowError.code`, plus a row-code table: `CELL_*` for reading a cell, `RECORD_*` for judging a record and for group warnings (§7, §9) |
| 4 | `headerRow` could not work with readers that take row 1, nor with a preview that runs before any plan | Decision 8 keeps `headerRow`, so the readers, the preview and `/preview` take it, as specified under **Header row** (§3). `SheetParser`'s contract is unchanged |
| 5 | A v2 plan with `group`, posted to a 2.x server, silently imports one record per row | Previews advertise `planVersions`. A client MUST refuse to commit a v2-only plan to a server not listing 2, and MAY downgrade a plan with no v2-only feature (§4, §9) |
| 6 | Package boundary unstated; the DE adapter in the importer would be a dependency cycle | **Package boundaries** (scope): the importer has no DE imports, the DE adapter lives in core, and the browser entry has no runtime dependencies |
| 7 | Strict unknown keys would reject stored v1 plans carrying consumer fields, which 2.3 accepted | v1 top-level unknown keys are a `PLAN_UNKNOWN_KEY` warning and are dropped. v2 stays strict, and entry keys stay strict on both (rule 5) |
| 8 | Joined group keys collide, and `maxGroups` bounds count, not memory | Keys are compared as tuples, and a new `maxGroupKeyBytes` limit is added (§5) |
| 9 | Non-contiguous refusal named as `INVALID_PLAN` in §5 and as `PLAN_GROUP` in Decision 7 | Stated once: the `INVALID_PLAN` error carrying a `PLAN_GROUP` problem |
| 10 | `rows: [first, last]` misdescribes a non-contiguous group | `rows: number[]`, ascending |
| 11 | "0 slots for apply" left apply's sizing implicit | `applyMapping` sizes per array from the plan alone (§7) |
| 12 | "Existing suites pass unchanged" contradicted adding codes | The Phase 2 gate allows the additive `code` and `warnings` fields, and nothing else |
| 13 | Decision 3's changelog correction | Done in DE 2.4.0; noted on Decisions 3 and 4 |

Baseline facts updated for 2.4.0: the Problems row, the Legacy plans row, the `PlanProblem` paragraph, the DE `CONFIG_*` note and the order of work. Two stale lines were also fixed. "`/preview` returns `INVALID_PLAN`" was wrong, because preview takes no plan. "Whether the alias survives 3.0 is open" was settled by Decision 3.

**New names introduced by these fixes.** Rename or reject any of them before Phase 1 code uses them:
- the codes `CELL_FORMAT`, `CELL_UNKNOWN_OPTION`, `RECORD_GROUP_CONFLICT` and `RECORD_GROUP_NO_KEY`;
- the server code `INVALID_OPTIONS`;
- the limit `maxGroupKeyBytes` (default 8 MiB);
- the preview field `planVersions`.

The decisions table is unchanged apart from the two status notes.

**2026-10-10: finalised as the canonical copy.** The file was renamed from `docs/Sheet Importer — Phase 1 Spec Plan v2 & Schema Adapter Contracts.md` to `docs/import-phase1-spec.md`.

- **`headerRow` cut from v2.** This follows the owner's revision of Decision 8: "Cut from v2. The header is always sheet row 1. Choosing another row needs reader, SheetParser and preview changes and comes in a later version, with the Phase 4 header-row hint."
  - Removed from: `MappingPlan`, the field table, the v2-only feature lists (the `planVersion` rule, reading rule 4, "Talking to an older server") and normalisation.
  - `firstRowNumber` now defaults to 2.
  - The reader, preview and `/preview` text from the previous entry's finding 4 moved, unchanged, into the appendix **Deferred: header row**, with a note on what restoring it involves.
  - The `headerRow` acceptance test was replaced: a v2 plan carrying `headerRow` is a `PLAN_UNKNOWN_KEY` error.
  - That supersedes finding 4 above.
- **`/preview` and `INVALID_PLAN`.** `/preview` takes no plan, and nothing states that it returns `INVALID_PLAN`. `INVALID_PLAN` comes from `/validate` and `/import` only.
- **`INVALID_OPTIONS` removed.** Its only trigger was `/preview`'s `headerRow`, which is gone, so nothing distinct triggers it in v2. It survives only in the deferred appendix, as the code that would come back with `headerRow`.
- **`CELL_UNKNOWN_OPTION`** is now named wherever an `enum` cell can fail: the coercion table (text and typed input), the adapter rules and the row-code table. A new acceptance test covers it.
- **`CELL_LIST_ITEM`** (new, error) is the code for one failed part of a split cell. The message names the part's 1-based position. Before this, `CELL_FORMAT` had also covered it; now `CELL_FORMAT` means a whole cell of the wrong kind only. It is named in the Lists rules, the adapter rules, the row-code table and the split-cell acceptance test.
- **Group keys are unchanged:** exact tuple comparison, plus the `maxGroupKeyBytes` limit (default 8 MiB).

Of the names the previous entry asked to be confirmed, these stand: `CELL_FORMAT`, `CELL_UNKNOWN_OPTION`, `RECORD_GROUP_CONFLICT`, `RECORD_GROUP_NO_KEY`, `maxGroupKeyBytes` and `planVersions`. `CELL_LIST_ITEM` is added. `INVALID_OPTIONS` is withdrawn.
