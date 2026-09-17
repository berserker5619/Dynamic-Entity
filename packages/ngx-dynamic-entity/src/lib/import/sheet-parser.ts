/**
 * sheet-parser.ts — the built-in CSV reader, and the reason it is the only one.
 *
 * CSV is what every spreadsheet tool exports and what a text editor can produce, and
 * `@dynamic-entity/core` parses it with no dependency. Shipping that as the default means the
 * import wizard works on a fresh `npm install` with nothing registered — `SHEET_PARSER` then
 * exists for the consumer who *also* wants `.xlsx`, rather than for the consumer who wants
 * the feature to work at all.
 *
 * The alternative was a hard dependency on a spreadsheet library in a package that currently
 * has none, for a file format many consumers will never see.
 */

import { parseCsv, type SheetData } from '@dynamic-entity/core';
import type { SheetParser } from './import-contracts';

/** Extensions the built-in parser will attempt. */
const TEXT_EXTENSIONS = /\.(csv|tsv|txt)$/i;

/**
 * Read a text file as CSV.
 *
 * A binary workbook is refused by name rather than attempted: `.xlsx` is a zip, so reading it
 * as text yields a header row of mojibake and a mapping screen full of nonsense, which is a
 * much harder thing to diagnose than being told the format is not supported.
 */
export const defaultSheetParser: SheetParser = async (file: File): Promise<SheetData> => {
  if (file?.name && !TEXT_EXTENSIONS.test(file.name)) {
    throw new Error(
      `Cannot read "${file.name}". The built-in parser handles CSV only — register a ` +
        'sheetParser with provideNgxDynamicEntity({ sheetParser }) to accept other formats.',
    );
  }
  return parseCsv(await file.text());
};
