/**
 * limits.ts — every bound this package enforces, and its default.
 *
 * **Every limit has a finite default.** A limit that is only a limit when a consumer
 * remembers to set one is documentation, not a guard, and this is the first
 * attacker-reachable code in the repository. A consumer who wants more raises the number;
 * nobody has to know the number exists to be protected by it.
 *
 * Each is enforced **during** streaming rather than after. A check that runs once the file is
 * in memory has already lost the thing it was checking.
 */

export interface ImportLimits {
  // ── The upload itself ──────────────────────────────────────────────────────

  /** Total bytes accepted from the request body. Counted as they arrive. */
  maxBytes: number;
  /** Multipart fields accepted, so a body of ten thousand tiny parts is not a parse loop. */
  maxFields: number;
  /** Bytes accepted in one non-file field — in practice the JSON `plan`. */
  maxFieldBytes: number;
  /** Bytes accepted in a field *name*, which is also attacker-chosen. */
  maxFieldNameBytes: number;
  /** Files accepted. One import is one file; more is either a mistake or an attack. */
  maxFiles: number;

  // ── The sheet ─────────────────────────────────────────────────────────────

  /** Data rows read. The header is not one of them. */
  maxRows: number;
  /** Columns read from the header row, and the width any row may reach. */
  maxColumns: number;
  /**
   * Characters in one cell.
   *
   * This is also the bound on `validators.pattern`: a config-supplied regex with
   * catastrophic backtracking is CPU-bound in the length of what it is run against, and on a
   * server that input is attacker-chosen. See SECURITY.md.
   */
  maxCellLength: number;

  // ── The zip an .xlsx actually is ──────────────────────────────────────────

  /** Total inflated bytes across every entry, checked *as they inflate*. */
  maxUncompressedBytes: number;
  /** Inflated-to-compressed ratio at which an entry is refused. */
  maxCompressionRatio: number;
  /** Entries in the archive. A workbook has tens; a bomb has thousands. */
  maxZipEntries: number;

  // ── The run ───────────────────────────────────────────────────────────────

  /**
   * Rows handed to `applyMapping`, and therefore to `onBatch`, at a time.
   *
   * Peak memory is a function of this number and not of the file's size. That is the entire
   * reason this package exists.
   */
  batchSize: number;
  /**
   * Row errors **retained**. The count and the truncation flag are always exact.
   *
   * A file where every row fails accumulates one error object per failing row, and fifty
   * thousand of those is the same unbounded growth as holding the file — the failure this
   * package exists to avoid, arrived at from the other direction.
   *
   * Lowering it costs a user *reasons*, never *counts*: `errorCount` and `failed` are tallied
   * as rows go past and do not depend on what was kept.
   */
  maxReportedErrors: number;
  /** Rows a preview returns as a sample. */
  sampleRows: number;

  // ── The clock ─────────────────────────────────────────────────────────────

  /** Milliseconds of silence on the request body before it is abandoned. Slowloris. */
  idleTimeoutMs: number;
  /** Milliseconds a whole request may take, however chatty it is. */
  totalTimeoutMs: number;
}

/**
 * Sized for "a large legitimate export", not for "the largest thing imaginable".
 *
 * 10 MB of xlsx is comfortably the fifty-thousand-row workbook that motivated the package;
 * `maxRows` is above it so the byte limit is the one a user meets first, and the row limit is
 * the backstop for a file that is mostly empty cells.
 */
export const DEFAULT_LIMITS: ImportLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxFields: 16,
  maxFieldBytes: 1024 * 1024,
  maxFieldNameBytes: 200,
  maxFiles: 1,

  maxRows: 200_000,
  maxColumns: 512,
  maxCellLength: 32_768,

  maxUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxZipEntries: 512,

  batchSize: 500,
  maxReportedErrors: 200,
  sampleRows: 5,

  idleTimeoutMs: 30_000,
  totalTimeoutMs: 10 * 60_000,
};

/**
 * Fill in what a caller left out.
 *
 * A non-finite or non-positive override falls back to the default rather than being accepted:
 * `maxBytes: 0` from a mis-parsed environment variable would otherwise disable every upload,
 * and `maxBytes: Infinity` would disable the guard — the two ways a configuration mistake
 * turns a limit off, both of which look deliberate in a diff.
 */
export function resolveLimits(overrides?: Partial<ImportLimits>): ImportLimits {
  const out = { ...DEFAULT_LIMITS };
  if (!overrides) return out;

  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ImportLimits)[]) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[key] = Math.floor(value);
    }
  }
  return out;
}
