/**
 * read-sheet.ts — bytes in, a header row and a stream of rows out, whichever format it was.
 *
 * Since 3.0 the reader is sheet-to-schema's, moved to `sheet-to-schema/node` unchanged, and this
 * file re-exports it. The names stay importable from `@dynamic-entity/server` through 3.x and
 * are removed in 4.0: import them from `sheet-to-schema/node`.
 */

import {
  detectFormat as importerDetectFormat,
  guardRows as importerGuardRows,
  readSheet as importerReadSheet,
  type ReadSheetOptions as ImporterReadSheetOptions,
  type SheetFormat as ImporterSheetFormat,
  type SheetSource as ImporterSheetSource,
} from 'sheet-to-schema/node';

/** @deprecated Import `SheetFormat` from `sheet-to-schema/node`. Removed in 4.0. */
export type SheetFormat = ImporterSheetFormat;
/** @deprecated Import `SheetSource` from `sheet-to-schema/node`. Removed in 4.0. */
export type SheetSource = ImporterSheetSource;
/** @deprecated Import `ReadSheetOptions` from `sheet-to-schema/node`. Removed in 4.0. */
export type ReadSheetOptions = ImporterReadSheetOptions;
/** @deprecated What a file is, from its first bytes. Import `detectFormat` from `sheet-to-schema/node`. Removed in 4.0. */
export const detectFormat = importerDetectFormat;
/** @deprecated Rows held to the row, column and cell limits. Import `guardRows` from `sheet-to-schema/node`. Removed in 4.0. */
export const guardRows = importerGuardRows;
/** @deprecated Read a CSV or a workbook as a stream of rows. Import `readSheet` from `sheet-to-schema/node`. Removed in 4.0. */
export const readSheet = importerReadSheet;
