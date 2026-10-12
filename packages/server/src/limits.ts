/**
 * limits.ts — every bound an import is held to.
 *
 * Since 3.0 these are sheet-to-schema's, moved to `sheet-to-schema/node` unchanged, and this
 * file re-exports it. The names stay importable from `@dynamic-entity/server` through 3.x and
 * are removed in 4.0: import them from `sheet-to-schema/node`.
 */

import { DEFAULT_LIMITS as IMPORTER_DEFAULT_LIMITS, resolveLimits as importerResolveLimits, type ImportLimits as ImporterLimits } from 'sheet-to-schema/node';

/** @deprecated Import `ImportLimits` from `sheet-to-schema/node`. Removed in 4.0. */
export type ImportLimits = ImporterLimits;
/** @deprecated Import `DEFAULT_LIMITS` from `sheet-to-schema/node`. Removed in 4.0. */
export const DEFAULT_LIMITS = IMPORTER_DEFAULT_LIMITS;
/** @deprecated The defaults with a caller's overrides. Import `resolveLimits` from `sheet-to-schema/node`. Removed in 4.0. */
export const resolveLimits = importerResolveLimits;
