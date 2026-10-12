/**
 * csv.ts — RFC 4180 parse and emit.
 *
 * Since 3.0 the code is sheet-to-schema's, moved there unchanged, and everything here is a
 * re-export of it. The names stay importable from `@dynamic-entity/core` through 3.x and are
 * removed in 4.0: import them from `sheet-to-schema`.
 *
 * Rows are **positional** (`string[][]`), not keyed by header. Real sheets carry duplicate
 * headers — two columns both called "Notes" — and blank ones, so a header-keyed row silently
 * loses columns. Everything downstream addresses a column by index for the same reason.
 */

import {
  completeFirstLine as importerCompleteFirstLine,
  createCsvReader as importerCreateCsvReader,
  decimalMarkFor as importerDecimalMarkFor,
  detectDelimiter as importerDetectDelimiter,
  escapeFormula as importerEscapeFormula,
  padRow as importerPadRow,
  parseCsv as importerParseCsv,
  toCsv as importerToCsv,
  type CsvDelimiter as ImporterCsvDelimiter,
  type CsvReader as ImporterCsvReader,
  type CsvReaderOptions as ImporterCsvReaderOptions,
  type SheetData as ImporterSheetData,
  type SheetGrid as ImporterSheetGrid,
} from 'sheet-to-schema';

/** @deprecated A parsed sheet. Import `SheetData` from `sheet-to-schema`. Removed in 4.0. */
export type SheetData = ImporterSheetData;
/** @deprecated A sheet of typed cells. Import `SheetGrid` from `sheet-to-schema`. Removed in 4.0. */
export type SheetGrid = ImporterSheetGrid;
/** @deprecated Import `CsvDelimiter` from `sheet-to-schema`. Removed in 4.0. */
export type CsvDelimiter = ImporterCsvDelimiter;
/** @deprecated Import `CsvReaderOptions` from `sheet-to-schema`. Removed in 4.0. */
export type CsvReaderOptions = ImporterCsvReaderOptions;
/** @deprecated Import `CsvReader` from `sheet-to-schema`. Removed in 4.0. */
export type CsvReader = ImporterCsvReader;

/** @deprecated Neutralise a cell a spreadsheet would run as a formula. Import `escapeFormula` from `sheet-to-schema`. Removed in 4.0. */
export const escapeFormula = importerEscapeFormula;
/** @deprecated Write a header row and data rows as CSV. Import `toCsv` from `sheet-to-schema`. Removed in 4.0. */
export const toCsv = importerToCsv;
/** @deprecated Pad a row to a width. Import `padRow` from `sheet-to-schema`. Removed in 4.0. */
export const padRow = importerPadRow;
/** @deprecated A streaming CSV reader. Import `createCsvReader` from `sheet-to-schema`. Removed in 4.0. */
export const createCsvReader = importerCreateCsvReader;
/** @deprecated Parse CSV text. Import `parseCsv` from `sheet-to-schema`. Removed in 4.0. */
export const parseCsv = importerParseCsv;
/** @deprecated The decimal mark a delimiter implies. Import `decimalMarkFor` from `sheet-to-schema`. Removed in 4.0. */
export const decimalMarkFor = importerDecimalMarkFor;
/** @deprecated The delimiter a header line uses. Import `detectDelimiter` from `sheet-to-schema`. Removed in 4.0. */
export const detectDelimiter = importerDetectDelimiter;
/** @deprecated The first complete line of a text, if it has one. Import `completeFirstLine` from `sheet-to-schema`. Removed in 4.0. */
export const completeFirstLine = importerCompleteFirstLine;
