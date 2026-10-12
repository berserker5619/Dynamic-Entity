# Changelog

All notable changes to `sheet-to-schema`.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-rc.1]

The first release candidate. The package is the spreadsheet-import engine of
[Dynamic Entity](../../README.md), extracted so it can be used with any schema. Dynamic Entity
3.0 runs on it, and is the proof that it holds: the same files import to the same records as
Dynamic Entity 2.5.0 produced.

### The main entry, `sheet-to-schema`
Browser-safe, with no runtime dependencies.
- **Mapping plan v2**, as plain JSON: `target`, `schemaVersion`, entries with a `column` or
  a `constant`, a per-entry `split` and `dateOrder`, per-array `lists` options, and `group`.
  `readPlan` reads v2 and the older v1 shape, and normalises both.
- **`applyMapping`**: rows in, records out, with every problem collected and coded. Lists
  three ways: numbered columns, one cell split, and one row per item grouped by a key.
  Rows of a group that disagree raise a warning and keep the first row's value.
- **`suggestMapping`** and `slotsFor`: a suggested plan from the headers, sized per array,
  and from a sample of rows the order a date column is written in.
- **Dates are never guessed.** A date that reads two ways is an error unless the plan entry
  or the run states its order.
- **Adapters**: `jsonSchemaAdapter`, `exampleJsonAdapter`, and the `SchemaAdapter` contract
  for your own, with `coerce`, `finalize` and `validate` hooks.
- **`validatePlan`** and `preparePlan`, with thirteen `PLAN_` codes; `CELL_` and `RECORD_`
  codes on every row problem.
- **`planForServer`** and `v2OnlyFields`: what a client may send to a server that reads only
  v1 plans, or why it must not.
- **CSV**: `parseCsv`, `createCsvReader`, `toCsv`, delimiter detection, formula escaping.
- The wire types a client and a server share, and `IMPORTER_VERSION` / `PLAN_VERSIONS`.

### The server entry, `sheet-to-schema/node`
Needs Node. `exceljs`, `busboy` and `express` are optional peers, loaded when first needed.
- **`readSheet`**: CSV or `.xlsx`, streamed, decided by the file's bytes and held to every
  limit, with a zip guard in front of the workbook reader.
- **`runImport`** and `previewSheet` over an adapter: memory bounded by the batch, the next
  batch not read until the last is written, errors counted exactly and sampled.
- **`createImportRouter`**: template, preview, validate and import routes on a router you
  pass in, with an adapter per name. Every answer is stamped with the engine version, the
  adapter and the plan versions the server reads.
- **`writeTemplate`**, `receiveUpload`, the limits and the one error envelope.

### Not in this release
- The streaming runner does not group rows. It refuses a plan with `group` rather than
  ignore it. `applyMapping` groups.
- A header row other than row 1.
