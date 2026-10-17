# Migrating to Dynamic Entity 3.0

3.0 moves the spreadsheet-import engine out of Dynamic Entity into its own package,
[`sheet-to-schema`](https://github.com/berserker5619/sheet-to-schema#readme), and runs Dynamic Entity on top of
it. Forms, rules, the builder and the renderer are untouched. **If your app does not use the
import wizard or `@dynamic-entity/server`, upgrading is a version bump.**

If it does, the same files import to the same records: that is tested against what the
published 2.5.0 produced. What changes is the shape of a mapping plan, the text of some
messages, and where a few functions are imported from.

## Before you start

Upgrade to **2.5.0** first if you are on anything older. It changed how a date such as
`05/09/2026` is read (it is no longer guessed), and its changelog explains how to find records
imported with the wrong date. 3.0 keeps that behaviour and adds nothing to it.

## What you have to do

| If you… | Do this |
| --- | --- |
| install the packages | Nothing new. `@dynamic-entity/core` now has one dependency, `sheet-to-schema`, which npm installs for you. Deploy the browser app and the server together (see below). |
| type a stored plan as `MappingPlan` | Type it `MappingPlanV1`, or `AnyMappingPlan` if it may be either. |
| read `preview.suggestion.entity` | Read `.target`. Or normalise first with `readPlan`. |
| match on the text of a plan problem | Match on its `code`. |
| store plans the wizard emits | Nothing, unless you may roll back to 2.5: see "Plans are v2". |
| import server helpers such as `readSheet` or `ImportError` | Nothing yet. They are deprecated re-exports; move the import to `sheet-to-schema/node` before 4.0. |
| wrote your own `ImportTransport` | Its `commit` may now be handed a plan in either shape. |
| read Express-only properties of `request` in `createImportRouter`'s `configs`, `onImport` or `lang` | Annotate the parameter with your request type: `(entity, request: express.Request) => ...`. See "The server". |
| use `@types/express` only for `@dynamic-entity/server` | Nothing. The typings no longer need it, in either major or at all. |

## Plans are v2

A mapping plan written by 3.0 is **plan v2**:

```jsonc
// 2.x (plan v1)                       // 3.0 (plan v2)
{                                      {
  "entity": "employees",                 "planVersion": 2,
  "configVersion": 4,                    "target": "employees",
  "entries": [ … ]                       "schemaVersion": 4,
}                                        "entries": [ … ]
                                       }
```

- **Every plan you have stored still works.** `applyMapping`, `validateMappingPlan`,
  `runImport` and the server's routes take either shape, and a v1 plan imports exactly what
  it imported under 2.5.
- **`suggestMapping` and the mapper now return v2.** So a preview's `suggestion` carries
  `target`, not `entity`.
- **Types.** `MappingPlan` is the v2 type. The 2.x shape is `MappingPlanV1` (deprecated), and
  `AnyMappingPlan` is the union. The wizard's contracts (`ImportPreview.suggestion`, the
  `[plan]` inputs, `ImportTransport.commit`) are typed `AnyMappingPlan`.
- **Reading one you did not write.** `readPlan(plan)` from `@dynamic-entity/core` returns it
  as v2 with every default filled in, plus any problems. Use it wherever app code reads
  `preview.suggestion` or loads a plan from storage.

  ```ts
  import { readPlan } from '@dynamic-entity/core';

  const { plan, problems } = readPlan(preview.suggestion);
  if (plan) console.log(plan.target, plan.entries.length);
  ```

- **Rolling back.** A plan saved by a 3.0 wizard is v2. An app rolled back to 2.5 cannot read
  it properly: it finds no `entity`. If you may roll back, keep the v1 form, which
  `planForServer(plan, [1]).plan` gives you for any plan that uses nothing v2 added.

Plan v2 can also say things v1 could not: a date order per column, a separator for a list
written in one cell, and grouping several rows into one record. The mapper does not build
those yet. A plan that uses them is applied by `applyMapping` and by the browser wizard.

