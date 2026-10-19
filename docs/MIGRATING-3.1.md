# Migrating to Dynamic Entity 3.1

3.1 is a minor release. **An app upgrading from 3.0 with no code changes keeps working**, and
behaves the same except in one place: the wizard's built-in parser now decides what a file is
by its bytes, not its name. Everything else is opt-in.

## What you have to do

| If you… | Do this |
| --- | --- |
| upgrade the packages | Nothing. `ngx-dynamic-entity` now depends on `sheet-to-schema` (`^1.3.0`, as core and the server do), and npm installs one copy for all three. |
| rely on the wizard refusing a file by its name | Nothing to change, but see "Formats are decided by bytes": a CSV under another name is now read, and a workbook is refused whatever it is called. |
| registered a `sheetParser` of your own for `.xlsx` | Keep it, or replace it with `provideSheetFileParser()` (below). If you keep it, provide `SHEET_ACCEPT` to restrict the picker, which is otherwise unrestricted, as in 3.0. |
| send grouped plans through `HttpImportTransport` | Turn grouping on in the server (`createImportRouter({ grouping: true })`), or the transport refuses the plan before uploading. In 3.0 the server refused it after. |
| match on a wizard error's message text | Match on its `code`. The wizard's own messages for coded failures are new `UI_TEXT` keys, which you can translate. |
| wrote your own `ImportTransport` | Nothing. `accept` is optional; add it to choose the picker's file types. |

## Formats are decided by bytes

The built-in parser is sheet-to-schema's `readCsvFile` from 3.1. It reads the file's first
bytes, as the server always has:

- **A CSV under any name is read.** 3.0 refused anything not named `.csv`, `.tsv` or `.txt`.
- **A workbook is refused whatever it is called**, with `UNSUPPORTED_FORMAT`. That covers an
  `.xlsx`, any other zip, a pre-2007 `.xls`, and UTF-16 text. 3.0 refused a workbook only by its
  name, and read one named `.csv` as mojibake.

The wizard says what the file is and what to save it as. The picker offers `.csv`, `.tsv` and
`.txt`.

## `.xlsx` in the browser: `ngx-dynamic-entity/xlsx`

```typescript
import { provideNgxDynamicEntity } from 'ngx-dynamic-entity';
import { provideSheetFileParser } from 'ngx-dynamic-entity/xlsx';

export const providers = [provideNgxDynamicEntity({}), provideSheetFileParser()];
```

- **List it after `provideNgxDynamicEntity`**, whose `SHEET_PARSER` it replaces.
- **Install `exceljs`** (`npm install exceljs`). It is an optional peer of `ngx-dynamic-entity`,
  needed only by an app that imports this entry: without it, `ng build` fails with
  `Could not resolve "exceljs"`. An app that does not import the entry builds without it.
- **It reads CSV, TSV and `.xlsx`** into the grid the server reads from the same bytes. ExcelJS
  is fetched the first time a workbook is read, so a user who imports only CSV never downloads
  it, and the picker offers `.xlsx`.
- **A workbook needs `DecompressionStream('deflate-raw')`**: Chrome and Edge 103, Firefox 113,
  Safari 16.4. On an older browser it is refused with `UNSUPPORTED_RUNTIME`, and a CSV still
  reads.
- **It replaces EXTENDING's hand-written ExcelJS parser**, which still works if you keep it.

## Grouping on the server

```typescript
createImportRouter({ configs, onImport, grouping: true });
```

A plan that groups rows into one record (`group`, plan v2) imports on the server only with
`grouping: true`:

- **Off by default**, exactly as 3.0: `400 INVALID_PLAN`, with a `PLAN_GROUP` problem whose
  `reason` is `grouping-disabled`.
- **With it**, previews say `features: ["group"]`, and `HttpImportTransport` sends grouped plans
  to that server only.
- **Contiguous groups only.** Sort the sheet by the key columns. `group.contiguous: false` is
  refused either way (`reason: 'non-contiguous'`). The browser can gather scattered rows; the
  streaming server holds one group at a time.
- **Run `/validate` first.** A grouped import can stop on a group limit, or on a key that comes
  back, after earlier groups were written, and an import is not transactional.

A plan that groups must be written in plan v2 form. A stored 2.2 plan's legacy refs into a
moved array are not rewritten for a collected array; the plan is refused with `PLAN_LEGACY_REF`
and `PLAN_GROUP`.

## A grouped item's problem names its own row

From sheet-to-schema 1.3, a problem inside one collected item (`items.2.sku` is required)
carries that item's sheet row as `row`, and `rows: [that row]`. In 3.0 it named the group's
first row and carried all its rows. A problem with the record as a whole is unchanged.
