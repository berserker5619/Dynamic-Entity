/**
 * import-wire.types.ts — the shapes an import crosses a network in.
 *
 * Since 3.0 these are sheet-to-schema's wire types, re-exported. Every field a 2.x server
 * sends is in them with its meaning; what plan v2 adds is optional, so a response from a 2.x
 * server still fits. The names stay importable from `@dynamic-entity/core` through 3.x and are
 * removed in 4.0: import them from `sheet-to-schema`.
 *
 * One thing reads differently from 2.x. A preview's `suggestion` is typed as plan v2, which
 * is what a 3.0 server sends; one from a 2.x server is a 2.x plan, so code that may be talking
 * to either should read it with `readPlan`.
 */

import type {
  ImportCommitResponse as ImporterCommitResponse,
  ImportErrorResponse as ImporterErrorResponse,
  ImportPreviewResponse as ImporterPreviewResponse,
} from 'sheet-to-schema';
import type { ConfigProblem } from './validate-config';

/** @deprecated What a first look at an uploaded file answers with. Import `ImportPreviewResponse` from `sheet-to-schema`. Removed in 4.0. */
export type ImportPreviewResponse = ImporterPreviewResponse;
/**
 * What an import or a validation pass answers with.
 *
 * sheet-to-schema's `ImportCommitResponse`, with the plan's problems as Dynamic Entity's
 * `ConfigProblem`s, as its results have them: the same objects, read through the type whose
 * `code` a 2.x server may not have sent.
 */
export type ImportCommitResponse = Omit<ImporterCommitResponse, 'planProblems'> & {
  /** What is wrong with the plan itself. An `error` here means nothing was imported. */
  planProblems: ConfigProblem[];
};
/** @deprecated What a failing request answers with. Import `ImportErrorResponse` from `sheet-to-schema`. Removed in 4.0. */
export type ImportErrorResponse = ImporterErrorResponse;