## Browser and server versions

Deploy them together where you can. During a rolling deploy:

- **A 3.0 wizard and a 2.x server.** The wizard notices (a 2.x server reports no
  `planVersions`) and sends the mapping in v1 form, so the import works. A plan that groups
  rows, or uses a per-column `split` or `dateOrder`, is **refused before anything is sent**: a
  2.x server would ignore those and import the wrong thing without an error.
- **A 2.5 wizard and a 3.0 server.** Works. The server still reports `engineVersion` as its
  `@dynamic-entity/core` version, which is what the wizard compares, and the wizard warns
  that the two differ, as it should. One oddity: the server's suggestion is v2, the 2.5
  mapper adds `entity` and `configVersion` to it, and the plan that comes back carries both
  names. The server imports it and reports two `PLAN_ALIAS_USED` warnings. Nothing is wrong
  with the import.
- A 3.0 server also reports `adapter` (`{ name: 'dynamic-entity', version }`) and
  `planVersions` (`[1, 2]`). The wizard warns in the console when the adapter is not the one
  it expects at the same major version.

## Messages and codes

- **Plan-problem messages changed.** The checks are `sheet-to-schema`'s now, and say "schema"
  where 2.x said "config": `Plan targets "other" but the config is "e".` is now
  `The plan was written for "other"; this schema is "e".` Codes and paths did not change.
  Match on `code`.
- **A ref into a reserved key is `PLAN_UNSAFE_PATH`.** A plan entry whose ref goes through
  `__proto__`, `constructor` or `prototype` was reported as `PLAN_UNKNOWN_REF`. It is still an
  error and still imports nothing.
- **`PLAN_PROBLEM_CODES` has thirteen codes**, up from six. The six keep their meaning. It is
  now a deprecated re-export of `sheet-to-schema`'s list.
- **Every row error has a `code`** (`CELL_FORMAT`, `RECORD_REQUIRED`, …). The field is new and
  optional in the type; nothing you read before has moved.
- **A required field whose cell could not be read is reported once**, as unreadable. 2.x also
  reported it as required, so `errors` can be shorter for the same file. The rows that fail
  are the same rows.

## Results

`ImportResult` and `ImportRowError` are the 2.x types with optional additions:

| Field | On | Meaning |
| --- | --- | --- |
| `code` | an error | Why it failed, as a stable code |
| `rows` | an error or warning | Every sheet row it concerns, when a plan groups rows |
| `warnings` | a result | Problems that did not stop a record being imported. Absent when there are none |

The server's responses gain `warnings`, `warningCount`, `rowsInImported`, `adapter`,
`planVersions` and, on a preview, `slots`. Nothing was removed or renamed.

## Deprecated, removed in 4.0

They keep working through 3.x. Each is the same function or type, re-exported.

| From | Names | Import from instead |
| --- | --- | --- |
| `@dynamic-entity/core` | `parseCsv`, `toCsv`, `createCsvReader`, `escapeFormula`, `padRow`, `detectDelimiter`, `completeFirstLine`, `decimalMarkFor`, `cellText`, and the types `CsvDelimiter`, `CsvReader`, `CsvReaderOptions`, `SheetData`, `SheetGrid`, `ImportPreviewResponse`, `ImportErrorResponse` | `sheet-to-schema` |
| `@dynamic-entity/core` | `PLAN_PROBLEM_CODES`, `PlanProblemCode`, `MappingPlanV1` | `sheet-to-schema` (`MappingPlanV1`: write `MappingPlan`) |
| `@dynamic-entity/server` | `DEFAULT_LIMITS`, `resolveLimits`, `ImportLimits`, `ImportError`, `toErrorBody`, `ImportErrorCode`, `ImportErrorBody`, `toByteStream`, `limitBytes`, `peek`, `destroySource`, `ByteSource`, `guardZip`, `xlsxRows`, `cellValue`, `readSheet`, `detectFormat`, `guardRows`, `SheetFormat`, `SheetSource`, `ReadSheetOptions`, `TEMPLATE_EXTENSION`, `TEMPLATE_MEDIA_TYPE`, `TemplateFormat` | `sheet-to-schema/node` |

