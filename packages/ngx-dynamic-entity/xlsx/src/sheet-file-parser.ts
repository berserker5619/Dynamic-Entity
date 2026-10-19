/**
 * sheet-file-parser.ts — CSV, TSV and `.xlsx` in the browser, read as the server reads them.
 *
 * sheet-to-schema/browser's `readSheetFile` reads a file into exactly the grid the server's
 * `readSheet` reads from the same bytes: the same headers, the same typed cells, the same
 * separator, and the same refusals. The format is decided by the bytes, never the name.
 *
 * It loads ExcelJS with `import('exceljs')` the first time a workbook is read, so a user who only
 * imports CSV never downloads it. But a bundler resolves that import when it builds: Angular's
 * `ng build` fails on it without `exceljs` installed (docs/3.1-spec.md, Step 0). That is why this
 * is an entry of its own. An app that imports it installs `exceljs`; one that does not never
 * needs it.
 */
import type { Provider } from '@angular/core';
import { SHEET_ACCEPT, SHEET_PARSER, type SheetParser } from 'ngx-dynamic-entity';
import { readSheetFile } from 'sheet-to-schema/browser';

/** What the picker offers with this parser. */
export const SHEET_FILE_ACCEPT = '.csv,.tsv,.txt,.xlsx';

/**
 * Read a CSV, TSV or `.xlsx` file into headers and positional rows, with a CSV's separator, as
 * the server would. Throws sheet-to-schema's `ImportError`: `UNSUPPORTED_FORMAT` for a `.xls`, a
 * UTF-16 file or a zip that is not a workbook, `UNSUPPORTED_RUNTIME` for a workbook where the
 * browser has no `DecompressionStream('deflate-raw')`, and `PEER_MISSING` where `exceljs` was not
 * installed but the app still built (a dev server, or `exceljs` marked external).
 */
export const sheetFileParser: SheetParser = async (file: File) => {
  const { headers, rows, delimiter } = await readSheetFile(file, { filename: file.name });
  return { headers, rows, ...(delimiter ? { delimiter } : {}) };
};

/**
 * The import wizard reads `.xlsx` too, in the browser, and its picker offers it.
 *
 *     providers: [provideNgxDynamicEntity({}), provideSheetFileParser()]
 *
 * After `provideNgxDynamicEntity`, which provides its own `SHEET_PARSER` (the built-in CSV one,
 * or yours): the later provider wins. Install `exceljs` (`npm install exceljs`); without it the
 * app does not build.
 */
export function provideSheetFileParser(): Provider[] {
  return [
    { provide: SHEET_PARSER, useValue: sheetFileParser },
    { provide: SHEET_ACCEPT, useValue: SHEET_FILE_ACCEPT },
  ];
}
