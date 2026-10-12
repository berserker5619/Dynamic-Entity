/**
 * errors.ts — the one failure an import raises, and the envelope it is answered with.
 *
 * Since 3.0 this is sheet-to-schema's, moved to `sheet-to-schema/node` unchanged, and this
 * file re-exports it. The names stay importable from `@dynamic-entity/server` through 3.x and
 * are removed in 4.0: import them from `sheet-to-schema/node`.
 */

import { toErrorBody as importerToErrorBody, type ImportErrorBody as ImporterErrorBody, type ImportErrorCode as ImporterErrorCode } from 'sheet-to-schema/node';

/**
 * The class itself, not a copy: an `ImportError` thrown by `sheet-to-schema/node` is an
 * `instanceof` this one.
 *
 * @deprecated Import `ImportError` from `sheet-to-schema/node`. Removed in 4.0.
 */
export { ImportError } from 'sheet-to-schema/node';
/** @deprecated Import `ImportErrorCode` from `sheet-to-schema/node`. Removed in 4.0. */
export type ImportErrorCode = ImporterErrorCode;
/** @deprecated Import `ImportErrorBody` from `sheet-to-schema/node`. Removed in 4.0. */
export type ImportErrorBody = ImporterErrorBody;
/** @deprecated Any failure as a status and an envelope. Import `toErrorBody` from `sheet-to-schema/node`. Removed in 4.0. */
export const toErrorBody = importerToErrorBody;
