// sheet-to-schema/node: everything that needs Node (docs/phase2-plan.md, "/node subpath").
//
// The main entry is browser-safe and has no runtime dependencies. What is here reads files and
// serves HTTP, so it may use Node built-ins and the optional peers `exceljs` and `busboy`.
// Code here imports the main entry by its package name, never by a relative path, so this
// bundle holds no second copy of the engine: a plan, a result or an `ImportFailure` is the
// same thing on both sides.

export { loadOptional } from './optional';

// ─── Limits and failures ────────────────────────────────────────────────────
export { DEFAULT_LIMITS, resolveLimits } from './limits';
export type { ImportLimits } from './limits';
export { ImportError, toErrorBody } from './errors';
export type { ImportErrorBody, ImportErrorCode } from './errors';

// ─── Bytes ──────────────────────────────────────────────────────────────────
export { destroySource, limitBytes, peek, toByteStream } from './bytes';
export type { ByteSource } from './bytes';
export { guardZip } from './guard-zip';

// ─── Reading a sheet ────────────────────────────────────────────────────────
export { cellValue, xlsxRows } from './xlsx-source';
export { detectFormat, guardRows, readSheet } from './read-sheet';
export type { ReadSheetOptions, SheetFormat, SheetSource } from './read-sheet';

// ─── Writing a template ─────────────────────────────────────────────────────
export { TEMPLATE_EXTENSION, TEMPLATE_MEDIA_TYPE, writeTemplate } from './write-template';
export type { TemplateFormat, TemplateSheet, WriteTemplateOptions } from './write-template';

// ─── Running an import ──────────────────────────────────────────────────────
export { GROUPING_NOT_STREAMED, previewSheet, runImport } from './run-import';
export type { BatchInfo, ImportRunResult, OnBatch, PreviewSheetOptions, RunImportOptions, SheetPreview } from './run-import';
