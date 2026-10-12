/**
 * guard-zip.ts — a workbook is a zip, and a zip is checked before anything expands it.
 *
 * Since 3.0 the guard is sheet-to-schema's, moved to `sheet-to-schema/node` unchanged, and this
 * file re-exports it. The names stay importable from `@dynamic-entity/server` through 3.x and
 * are removed in 4.0: import them from `sheet-to-schema/node`.
 */

import { guardZip as importerGuardZip } from 'sheet-to-schema/node';

/** @deprecated Import `guardZip` from `sheet-to-schema/node`. Removed in 4.0. */
export const guardZip = importerGuardZip;
