/**
 * errors.ts — one error type, a closed set of codes, and an envelope that says nothing else.
 *
 * **Information disclosure is a threat, so the envelope is the guard.** A stack trace tells an
 * attacker the library versions in use and the filesystem layout of the host; a parser's own
 * message tells them which parser. So a response carries a machine-readable `code` and a
 * message this package wrote, and nothing that came from below it. Whatever the real cause
 * was stays on the server, reachable through `cause` for the consumer's logger.
 */

/**
 * Why a request failed, in a form a client can branch on.
 *
 * Closed on purpose: a client that has to match on message text is a client that breaks when
 * the text improves, and the wire shape is shared with `ngx-dynamic-entity`.
 */
export type ImportErrorCode =
  /** No file part in the multipart body. */
  | 'NO_FILE'
  /** More file parts than `limits.maxFiles`. */
  | 'TOO_MANY_FILES'
  /** The body exceeded `limits.maxBytes`, or a field exceeded its own bound. */
  | 'TOO_LARGE'
  /** The bytes are not a format this package reads. Decided by content, not by filename. */
  | 'UNSUPPORTED_FORMAT'
  /** The bytes claim a format and are not valid in it. */
  | 'MALFORMED_FILE'
  /** A zip that inflates out of proportion to its size, or has too many entries. */
  | 'ARCHIVE_REFUSED'
  /** Rows, columns or one cell past the configured bound. */
  | 'SHEET_TOO_LARGE'
  /** No config is registered under the requested entity. */
  | 'UNKNOWN_ENTITY'
  /** The `plan` field is missing, is not JSON, or does not describe this config. */
  | 'INVALID_PLAN'
  /** The request took longer than `limits.totalTimeoutMs`, or stalled past the idle bound. */
  | 'TIMEOUT'
  /** The consumer's `onImport` threw. Nothing about *why* crosses the wire. */
  | 'IMPORT_FAILED'
  /** Anything else. Deliberately the least informative code there is. */
  | 'INTERNAL';

/** The HTTP status each code answers with. Kept here so a route never has to decide. */
const STATUS: Record<ImportErrorCode, number> = {
  NO_FILE: 400,
  TOO_MANY_FILES: 400,
  TOO_LARGE: 413,
  UNSUPPORTED_FORMAT: 415,
  MALFORMED_FILE: 400,
  ARCHIVE_REFUSED: 400,
  SHEET_TOO_LARGE: 413,
  UNKNOWN_ENTITY: 404,
  INVALID_PLAN: 400,
  TIMEOUT: 408,
  IMPORT_FAILED: 500,
  INTERNAL: 500,
};

/**
 * What a failing route sends.
 *
 * `details` is present only for `INVALID_PLAN`, and carries `validateMappingPlan`'s own
 * problems — those describe the client's own plan against a config the client already has,
 * so they disclose nothing the caller did not send.
 */
export interface ImportErrorBody {
  error: {
    code: ImportErrorCode;
    message: string;
    details?: unknown;
  };
}

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ImportErrorCode, message: string, options: { cause?: unknown; details?: unknown } = {}) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.status = STATUS[code] ?? 500;
    this.details = options.details;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/**
 * Turn anything thrown into a response body.
 *
 * An `ImportError` says what it says. **Everything else becomes `INTERNAL` with a fixed
 * message** — that is the whole point, and the reason this is a function rather than a
 * `catch` block per route. A parser that throws `ENOENT: open '/srv/app/tmp/…'` must not be
 * the thing that answers the request.
 */
export function toErrorBody(error: unknown): { status: number; body: ImportErrorBody } {
  if (error instanceof ImportError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'The import could not be completed.' } },
  };
}
