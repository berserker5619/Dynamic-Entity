/**
 * multipart.ts — one file and its plan out of a multipart body.
 *
 * Since 3.0 the reader is sheet-to-schema's (`receiveUpload` and `readPlanField` in
 * `sheet-to-schema/node`), and so is the router that calls it. This is the one name still
 * read from here. Never part of this package's public entry.
 */

export { safeFieldName } from 'sheet-to-schema/node';
