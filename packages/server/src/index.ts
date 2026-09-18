/**
 * @dynamic-entity/server — streaming spreadsheet import.
 *
 * The browser transport in `ngx-dynamic-entity` reads a file into memory whole, because a
 * browser has nowhere else to put it. This package exists for the case that makes that wrong:
 * a fifty-thousand-row workbook. It streams, and its peak memory is a function of `batchSize`
 * rather than of the file's size.
 *
 * It re-decides nothing. The mapping, the coercion, the validation and the record shape all
 * come from `@dynamic-entity/core` — the same functions the browser runs. A server-side import
 * must be indistinguishable from a client-side one, and any place this package decided
 * something core already decides would be a defect rather than an optimisation.
 */

export * from './limits';
export * from './errors';
export * from './bytes';
export * from './cell-text';
export * from './guard-zip';
export * from './xlsx-source';
export * from './read-sheet';
export * from './run-import';
export * from './write-template';