**Not deprecated**, because they keep Dynamic Entity's signatures: `applyMapping`,
`suggestMapping`, `validateMappingPlan`, `coerceCell`, `validateImportedRecord`,
`setRecordValue`, `deriveImportColumns`, `buildTemplateSpec`, and the server's `runImport`,
`previewSheet`, `writeTemplate` and `createImportRouter`.

## The server

`createImportRouter(options)` takes the same options and serves the same four routes. Your
`onImport` is called with the same context (`entity`, `config`, `request`, and the batch
position). One behaviour is new:

- **A plan with `group` is refused**, with `INVALID_PLAN` (HTTP 400). The streaming runner
  does not group rows yet, and ignoring `group` would import one record per row. The browser
  import does group.

One typing change: the `request` handed to `configs`, `onImport` and `lang`
is typed `ImportRequest` (a Node request with `params` and `query`), not Express's `Request`,
so the typings need no `@types/express`. Code that reads something Express or your middleware
adds, such as `request.user`, annotates the callback's parameter, and the options take that
type: `configs: (entity, request: express.Request) => ...`. Nothing changes at run time: it is
the same Express request object.

## Working on the engine and Dynamic Entity together

Only for contributors: an app that uses Dynamic Entity installs `sheet-to-schema` from npm and
needs none of this.

Dynamic Entity's import engine is [`sheet-to-schema`](https://github.com/berserker5619/sheet-to-schema), developed in its own
repository. Core and server depend on it as `^1.0.0`.

**An engine change lands in sheet-to-schema first:** a pull request there, a release, then a
separate Dynamic Entity commit that raises the `sheet-to-schema` range when it needs the new version. A Dynamic Entity change that needs the
engine to behave differently is two pull requests, the engine's first. The
`sheet-to-schema drift` workflow here tests Dynamic Entity against the engine's `latest` and
`next` every day, so a published engine change that would break Dynamic Entity shows up before
the pin moves.

To work on both at once, with the two repositories checked out side by side, point Dynamic
Entity at the local engine. Either way, keep the change out of your commits, and go back with
`git checkout package-lock.json packages/core/package.json packages/server/package.json && npm ci`.

- **A `file:` dependency on a packed tarball**, which is what a user installs, and the one to
  trust before opening a pull request. Repack and reinstall after each engine change.

  ```bash
  # in sheet-to-schema
  npm run build && npm pack
  # in Dynamic Entity: both workspaces that depend on it, so there is one copy
  npm pkg set dependencies.sheet-to-schema=file:../sheet-to-schema/sheet-to-schema-<version>.tgz \
    --workspace packages/core --workspace packages/server
  npm install
  npm ls sheet-to-schema   # one version, the tarball's
  ```

- **`npm link`**, for a faster loop: rebuild the engine (`npm run build`) and Dynamic Entity
  sees it at once. The linked engine resolves its optional peers (`exceljs`, `busboy`,
  `express`) from its own checkout, so it can find different copies of them than Dynamic Entity
  does; confirm a result with the tarball before relying on it.

  ```bash
  cd ../sheet-to-schema && npm run build && npm link
  cd ../Dynamic-Entity && npm link sheet-to-schema
  ```

## New in 3.0, if you want it

- `entityFormConfigAdapter(config, options)`: a config as a `sheet-to-schema` adapter, for
  calling the generic engine yourself.
- `readPlan`, `planForServer`, `v2OnlyFields`, re-exported from `@dynamic-entity/core`.
- Grouping rows into records, and a date order per column, through a v2 plan.
