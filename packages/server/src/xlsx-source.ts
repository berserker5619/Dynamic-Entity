/**
 * xlsx-source.ts — a workbook's first sheet as rows of typed cells.
 *
 * Since 3.0 the reader is sheet-to-schema's, moved to `sheet-to-schema/node` unchanged, and this
 * file re-exports it. The names stay importable from `@dynamic-entity/server` through 3.x and
 * are removed in 4.0: import them from `sheet-to-schema/node`.
 */

import { cellValue as importerCellValue, xlsxRows as importerXlsxRows } from 'sheet-to-schema/node';

/** @deprecated What a workbook cell holds, as a plain value. Import `cellValue` from `sheet-to-schema/node`. Removed in 4.0. */
export const cellValue = importerCellValue;
/** @deprecated A workbook's rows, streamed. Import `xlsxRows` from `sheet-to-schema/node`. Removed in 4.0. */
export const xlsxRows = importerXlsxRows;
