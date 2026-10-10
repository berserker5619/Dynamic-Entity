/**
 * import-failure.ts — a failure of the whole import, not of one row (spec §5, §9).
 *
 * Most problems are collected: a bad cell fails its record and the import carries on. A few
 * make every result meaningless, and those stop the import. `applyMapping` throws them as an
 * `ImportFailure`, and the server maps the same codes onto HTTP statuses (`GROUP_NOT_CONTIGUOUS`
 * 422, `GROUP_TOO_LARGE` and `TOO_MANY_GROUPS` 413). The two size codes belong to the streaming
 * runner, which bounds memory; `applyMapping` already holds the whole sheet.
 */

export const IMPORT_FAILURE_CODES = ['GROUP_NOT_CONTIGUOUS', 'GROUP_TOO_LARGE', 'TOO_MANY_GROUPS'] as const;
export type ImportFailureCode = (typeof IMPORT_FAILURE_CODES)[number];

export interface ImportFailureDetails {
  /** The group key, as the tuple of trimmed cell text it was compared as. */
  key?: string[];
  /** Sheet rows the failure concerns: for `GROUP_NOT_CONTIGUOUS`, the closed group's last row and the row that reopened it. */
  rows?: number[];
}

export class ImportFailure extends Error {
  readonly code: ImportFailureCode;
  readonly details: ImportFailureDetails;

  constructor(code: ImportFailureCode, message: string, details: ImportFailureDetails = {}) {
    super(message);
    this.name = 'ImportFailure';
    this.code = code;
    this.details = details;
  }
}
