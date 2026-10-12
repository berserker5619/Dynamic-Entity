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
  dateOrder?: 'DMY' | 'MDY' | 'YMD'; // v2: the order of a date written in digits (§8)
}

export interface ListOptions {
  compact?: boolean;                // v2: default true (today's behaviour); false = positional
}

export interface GroupSpec {
  key: number[];                    // column indices; non-empty; their trimmed cells, compared as a tuple, form the group key (§5)
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
| `planVersion` | MUST be `2` when any v2-only field (`split`, `dateOrder`, `lists`, `group`) is present. Writers MUST always emit it. |
| `target`, `schemaVersion` | Compared with the adapter's `id` and `version`. Mismatch is a warning, never an error (unchanged from v1). |
| `entries[].ref` | MUST resolve to a target the adapter produced for this plan's array bound. Duplicate refs are an error. |
| `entries[].column` / `constant` | Exactly one MUST be present. `column` MUST be a non-negative integer. |
| `entries[].split` | Non-empty string, max 8 characters. Error if the target's value kind is not `list`. |
| `entries[].dateOrder` | `DMY`, `MDY` or `YMD`; anything else is `PLAN_SHAPE`. The order a date written in digits is read in (§8). It has no effect on a target that holds no date. |
| `lists` | Keys MUST be array refs the adapter knows. Unknown key is an error. |
| `group` | See §5. Every `collect` entry MUST be an array ref; every `key` index MUST be a valid column. |

The array bound stays derived from the plan (`arrayBoundOf`, max 1000), so a plan with slot 4 is never truncated to a UI default.

The header is always sheet row 1, and data starts at row 2 (Decision 8). v2 has no `headerRow`. It is specified, unscheduled, in the appendix **Deferred: header row**.

## Reading rules

Every plan enters the engine through one function, `readPlan(input: unknown): { plan?: MappingPlan; problems: PlanProblem[] }`. `plan` is absent whenever a problem is an `error`. Nothing else parses a plan, on either side of the wire. `readPlan` makes every check that needs no adapter; `validatePlan` makes only those that need targets (Decision 10).

1. **Shape check.** Input MUST be a plain object with an `entries` array. Anything else is an `error` and no plan is returned.
2. **Aliasing.** `entity` is read as `target` and `configVersion` as `schemaVersion`. If both names are present with different values, that is an `error`. If both agree, a `warning` asks the writer to drop the old name.
3. **Version.** Absent `planVersion` means v1. `planVersion: 2` means v2. Any other value is an `error`: a reader MUST NOT guess at a future version.
4. **v1 plans with v2 fields.** A plan without `planVersion` that carries `split`, `dateOrder`, `lists` or `group` is an `error`, not an upgrade. This catches a v2 writer that forgot to stamp the version.
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
- Before committing, a client MUST check the plan against the server it is talking to. If the plan uses any v2-only feature (`split`, `dateOrder`, `lists`, `group`) and the server does not list `2`, the client MUST refuse to commit, and say the server needs upgrading.
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
2. The first row's parent fields seed the record. Later rows' parent fields are compared with it: a blank cell is ignored, an equal value is fine, a different value is a `RECORD_GROUP_CONFLICT` warning ("rows disagree on customer.email; kept row 4"), once per different value. First row wins. A field the first row left blank is filled from the first later row that has it: nothing disagrees.
3. Each row's collected item is appended to its array, unless every leaf of the item is blank. Items are not de-duplicated: two identical line items are two items.
4. Non-collected arrays (numbered-column slots) follow the parent-field rule as a whole.
5. `finalize` and `validate` run once, on the finished record, after the last row of the group.

**Contiguity**

- `contiguous: true` (default) requires a group's rows to be adjacent. The engine keeps the set of *closed* keys; a closed key that appears again fails the import with `GROUP_NOT_CONTIGUOUS`, naming the key and both row numbers. The closed-key set holds keys only. Two new limits bound it, because a count alone does not bound memory (200,000 keys of a few long cells can reach hundreds of megabytes):
  - `maxGroups` (default 200,000) bounds the number of keys;
  - `maxGroupKeyBytes` (default 8 MiB) bounds their total encoded length.
  Exceeding either fails the import with `TOO_MANY_GROUPS`.
- **In `applyMapping`**, a contiguity failure is thrown as an `ImportFailure` with code `GROUP_NOT_CONTIGUOUS` and `details: { key, rows }`. The server maps the same code onto 422. A row with a blank key closes the open run: it is its own record, so a key after it is not adjacent to the key before it. The memory limits (`maxGroups`, `maxGroupKeyBytes`, `maxGroupRows`) bound the streaming runner, and `applyMapping`, which already holds the whole sheet, does not apply them.
- `contiguous: false` lets rows of a group appear anywhere. The browser transport MAY support it, since it holds the whole sheet. `runImport` MUST refuse it before reading a row: the `INVALID_PLAN` error, carrying a `PLAN_GROUP` problem whose message says "non-contiguous grouping is not supported for streaming imports; sort the sheet by the key columns" (Decision 7).

**Streaming (`runImport`)**

- A batch boundary never splits a group. The runner carries the open group across the boundary and flushes it at the next key change or at end of file.
- Peak memory becomes bounded by `batchSize` plus the largest group. A new limit `maxGroupRows` (default 10,000) fails the import with `GROUP_TOO_LARGE` rather than buffering without bound.
- `onBatch` still receives finished records only.

**Errors and counts**

- Grouped errors and warnings carry `rows: number[]`, the sheet rows the problem came from in ascending order, in addition to `row` (= `rows[0]`). A list, not a `[first, last]` range: under `contiguous: false` a group's rows need not be adjacent. See §9.
  - A problem with the record as a whole (every `RECORD_*` code) carries every row of the record.
  - A cell that could not be read (every `CELL_*` code) carries the row of its cell: `rows: [thatRow]`, and `row` is that row.
  - Identical problems in one record, meaning the same `code`, `ref` and `message`, MUST be merged into one, with `rows` the union. A parent cell that fails on each of a record's three rows is one error carrying three rows, not three errors.
- Group warnings go in `warnings`, never in `errors` (§9). A record with warnings is imported.
  - A `RECORD_GROUP_CONFLICT` warning carries `rows: [keptRow, disagreeingRow]`, ascending: the row the value was kept from, then the row that disagrees. Its message names the kept row, and `raw` is the value that lost. Rows that agree are not on it. *(Decided 2026-10-12; until then it carried every row of the record.)*
  - Each distinct conflicting value gets its own warning. Several rows carrying the same conflicting value share one, with all of them after the kept row.
  - The kept row is the first row that has a value for the field, which is not the record's first row when that row left it blank.
  - A `RECORD_GROUP_NO_KEY` warning carries the one row it is about.
- `rowsRead`, `skipped` and `failed` keep counting sheet rows; `imported` counts records. `failed` counts rows with an **error** only. The reconciliation becomes `rowsInImported + skipped + failed === rowsRead`, where `rowsInImported` is reported too.
- If any row of a group fails coercion, the whole record fails and all its rows count as `failed`.
- A cell that fails coercion is absent from the record, but it is not a cell nobody filled in. A target whose cell has a `CELL_*` error in a record MUST NOT also be reported as `RECORD_REQUIRED` in that record, grouped or not. *(Reversed on 2026-10-12. Until then this said the opposite, as 2.3 does: "a required target fed by it is reported as `RECORD_REQUIRED` as well".)* The target is matched where its value would have been: a numbered slot at the index it has after compaction, and a collected item at its index in the record. A slot or item whose only cells failed leaves no item, so nothing is required of it. Any other required target with no value is still reported.

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
- A collected array is mapped by item refs with no slot index (`items.sku`). An entry with a slot index into a collected array (`items.0.sku`) is a `PLAN_GROUP` error. To learn a collected array's item targets, `validatePlan` asks the adapter for one slot of it.
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

/** What one cell is read with, resolved by the engine (rules below). */
export interface CellOptions {
  dateOrder?: 'DMY' | 'MDY' | 'YMD';
  split?: string;
  decimal?: '.' | ',';
}

export interface SchemaAdapter<TMeta = unknown, TCtx = unknown> {
  readonly id: string;                // compared with plan.target
  readonly version?: number;          // compared with plan.schemaVersion
  readonly adapterVersion: string;    // semver of the adapter implementation
  targets(opts: { slots: Record<string, number>; lang?: string }): TargetSet<TMeta>;
  upgradeRefs?(plan: MappingPlan): { plan: MappingPlan; problems: PlanProblem[] };
  coerce?(t: ImportTarget<TMeta>, raw: unknown, ctx: TCtx, cell: CellOptions): CoerceOutcome | null;
  finalize?(record: Record<string, unknown>, ctx: TCtx): Record<string, unknown>;
  validate?(record: Record<string, unknown>, ctx: TCtx): RecordProblem[];
}
```

**Rules**

- `targets` MUST be pure and deterministic for the same inputs. `slots` maps array ref to slot count; an array absent from `slots` gets 1 slot for suggestion and 0 for apply. `applyMapping` receives no headers, so it sizes `slots` from the plan alone: per array, the highest slot the plan maps plus one (`arrayBoundOf`, per array).
- `upgradeRefs` runs once per plan, after `readPlan` and before `validatePlan`. It MUST only rewrite refs and report `PLAN_LEGACY_REF` warnings; it MUST NOT add or drop entries.
- `coerce` returning `null` means "use the generic coercer for `t.value`" (§8). A `custom` kind with no `coerce` is an adapter bug and throws at construction.
- **`cell` is what the cell is read with, and the engine resolves it once: the plan entry's option, then the run's option, then nothing, which leaves the default.** `dateOrder` is `entry.dateOrder`, else the run's `dateOrder`. `split` is `entry.split`. `decimal` is the run's. The engine MUST pass the same `cell` to `coerce` and, when `coerce` returns `null`, to the generic coercer. An adapter that reads its own cells MUST honour it, or a plan's per-column options silently do nothing on its targets. An adapter written for three arguments still fits. *(Added 2026-10-12, with Phase 2's commit 2.8. Until then `coerce` could not see a per-column option at all.)*
- `finalize` defaults to identity; `validate` defaults to the generic checks in §8. Both run after grouping and compaction.
- `RecordProblem` gains a required `code` from the row-code table in §9, and the engine copies it onto the `ImportRowError` it reports. The DE adapter maps its checks to `RECORD_REQUIRED`, `RECORD_FORMAT`, `RECORD_RANGE` and `RECORD_RULE`; a generic validator uses the same four. A `coerce` failure carries `CELL_FORMAT`, `CELL_UNKNOWN_OPTION` or `CELL_LIST_ITEM`.
- Adapters MUST NOT read files, mutate the plan, or hold per-run state outside `TCtx`.

**Adapters in scope**

| Adapter | `meta` | Notes |
| --- | --- | --- |
| `entityFormConfigAdapter(config, { rules, lookups, includeReadonly?, includeSystemDefault? })` | `NestedFieldConfig` | `TCtx` is `{ lang?, decimal?, dateOrder?, stamp? }`. `coerce` reads with `cell` first and falls back to the context's `decimal` and `dateOrder`, which is where Dynamic Entity 2.5.0 states them, so a v2 plan's per-column `dateOrder` works on DE fields. Every target's kind is `custom`, since only `coerceCell` reads a DE cell. Both `include` options default to `true`, which applying a stored plan needs; a template or suggestion passes `false`, as 2.x's wizard does. Target refs come from `collectFieldRefs`, never `refOf` or `getTabData`, so moved tab-level containers land at their override. `validate` evaluates rules once against the whole config through `flattenFieldValues`, with 2.3's precedence. `upgradeRefs` = `upgradeLegacyRefs`. `positional: false` on every array. `coerce` = `coerceCell` with `decimal`. MUST be behaviour-identical to 2.3; the hardened parity suite (§10) is the gate. |
| `jsonSchemaAdapter(schema, { id?, version?, validator? })` | JSON Schema node | The root MUST be an object with `properties`, or `type: array` whose `items` (after `$ref` resolution) is one: a list of records, whose items are the record. The list itself is not a target. Any other root throws at construction. Local `$ref`, `allOf`, first non-null `oneOf`/`anyOf`; a `oneOf` of `const`s is a labelled enum. `enum` stores the raw value. An array of objects is numbered slots (`positional: true`), and an array of primitives is one split `list`. A field is `required` only when every object above it is (per item inside an array). `validator` is a function `(record) => RecordProblem[]` replacing the generic checks, so an Ajv-compiled schema can be wrapped in one and Ajv is never a dependency. A list inside a list, a free-form object, an untyped node and an unresolvable or looping `$ref` are reported in `unsupported`. |
| `exampleJsonAdapter(sample, { id?, version?, validator? })` | `{ sample }`, the first value seen | `sample` is one record or an array of them, merged. Kinds inferred from values: a number is `number` (never `integer`, since one sample is not a bound), a string shaped like an ISO date, date-time or time is that kind, and any other is `string`. Where samples disagree the field is `string`, and a `null` gives way to any value. An array of objects is numbered slots, with every key any item has; its longest sample length is the fewest slots `targets` returns, whatever `slots` asks. An array of primitives is one split `list`. Nothing is `required`. `positional: true`. A field only ever `null`, an empty object or array, a list inside a list, mixed array items, and an object in one sample but a value in another are reported in `unsupported`. |

## Engine API and coercion

The engine is 2.3's algorithm with `config` replaced by `adapter` and grouping added. Rows are already `unknown[][]` end to end in 2.3 (`SheetGrid`), so typed cells need no new work. The decimal mark becomes an engine option on both sides, closing 2.3's gap where only the server could override it.

```typescript
export function readPlan(input: unknown, opts?: { allowUnknownKeys?: boolean }): { plan?: MappingPlan; problems: PlanProblem[] };
export function validatePlan<M, C>(plan: MappingPlan, adapter: SchemaAdapter<M, C>): PlanProblem[];
export function slotsFor<M, C>(headers: readonly string[], adapter: SchemaAdapter<M, C>, plan?: MappingPlan, opts?: { lang?: string }): Record<string, number>;
export function suggestMapping<M, C>(headers: readonly string[], adapter: SchemaAdapter<M, C>, opts?: { lang?: string; sample?: readonly (readonly unknown[])[] }): MappingPlan;
export function applyMapping<M, C>(
  rows: readonly (readonly unknown[])[],
  plan: MappingPlan,
  adapter: SchemaAdapter<M, C>,
  ctx: C,
  opts?: { firstRowNumber?: number; decimal?: '.' | ','; dateOrder?: 'DMY' | 'MDY' | 'YMD' },
): ImportResult;
export function coerceValue(kind: ValueKind, raw: unknown, opts?: { decimal?: '.' | ','; split?: string; dateOrder?: 'DMY' | 'MDY' | 'YMD' }): CoerceOutcome;
```

`suggestMapping` derives `slots` from the headers (§6), then returns a v2 plan. **Without `sample` it MUST suggest exactly what 2.3 does.** With `sample` (data rows of the sheet; a preview's first few are enough) it also reads what only the data shows, and every such suggestion is `confidence: 'guess'`:

- **One item per row.** An array of objects that no header numbers is offered one item per row. Its children are matched by their own names, by the array's name before them (`Item SKU`), by the generated heading without its number, and by shape ref, and are mapped by shape ref (`items.sku`). An array with at least one child mapped this way is proposed in `group.collect`. An array any header numbers stays numbered columns.
- **The group key.** `group.key` is one column: the first, in sheet order, that is mapped to a target outside any array, has an id-like name (one of the words `id`, `no`, `number`, `code`, `key`, `ref`), and whose non-blank sample values repeat. With no such column no group is proposed, and each one-per-row child is mapped to slot 0 instead (`items.0.sku`): one record per row, with one item.
- **Words.** A header still unmapped is matched by its words (`Product` for `productName`, `First Name` for `name.first`): all of the header's words among the words of a target's `matchKeys` or of its shape ref, or the reverse. Only when exactly one free target fits the header and exactly one free header fits that target. A numbered slot is never matched this way.
- **Date order,** as given under "Generic coercion" below.

No sample means no group, no item refs and no `dateOrder`. `applyMapping` calls `readPlan` and `validatePlan` itself; callers MAY call them earlier to fail fast. `firstRowNumber` defaults to 2, because the header is sheet row 1.

**Generic coercion** (`coerceValue`), lifted from today's `coerceCell` and `coerceTypedCell`. `null`, `undefined` and blank text are always "no value".

- A typed cell the kind does not take is read as its `cellText`, never `String()`. A `Date` given to a `number` is `"2024-03-07"`, a `CELL_FORMAT` error.
- `integer` applies to text and typed input alike.
- `opts.split` carries the entry's `split`, which beats the kind's `separator` (§6).
- `opts.dateOrder` carries the entry's `dateOrder`. **A date written in digits MUST NOT be guessed** (`05/09/2026` is 5 September or 9 May):
  - a four-digit first part is the year, whatever `dateOrder` says: `2026-09-05`, `2026/9/5`;
  - otherwise the year is the last part and MUST be four digits, so no century is guessed;
  - with `dateOrder`, the first two parts are read in that order;
  - without it, a first part over 12 makes the date day first and a second part over 12 makes it month first. When both are 12 or less, the cell is a `CELL_FORMAT` error whose message says to set the column's date order;
  - a date that does not exist in the order used (`31/09/2026`) is `CELL_FORMAT`.

  This applies to `date`, to `month`, to the date part of a `datetime` that is not year first, and to each item of a `list` of them. A typed `Date` cell has no order and is unaffected. Text with a month's name (`March 7, 2024`) is still parsed. Other text made only of digits and marks (`05/09`, `5/9/26`) is `CELL_FORMAT`.
- `suggestMapping`, given `sample` rows, sets `dateOrder` on each entry whose target holds a date, from that column's sample cells: any four-digit first part is `YMD`, any first part over 12 is `DMY`, any second part over 12 is `MDY`. When the sample shows no evidence, or evidence for two orders, `dateOrder` is left unset. Only text is evidence. Without `sample`, no `dateOrder` is set.
- A `custom` kind reaching `coerceValue` throws, because only the adapter can read it.

| Kind | Text input | Typed input |
| --- | --- | --- |
| `string` | Trimmed | Rendered with `cellText` (midnight-UTC `Date` → `YYYY-MM-DD`, else ISO) |
| `number` | `NUMERIC` shape. Decimal `.`: commas are grouping and stripped. Decimal `,` (default when the delimiter is `;`): `1,5` → 1.5, `1.234,5` → 1234.5, `1,500` → 1.5, point-decimal rejected. `integer` rejects fractions | Number as-is |
| `boolean` | `true t yes y 1` / `false f no n 0`, case-insensitive | Boolean as-is |
| `date` | Digits read textually in the stated order (above; no TZ shift, rejects 2024-02-30), a month's name parsed → `YYYY-MM-DD` | `Date` by UTC parts |
| `datetime` | Parsed → ISO string. A day-first or month-first date part is read in the stated order, as local time | `Date` → ISO |
| `time` | `H:mm[:ss]` or UTC instant → `HH:mm` | `Date` UTC hours and minutes |
| `month` | `YYYY-M(M)` or any calendar date, read as `date` is → `YYYY-MM` | `Date` UTC year and month |
| `enum` | Case-insensitive match against `values` (as text) and `labels`; stores the matching value. No match is `CELL_UNKNOWN_OPTION` | Matched by `cellText` form; no match is `CELL_UNKNOWN_OPTION` |
| `list` | Split per §6, each part via `of` | One-item list |

**Generic validation** (when the adapter has no `validate`): `required` (absent, or an empty list), `number` min/max, `string` min/max length, `pattern`, `format`, `list` min/max items. `pattern` runs on input bounded by `maxCellLength`, as today. Array items are validated per existing item; an empty optional array passes.

`format: 'email'` MUST be judged by the rule `ajv-formats` applies to the `email` format (version 3, its default "full" mode): a dot-separated local part and a domain of at least two labels. So the generic checks and a JSON Schema validator given the same schema agree, and `rahul.k@example` is refused by both. The DE adapter does not use the generic checks: its `validate` keeps DE's rule, which follows Angular's `Validators.email` and accepts that address, because the form does.

## Results, errors and versions

The result types change by additive, optional fields only, and no existing field changes type. Two kinds of code depend on the shapes and both must still compile: code that reads a 2.x result, and code that *builds* one. `ImportTransport.commit` returns an `ImportResult`, so every custom transport builds one.

```typescript
export interface ImportRowError {
  row: number;                 // rows[0]: the first sheet row of the record, or the row of the cell
  rows?: number[];             // v2, grouped records: the sheet rows the problem came from, ascending (§5)
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

- [ ] A stored v1 plan from each fixture in server/src/`all-configs.spec.ts` reads without errors and normalises to `planVersion: 2`. *(Those plans are built by DE code, which the importer may not import, so this test lands with the DE adapter. The importer's own tests read representative 2.3-shaped plans.)*
- [ ] `entity` + `target` with different values → `error`; same values → `warning`.
- [ ] On a v2 plan, an unknown top-level key or an unknown entry key → `error`, no plan returned. `planVersion: 3` → `error`, no plan returned.
- [ ] A v1 plan carrying `id`, `name` and `createdAt` → reads, with one `PLAN_UNKNOWN_KEY` warning per key, and the keys are dropped from the returned plan. An unknown *entry* key on a v1 plan → `error`.
- [ ] A plan without `planVersion` carrying `group` → `error`.
- [ ] `split` on a non-list target, `compact` on a `collect` array, `collect` on a non-array ref → `error`.
- [ ] `__proto__`, `constructor` and similar in any ref position → `error`.

**Grouping**

- [ ] 7 order rows with 4 distinct contiguous keys → 4 records; line items preserved in sheet order.
- [ ] Parent-field disagreement → one `RECORD_GROUP_CONFLICT` entry in `warnings` (none in `errors`) per distinct conflicting value, with `rows: [keptRow, disagreeingRow]`. The first row's value is kept, the record is imported, and `failed` is 0.
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

- [ ] `entityFormConfigAdapter`: the full existing core and server suites pass unchanged against the generic engine, except for the additive `code` and `warnings` fields, and for one removal: the second, `required` report of a field whose cell could not be read (§5, reversed on 2026-10-12). A test that compared a whole error object may add the code, a test that expected that second report may drop it, and nothing else (Phase 2 gate).
- [ ] `jsonSchemaAdapter` on the prototype's order schema and sheet (`test/fixtures/order`, held by `src/acceptance.spec.ts`). *(Reworded by the owner on 2026-10-12; it read "produces the same records as the prototype's sample run", which a failed record cannot meet: the prototype keeps one with the bad value left raw, and the engine returns none.)*
  - `suggestMapping`, from the headers and the sheet's rows, reproduces `run.json`'s bindings, list modes and group key.
  - Every record with no errors equals `expected-output.json` exactly.
  - Every failed record is compared with `run.json` by its problems: the code its issue maps to, the path, and the rows. Not by output.
- [ ] `exampleJsonAdapter` on the student example (`test/fixtures/student`) infers a split `clubs` list and one guardian slot from the example, and fills 2 guardian slots from the sheet's numbered headers. The same three checks as the order fixture hold on it in `src/acceptance.spec.ts`, once the plan states `dateOrder: 'DMY'` for the one date column the sheet leaves ambiguous.
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
| 1 | Package name and scope | A new standalone name, not under `@dynamic-entity`: **`sheet-to-schema`**. *(Named by the owner on 2026-10-11, and confirmed on 2026-10-12.)* It is **one package**, with a browser-safe main entry and a `/node` subpath. *(Decided 2026-10-12, replacing the five `@sheet-to-schema/*` packages named on 2026-10-11: the DE adapter has to live in `@dynamic-entity/core`, and there is no generic Angular code yet.)* The Phase 4 Angular mapper will be a separate package. Nothing is published to npm, and no tag is created, until the owner says so. |
| 2 | Re-exports from `@dynamic-entity/core` | Keep deprecated re-exports of moved functions through 3.x; remove in 4.0. |
| 3 | Legacy-ref alias | Keep `upgradeLegacyRefs` behind the DE adapter's `upgradeRefs` through 3.x, with its warning; remove in 4.0. Correct the 2.3 changelog note that announced removal in 3.0. *(Correction shipped in DE 2.4.0.)* |
| 4 | Problem codes in DE | Add an optional `code` to `ConfigProblem`, same `{ level, code, path, message }` shape. DE owns `CONFIG_*`; the importer owns `PLAN_*` and `RECORD_*`. Additive, so it ships in **DE 2.4**, before any extraction. *(Shipped in DE 2.4.0; see `docs/de-2.4-problem-codes.md`.)* |
| 5 | Positional arrays in DE | DE stays compact-only (`positional: false`). No renderer null-slot work in 3.x unless a user asks. Generic adapters are positional from day one. |
| 6 | Group key comparison | Exact after trimming, no option in v2. A match option may be added later, additively. |
| 7 | Non-contiguous grouping on the server | Refused with `PLAN_GROUP`, and the message says to sort by the key columns. The browser path supports it. |
| 8 | Header row | *Revised by the owner on 2026-10-10:* "Cut from v2. The header is always sheet row 1. Choosing another row needs reader, SheetParser and preview changes and comes in a later version, with the Phase 4 header-row hint." The specification is kept in the appendix **Deferred: header row**. |
| 9 | Dual write of moved containers | Kept in 3.0. Storing once is a separate later release using DE's migration system, not part of the extraction. |
| 10 | Where plan checks run | `readPlan` makes every check that needs no adapter: shape, version, aliases, unknown keys, unsafe paths, `PLAN_SOURCE`, `PLAN_DUPLICATE_REF`, and the structure of `group`, `lists` and `split` (including `compact` on a collected array). `validatePlan` makes only those that need targets: `PLAN_UNKNOWN_REF`, `PLAN_SPLIT_TARGET`, a `lists` key or `collect` entry that is not one of the adapter's arrays, positional support, and `PLAN_TARGET_MISMATCH`. *(2026-10-10)* |
| 11 | A plan with no target | Neither `target` nor `entity` present is a `PLAN_SHAPE` error: such a plan cannot be checked against any adapter. *(2026-10-10)* |
| 12 | Malformed values of known fields | A wrongly typed value gets its feature's code where one exists: `PLAN_LIST_OPTION` inside `lists`, `PLAN_GROUP` inside `group`. Anything else is `PLAN_SHAPE`: `target`, `schemaVersion`, `sourceHeaders`, `header`, `confidence`, a `split` that is not 1 to 8 characters, and a `dateOrder` that is not `DMY`, `MDY` or `YMD`. *(2026-10-10; `dateOrder` added 2026-10-12)* |
| 13 | v1 names on a v2 plan | `entity` and `configVersion` are known aliases on both versions, so rule 2 applies to every plan. On a v1 plan the old name alone is normal; an agreeing pair is `PLAN_ALIAS_USED`. On a v2 plan any old name is `PLAN_ALIAS_USED`, because v2 writers emit v2 names only. *(2026-10-10)* |
| 14 | Dates written in digits | Never guessed. `MappingEntry.dateOrder` (`DMY`, `MDY`, `YMD`) states the order; without it a date that reads two ways is `CELL_FORMAT`. `suggestMapping` infers it from sample rows, and sets nothing when they do not show it. Dynamic Entity's own month-first reading was fixed in DE 2.5.0, with an options-level `dateOrder`; see `docs/de-date-order-issue.md`. *(2026-10-12)* |
| 15 | Generic email rule | `format: 'email'` is judged by ajv-formats' rule. The DE adapter keeps DE's, which follows Angular's. *(2026-10-12)* |
| 16 | A record's problems | Reported once each: a `CELL_*` error carries the row of its cell, identical problems are merged with their rows, and a target with a `CELL_*` error is not also `RECORD_REQUIRED`. This reverses the 2.3 double report, and is the one removal the Phase 2 gate allows. *(2026-10-12)* |
| 17 | Rows on a group conflict warning | `[keptRow, disagreeingRow]`, ascending, one warning per distinct conflicting value. *(2026-10-12)* |
| 18 | What a sample adds to suggestion | With sample rows: item-level refs and `group.collect` for an array no header numbers, a `group.key` from an id-like column whose values repeat, and `dateOrder`. All `guess`. Without a sample the suggestion is 2.3's. *(2026-10-12)* |

**Still open**

Nothing. The one open question, the package name, is closed:

- [x] **The package name:** `sheet-to-schema` (Decision 1). On 2026-10-11 the name returned 404 from the npm registry, as did the spellings npm treats as the same name (`sheettoschema`, `sheet_to_schema`, `sheet.to.schema`).

**Before anything is published** (not a question for this spec, recorded so it is not lost): the name `sheet-to-schema` is not reserved until the owner publishes under it. The package is unscoped (Decision 1), so no npm organisation is needed for it. The Phase 4 mapper's name is not chosen.

**Later** (not v2, recorded so they are not lost)

- Case-insensitive group key option.
- External sort for non-contiguous grouping on the server.
- Renderer null-slot contract, so DE can be positional.
- Store moved containers once, with a record migration.
- A chosen header row, with the header-row hint in the mapper (Phase 4). Specified in the appendix **Deferred: header row**.
- An adapter-supplied noun for problem messages ("config" against "schema"). The plan checks say "schema" for every adapter, so a Dynamic Entity user now reads "this schema is \"e\"" where 2.x said "the config is \"e\"". Codes and paths are unaffected.

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

**2026-10-10: decisions from implementing `readPlan`.** Phase 1 started with the plan types and `readPlan` (`packages/sheet-importer`, placeholder name `sheet-importer-placeholder`). Four points §3 and §4 left open were decided, and are added as Decisions 10–13:
- where each check runs;
- a plan with no target;
- the code for a malformed value;
- v1 names on a v2 plan.

Three errata were fixed:
- the `GroupSpec.key` comment still said "values joined", against §5's tuple rule;
- §4's `readPlan` signature now matches §8's optional `plan`;
- the stored-v1-plans acceptance item is marked as landing with the DE adapter, which is the only place the plans can be built without the importer importing DE.

**2026-10-10: the adapter contracts and `validatePlan`.** Implemented as §7 gives them, with `CoerceOutcome` and `RecordProblem` each carrying their code.
- **Collected arrays:** one rule §6's layout table implied is now stated in §6. A collected array is mapped without slot indices, and a slot index into one is `PLAN_GROUP`.
- **Still open:** the "a `custom` kind without `coerce` throws at construction" criterion belongs to adapter construction, so it lands with the adapters themselves.

**2026-10-10: `coerceValue`.** Three readings of §8 that the coercer depends on are now stated under "Generic coercion":
- a typed cell the kind does not take is read through `cellText`;
- `integer` applies to typed input too;
- `opts.split` carries the entry's separator, so `coerceValue`'s signature gains `split`.

A `custom` kind reaching `coerceValue` throws (§7).

**2026-10-10: `applyMapping` and grouping.** Three points §5 left open for the in-memory engine are now stated there: a contiguity failure is thrown as an `ImportFailure` (`GROUP_NOT_CONTIGUOUS`), which the server maps onto 422; a blank-key row closes the open run; the memory limits are the streaming runner's. Two rules are also stated: a blank first-row parent field is filled from a later row, and 2.3's double report of a failed required cell (`CELL_*` and `RECORD_REQUIRED`) is kept.

**2026-10-10: `suggestMapping` and `slotsFor`.** The 2.3 header grammar moved unchanged, keyed by `ImportTarget`: a target's `matchKeys` stand where 2.3 used the field's label and id, both for loose matching and for the child names of slot patterns. Both functions take an optional `{ lang }`, passed to `targets()`, and §8's signatures now say so.

**2026-10-10: `jsonSchemaAdapter`, and a suggestion defect.**
- **The adapter's choices** are now stated in §7's adapter table:
  - primitive arrays are split lists;
  - a field is required only when its whole chain of parent objects is;
  - `validator` is a function, not an Ajv dependency;
  - what goes to `unsupported`.
- **Still open:** the acceptance item wants "the order schema from the prototype" and its sample run. Neither is in this repository, so the item waits for them.
- **A defect fixed in the importer, still live in DE 2.4.0.** `suggestMapping`'s exact pass compared refs after normalising them. Whenever an array's label equals its id, that read "Phones 1 Number" as the ref `phones.1.number`, the second slot, and marked it `exact`. The importer now matches a ref only as written. DE 2.4.0 still has the defect.

**2026-10-10: `exampleJsonAdapter`.**
- **Its choices** are now stated in §7's adapter table. Three are judgement calls:
  - a field only ever `null` goes to `unsupported` rather than becoming `string`, as `jsonSchemaAdapter` does for an untyped node;
  - "array lengths seed `slots`" is read as a floor: `targets` returns at least the sample's length, and more when `slots` asks, so suggestion still offers `DEFAULT_SLOTS`;
  - the sample may be an array of records, merged, since an export is usually a list.
- **The student example** is in `example-json-adapter.spec.ts` and passes its acceptance item.
- **The suggestion defect** noted above is fixed in DE 2.4.1. Every DE release with `suggestMapping`, 1.14.0 through 2.4.0, had it.

**2026-10-11: `entityFormConfigAdapter`.** Written in `packages/core/src/entity-form-config-adapter.ts`, over the functions 2.x's engine already uses.
- **How core reaches the importer.** The importer is still private and unnamed, so nothing core publishes may name it:
  - the placeholder is a `devDependency` of core, which `check-build-graph.mjs` requires of any sibling import. Core's published manifest is a whitelist written by `build-manifest.mjs`, with no `devDependencies`;
  - core's `tsconfig.json` (`paths`) and `jest.config.js` (`moduleNameMapper`) resolve the placeholder name to the importer's source, so core's lint and tests do not need the importer built;
  - the adapter is not exported from core's `index.ts`, so tsup never bundles it. Core's `dist` and published manifest were checked and carry nothing of the importer.
  - Phase 2 replaces all three with a real dependency under the chosen name, and exports the adapter.
- **Two internal changes to `import-engine.ts`,** with the public output unchanged (core's 1053 existing tests pass untouched):
  - `recordShaper(config)` is the compaction, array-structure and tab-placement step, taken out of `applyMapping` so the adapter's `finalize` calls the same code;
  - `validateImportedRecordCoded` returns each problem with its `RECORD_*` code. `validateImportedRecord` drops the code, so 2.x row errors still carry none.
- **Three gaps in §7 the adapter had to settle:**
  - `decimal` and `lang` reach `coerce` and `validate` through `TCtx`. The engine's own `decimal` option is passed only to the generic coercer, so an adapter with its own `coerce` never sees it.
  - `targets` has one mode, but 2.x derives columns two ways: with `readonly` and `systemDefault` fields to apply a plan, without them for a template. The two `include` options carry that.
  - A cell's code comes from the field's type: a `dropdown`, `radio` or `multiSelect` cell that cannot be read is `CELL_UNKNOWN_OPTION`, unless the cell was an invalid date; anything else is `CELL_FORMAT`.
- **Tested for parity** in `entity-form-config-adapter.spec.ts`: the same rows and stored v1 plan through 2.x's `applyMapping` and through the generic engine give the same records, errors (but for the added `code`) and skips. Covered: all seven configs in `test_data.json`, as text and as typed cells; moved arrays and groups with 2.2 refs; rules; lookups; constants; the decimal comma. Three acceptance items pass there: stored v1 plans, the DE half of `compact: false`, and per-array `slotsFor`.
- **Still Phase 2:** the gate itself. 2.x's `applyMapping`, the server and the wizard still run the old engine; swapping them onto the adapter, with the full core and server suites as the test, is the extraction.

**2026-10-11: the package is named `sheet-to-schema`.** Decision 1 and the open item are updated. The workspace package was renamed from `sheet-importer-placeholder`, in its manifest, core's `devDependencies`, and core's `tsconfig.json` and `jest.config.js` mappings. Earlier entries in this log keep the placeholder name they were written with.
- **The folder moved too,** from `packages/sheet-importer` to `packages/sheet-to-schema`, on the owner's word the same day. Earlier entries keep the old path.
- **Unchanged:** it stays `private: true`. Publishing is Phase 2.

**2026-10-12: the prototype's fixtures.** The prototype the acceptance items name was never in this repository. The owner supplied it on 2026-10-11, and it is now committed under `packages/sheet-to-schema/test/fixtures/`:
- **`order/`:** `schema.json`, `sample.csv`, `expected-output.json`, `run.json`, the prototype itself (`schema-mapper.html`) and a README saying where each came from. Before the commit, the prototype's code was run again headlessly and reproduced the output and the run exactly.
- **`student/`:** the prototype's own example-JSON sample, built the same way: `example.json`, `sample.csv`, `expected-output.json`, `run.json` and a README.
- **Not published:** the package's `files` is now `dist` only, so nothing under `test/` can ship. `npm pack --dry-run` lists `dist` and `package.json`.
- **`exampleJsonAdapter`'s spec reads the student fixture,** in place of the student record written for the first version of that spec. The acceptance item is reworded to what the fixture shows: the example has one guardian, and the second slot comes from the sheet's `Guardian 2 …` headers.
- **Found by running the engine on the order fixture,** and decided by the owner the same day. Each lands in its own commit, with its own entry below:
  1. slash dates were read month-first, silently;
  2. the generic email check accepted `rahul.k@example`;
  3. `jsonSchemaAdapter` refused a schema whose root is an array of records;
  4. `suggestMapping` did not map one-item-per-row columns or propose a group;
  5. a grouped record's cell errors were repeated per row and carried every row of the group.

**2026-10-12: dates written in digits are never guessed (owner's decision 1).** On the order fixture, `05/09/2026` imported as 9 May with no error: the generic `date` coercer, lifted from DE's, handed anything not ISO to `Date`, which reads month first.
- **`MappingEntry.dateOrder`** (`DMY`, `MDY`, `YMD`) is a new v2-only field: `PLAN_VERSION` on a plan without `planVersion`, `PLAN_SHAPE` for any other value. It is added to §3's interface and field table, to rule 4, and to the list of v2-only features a client checks against a server.
- **§8 states the reading rule** under "Generic coercion", and `coerceValue` gains `dateOrder`.
- **`suggestMapping` gains `sample`** and infers `dateOrder` per date column from it. With no evidence in the sample it sets nothing, so ambiguous cells are refused at import: the student fixture's `01/06/2026` and `02/06/2026` show no order, and a plan for that sheet has to state `DMY`.
- **Three readings the decision left open:**
  - a two-digit year (`5/9/26`) is refused, since choosing a century is a guess of the same kind;
  - the rule is applied to `month` and to the date part of a `datetime`, which went through `Date` the same way;
  - `dateOrder` on a target that holds no date is ignored. No code exists for it, and none was added.
- **Dynamic Entity is unchanged.** The DE adapter reads cells with `coerceCell`, which still reads `05/09/2026` month first, in every release from 1.14.0 to 2.4.1. That is written up, with a proposed fix, in `docs/de-date-order-issue.md`.

**2026-10-12: the generic email rule is ajv-formats' (owner's decision 2).** The generic checks had DE's email pattern, which follows Angular's `Validators.email` and needs no dot in the domain. On the order fixture that passed `rahul.k@example`, which the prototype and Ajv both refuse. §8 now states the rule under "Generic validation".
- **The pattern is copied,** not imported, so the package still has no runtime dependency. A check at the time of writing found it identical to `fullFormats.email` in ajv-formats 3.0.1.
- **Dynamic Entity is unchanged.** A test in core's adapter spec holds both sides: `rahul.k@example` passes through the DE adapter, as it does in 2.x, and fails the generic checks.

**2026-10-12: `jsonSchemaAdapter` takes a list of records (owner's decision 3, a Phase 1 requirement).** The prototype's order schema is written as the file it describes: `type: array`, with `items` a `$ref` to the order. The adapter refused it, wanting an object at the root. It now reads the items as the record, and §7's table says so. `required` is taken from the record; the list around it adds nothing. A root list of anything else (strings, lists, nothing) still throws.

**2026-10-12: problems of a record are reported once each (owner's decision 5, a Phase 1 requirement).** On the order fixture, a grouped record's errors were hard to act on: a bad date on both rows of an order was two errors, each claiming both rows, and a quantity of `one` on row 6 was reported against rows 5 and 6 and then again as a missing required value.
- **§5, "Errors and counts", now states three rules:** a `CELL_*` error carries the row of its own cell; identical problems in one record are merged, with their rows unioned; and a target with a `CELL_*` error is not also `RECORD_REQUIRED`.
- **The third rule reverses what this spec said.** The entry of 2026-10-10 on `applyMapping` kept "2.3's double report of a failed required cell". It applies to every record, grouped or not, so it is a difference from Dynamic Entity 2.x:
  - the Phase 2 gate's acceptance item now allows that one removal, besides the additive fields;
  - core's adapter parity spec states it, and takes exactly those second reports out of 2.x's errors before comparing.
- **Not changed, and left for the owner:** a group warning (`RECORD_GROUP_CONFLICT`) still carries every row of the record. The prototype's own warning names only the row that disagreed.

**2026-10-12: `suggestMapping` reads a sample (owner's decision 4, a Phase 1 requirement).** On the order fixture the suggestion left `SKU`, `Product`, `Qty` and `Unit Price` unmapped and proposed no group: every slot of `items` answered to `SKU`, so the ambiguity guard matched none, and nothing in the headers says rows repeat. §8 now states what a sample adds.
- **As decided:** an object array with no numbered headers gets item-level refs and goes in `group.collect`; `group.key` comes from an id-like column outside any array whose values repeat; all of it is `guess`; no sample, no group.
- **Three things the decision did not settle,** chosen here and open to the owner:
  - **Matching by words.** `Product` does not normalise to `productName`, so the prototype's own binding could not be reproduced by the 2.3 grammar. A third pass matches a leftover header by its words, when one target and one header fit each other. It runs only with a sample, so the rule "without a sample, exactly 2.3" holds. The prototype goes further, with a similarity score; that was not copied.
  - **No key found.** Item refs are only valid inside a group, so with nothing to group under they are written to slot 0.
  - **Several candidates for the key:** the first in sheet order.
- **Both fixtures now reproduce the prototype's bindings and group key** from headers and sample rows alone. The order sheet's date column gets `dateOrder: 'DMY'` from its `31/09/2026`. The student sheet's dates show no order, so its suggested plan refuses them until `DMY` is set by hand.

**2026-10-12: the acceptance test.** `packages/sheet-to-schema/src/acceptance.spec.ts` holds the engine to the prototype's run on both fixtures, as the owner reworded the item: the suggestion reproduces the bindings, list modes and group key; clean records equal the prototype's exactly; failed records are compared by code, path and rows.
- **The order fixture passes as it stands.** One record is clean (NF-1001) and three fail, with the five problems the prototype found, on the same rows.
- **The student fixture passes once the plan says the dates are day first.** Its two dates read both ways, so the suggestion sets no `dateOrder` and the import refuses them, as §8 requires; the test asserts that too. The prototype assumed day first.
- **The prototype's messages are mapped to codes in the test** (`CODE_OF`), since it has no codes: its email and pattern failures are `RECORD_FORMAT`, its number and date failures `CELL_FORMAT`, an unknown option `CELL_UNKNOWN_OPTION`.
- **One comparison is looser than the item asks, and is the owner's to settle.** A group warning is compared by code and path only. The prototype puts the row that disagreed on it (`[8]`); the engine puts every row of the record (`[7, 8]`), which §5 has said since before this change. The test asserts both facts, so either choice will show up there.

**2026-10-12: a group conflict warning names two rows (owner's decision).** A `RECORD_GROUP_CONFLICT` warning carried every row of its record, which on a long group does not say where to look. It now carries the row the value was kept from and the row that disagrees, in that order, and its message names the kept row. Each distinct conflicting value gets its own warning. §5 states this under rule 2 and under "Errors and counts".
- **One reading the decision left open:** several rows carrying the *same* conflicting value share one warning, with all of those rows after the kept one, on the same principle as the merging of identical problems.
- **The acceptance test now compares warnings by rows too.** The two notes above that called this comparison looser, and left it to the owner, are settled by this entry. The prototype's warning names only the row that disagreed; the kept row before it is the record's first row in both fixtures.

**2026-10-12: the package name is closed, and the day's decisions are in the table.**
- **Decision 1.** Confirmed as `sheet-to-schema`. The decision now also records what the owner set on 2026-10-11 for Phase 2: packages under the `@sheet-to-schema` scope, all private, nothing published. "Still open" holds nothing. One thing is noted there for before any publish: the `@sheet-to-schema` organisation on npm, which could not be checked from here.
- **Decisions 14 to 18** record the owner's decisions of 2026-10-12, where they are binding. Their detail is in the sections and entries above.
- **The owner's `order-fixture/` folder** at the repository root, the source of `test/fixtures/order`, was deleted after `diff -r` showed its five data files identical to the committed copies. Only the README differed, by the two renamed file names and the section added on commit.

**2026-10-12: Phase 2 begins, with Dynamic Entity 2.5.0 (step 0).** The owner's order of work for Phase 2 starts with DE's own date-order fix, ahead of any move.
- **DE 2.5.0** no longer reads a date such as `05/09/2026` month first. It is an error unless the import states `dateOrder`, on `ApplyMappingOptions`, `RunImportOptions`, the router's options, or `ImportContext`. `MappingPlan` is unchanged in 2.x. The detail is in `docs/de-date-order-issue.md` and the changelog.
- **Decision 14's last sentence is out of date.** It said DE's month-first reading was unchanged and tracked in that note. It is now fixed in 2.5.0.
- **The DE adapter's context gains `dateOrder`,** `{ lang?, decimal?, dateOrder?, stamp? }`, and passes it to `coerceCell`, so the adapter stays at parity with `applyMapping`. A v2 entry's own `dateOrder` still has no effect on a DE target, whose kind is `custom`: connecting the two is part of the moves.

**2026-10-12: the Phase 2 plan is approved.** `docs/phase2-plan.md` holds the plan and the owner's decisions on it. Those that change this spec:
- **Decision 1** is one package with a `/node` subpath, not five scoped packages.
- **Package boundaries.** `@dynamic-entity/core` takes a real dependency on `sheet-to-schema`, exact for release candidates and `^1.0.0` at 3.0.0 final. `exceljs` and `busboy` are optional peers of `sheet-to-schema` and normal dependencies of `@dynamic-entity/server`.
- **§7 will change in Phase 2's commit 2.8:** `coerce` gains an optional fourth argument, `{ dateOrder?, split?, decimal? }`, resolved by the engine as plan entry, then run options, then default.
- **§5's streaming runner is Phase 3.** Until then `runImport` refuses a plan with `group` before reading a row, and a 3.0 server still advertises `planVersions: [1, 2]`.
- **DE's `MappingPlan` becomes the v2 type in 3.0,** with the 2.x shape exported as the deprecated `MappingPlanV1`.

**2026-10-12: `coerce` sees what a cell is read with (Phase 2, commit 2.8; plan decision 4).** §7's interface gains `CellOptions` and a fourth `coerce` argument, with the rule that the engine resolves it as plan entry, then run option, then default, and hands the same value to the adapter and to the generic coercer.
- **`applyMapping` gains a run-level `dateOrder`** (§8's signature), the default for every entry that states none. `runImport` and the generic router take the same option, and a preview reports the router's, as Dynamic Entity 2.5.0's does.
- **The DE adapter honours it.** It reads with `cell` and falls back to its context. So a v2 plan can state a different order for each date column of a DE config, and 2.5.0's options-level `dateOrder` keeps working as the default. This closes the gap the entry of the same date on step 0 left open.
- **The decision's three precedence levels, as built:** an entry's `dateOrder` beats the run's, the run's beats nothing, and with nothing a date that reads two ways is refused. `split` exists only on an entry, and `decimal` only on the run, so each has one source.

**2026-10-12: Dynamic Entity's engine is this one (Phase 2, commit 3.1).** `@dynamic-entity/core`'s `applyMapping`, `suggestMapping` and `validateMappingPlan` now run the engine, the suggester and the plan checks specified here, over `entityFormConfigAdapter`. What that settled, none of it changing a rule above:

- **A plan problem is reported at the name the plan used.** A 2.x plan whose `entity` does not match is reported at `entity`, and one whose `configVersion` is behind at `configVersion`, not at `target` and `schemaVersion`. The reader upgrades the plan before it is checked, so `preparePlan` maps the two paths back. A v2 plan is reported at the v2 names.
- **A reserved-key ref is `PLAN_UNSAFE_PATH`** for a Dynamic Entity plan too, where 2.x called it an unknown ref. The importer's thirteen plan codes are Dynamic Entity's list now; the six 2.x emitted keep their meaning.
- **"No target named" stays an error for plan v2.** A 2.x plan that names no entity is read against the config in hand, as 2.x read it, by the DE wrapper and not by the reader. The one v2 plan let through is `target: ''`, which DE's own two-argument `suggestMapping` writes.
- **Later list:** an adapter-supplied noun for problem messages.
