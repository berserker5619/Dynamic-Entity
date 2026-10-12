/**
 * bytes.ts — the byte-stream helpers a streaming reader is built from.
 *
 * Since 3.0 these are sheet-to-schema's, moved to `sheet-to-schema/node` unchanged, and this
 * file re-exports it. The names stay importable from `@dynamic-entity/server` through 3.x and
 * are removed in 4.0: import them from `sheet-to-schema/node`.
 */

import {
  destroySource as importerDestroySource,
  limitBytes as importerLimitBytes,
  peek as importerPeek,
  toByteStream as importerToByteStream,
  type ByteSource as ImporterByteSource,
} from 'sheet-to-schema/node';

/** @deprecated Import `ByteSource` from `sheet-to-schema/node`. Removed in 4.0. */
export type ByteSource = ImporterByteSource;
/** @deprecated Any byte source as one async stream. Import `toByteStream` from `sheet-to-schema/node`. Removed in 4.0. */
export const toByteStream = importerToByteStream;
/** @deprecated Stop a stream past a byte limit. Import `limitBytes` from `sheet-to-schema/node`. Removed in 4.0. */
export const limitBytes = importerLimitBytes;
/** @deprecated Read a stream's first bytes without losing them. Import `peek` from `sheet-to-schema/node`. Removed in 4.0. */
export const peek = importerPeek;
/** @deprecated Close whatever a refused request was still sending. Import `destroySource` from `sheet-to-schema/node`. Removed in 4.0. */
export const destroySource = importerDestroySource;
