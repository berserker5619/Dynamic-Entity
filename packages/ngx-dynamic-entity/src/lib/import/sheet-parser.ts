/**
 * sheet-parser.ts — the built-in CSV reader, and the reason it is the only one.
 *
 * CSV is what every spreadsheet tool exports and what a text editor can produce, and
 * sheet-to-schema's `readCsvFile` reads it with nothing installed. Shipping that as the default
 * means the import wizard works on a fresh `npm install` with nothing registered, and an app
 * that never installs `exceljs` still builds (docs/3.1-spec.md, Step 0: Angular's `ng build`
 * fails on sheet-to-schema/browser without it). `.xlsx` is the opt-in `ngx-dynamic-entity/xlsx`
 * entry, `provideSheetFileParser()`.
 *
 * Imported from `sheet-to-schema` itself, not through `@dynamic-entity/core`, whose re-exports of
 * it are deprecated for 4.0.
 */

import { readCsvFile } from 'sheet-to-schema';
import type { SheetParser } from './import-contracts';

/** What the picker offers with the built-in parser. */
export const DEFAULT_SHEET_ACCEPT = '.csv,.tsv,.txt';

/**
 * Read a CSV or TSV file into exactly the grid the server reads from the same bytes, with the
 * separator it uses, so `LocalImportTransport` reads `1,5` in a semicolon file as the server does.
 *
 * The format is decided by the bytes, not the name (from 3.1). A CSV under any name is read. A
 * workbook is refused with `UNSUPPORTED_FORMAT` whatever it is called: `.xlsx`, or any zip, and a
 * pre-2007 `.xls`. So is a UTF-16 file. Reading a zip as text would yield a header row of
 * mojibake and a mapping screen full of nonsense, which is much harder to diagnose than being
 * told the format is not supported.
 */
export const defaultSheetParser: SheetParser = async (file: File) => {
  const { headers, rows, delimiter } = await readCsvFile(file, { filename: file?.name });
  return { headers, rows, delimiter };
};
