/**
 * @dynamic-entity/server — streaming spreadsheet import.
 *
 * The browser transport in `ngx-dynamic-entity` reads a file into memory whole, because a
 * browser has nowhere else to put it. This package exists for the case that makes that wrong:
 * a fifty-thousand-row workbook. It streams, and its peak memory is a function of `batchSize`
 * rather than of the file's size — exactly for CSV; for xlsx, see the package README, because
 * `guardZip` buffers the rebuilt archive (compressed, bounded by `maxBytes`) before exceljs
 * is constructed.
 *
 * It re-decides nothing. The mapping, the coercion, the validation and the record shape all
 * come from `@dynamic-entity/core` — the same functions the browser runs. A server-side import
 * must be indistinguishable from a client-side one, and any place this package decided
 * something core already decides would be a defect rather than an optimisation.
 *
 * ---
 *
 * Explicit, not `export *`. The barrel published `bytes`, `cell-text` and `guard-zip` whole:
 * an async-generator byte pump and a zip-bomb guard became semver surface nobody chose to
 * publish, and changing either would have been a breaking change. They are still here — a
 * server that streams needs `guardZip` and the byte helpers — but each name is listed, so a
 * new internal helper is no longer public by default.
 */

// ─── Limits ─────────────────────────────────────────────────────────────────
export { DEFAULT_LIMITS, resolveLimits } from './limits';
export type { ImportLimits } from './limits';

// ─── Errors ─────────────────────────────────────────────────────────────────
export { ImportError, toErrorBody } from './errors';
export type { ImportErrorBody, ImportErrorCode } from './errors';

// ─── Byte streaming ─────────────────────────────────────────────────────────
export { destroySource, limitBytes, peek, toByteStream } from './bytes';
export type { ByteSource } from './bytes';

// ─── Cell text ──────────────────────────────────────────────────────────────
export { sampleText } from './cell-text';

// ─── Zip guarding ───────────────────────────────────────────────────────────
export { guardZip } from './guard-zip';

// ─── Sheet sources ──────────────────────────────────────────────────────────
export { cellValue, xlsxRows } from './xlsx-source';
export { detectFormat, guardRows, readSheet } from './read-sheet';
export type { ReadSheetOptions, SheetFormat, SheetSource } from './read-sheet';

// ─── Running an import ──────────────────────────────────────────────────────
export { previewSheet, runImport } from './run-import';
export type {
  BatchInfo,
  ImportRunResult,
  OnBatch,
  PreviewSheetOptions,
  RunImportOptions,
  SheetPreview,
} from './run-import';

// ─── Writing a template ─────────────────────────────────────────────────────
export { TEMPLATE_EXTENSION, TEMPLATE_MEDIA_TYPE, writeTemplate } from './write-template';
export type { TemplateFormat, WriteTemplateOptions } from './write-template';
