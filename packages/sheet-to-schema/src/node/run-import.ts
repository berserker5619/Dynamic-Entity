/**
 * run-import.ts — a file in, records out, with memory bounded by `batchSize` and not by the file.
 *
 * Moved from Dynamic Entity's server, with the config taken out: it takes a `SchemaAdapter`
 * and the context that adapter wants, and runs the main entry's `applyMapping` over each batch.
 * So a row is read by the same engine here and in a browser, and the two cannot disagree
 * about what a file produces.
 *
 * What this adds to the engine is what a file too large to hold needs:
 * - rows are pulled a batch at a time, and the next batch is not pulled until `onBatch` has
 *   finished with this one, which is the backpressure;
 * - errors are counted exactly and retained up to `maxReportedErrors`, since a file where
 *   every row fails is otherwise as large as the file;
 * - the plan is checked before a single row is read.
 *
 * **Grouping is not here yet.** A grouped record can span a batch boundary, and the streaming
 * form of spec §5 (an open group carried across it, with `maxGroupRows`, `maxGroups` and
 * `maxGroupKeyBytes`) is Phase 3. Until then a plan with `group` is refused before a row is
 * read, with a message that says so. The in-memory `applyMapping` does group.
 */

import {
  applyMapping,
  cellText,
  decimalMarkFor,
  preparePlan,
  slotsFor,
  suggestMapping,
  type CsvDelimiter,
  type ImportRowError,
  type MappingPlan,
  type PlanProblem,
  type SchemaAdapter,
} from 'sheet-to-schema';
import { destroySource, type ByteSource } from './bytes';
import { ImportError } from './errors';
import { resolveLimits, type ImportLimits } from './limits';
import { readSheet, type SheetFormat } from './read-sheet';

/** Where a batch sits in the user's spreadsheet, for a consumer that logs or reports progress. */
export interface BatchInfo {
  /** Zero-based batch number. */
  index: number;
  /** Spreadsheet row number of the first row this batch was built from. */
  firstRow: number;
  /** Records handed over before this batch, so `imported + records.length` is the running total. */
  imported: number;
}

/**
 * Write a batch of records.
 *
 * **It is awaited, and that is load-bearing.** A consumer writing to a database is slower than
 * a parser reading a file; not awaiting would turn bounded memory into an unbounded queue of
 * pending writes, the exact failure this exists to avoid, reached from the other direction.
 *
 * **It must be idempotent.** A stream that fails at row 30,000 has already written 29,999
 * records, and an HTTP client, or a proxy, or a user, will retry.
 */
export type OnBatch = (records: Record<string, unknown>[], info: BatchInfo) => void | Promise<void>;

export interface RunImportOptions<TMeta = unknown, TCtx = unknown> {
  stream: ByteSource;
  /** Display only, and a delimiter hint. The format is decided by the file's first bytes, never by its name. */
  filename?: string;
  /** A plan as it arrived: v1 or v2, read and checked here before any row is. */
  plan: unknown;
  adapter: SchemaAdapter<TMeta, TCtx>;
  /** Handed to the adapter's `coerce`, `finalize` and `validate` for every row of the run. */
  ctx: TCtx;
  /**
   * The decimal mark in number cells. Defaults to `,` for a CSV that uses `;` between fields,
   * because that is what Excel writes in exactly those locales, and `.` otherwise.
   */
  decimal?: '.' | ',';
  /** Omit to validate without writing: the identical pipeline, every error, nothing stored. */
  onBatch?: OnBatch;
  limits?: Partial<ImportLimits>;
}

export interface ImportRunResult {
  /**
   * Records the run produced, and therefore, when `onBatch` was supplied, how many were
   * handed over to be written. The records themselves are deliberately not here: returning
   * fifty thousand of them would undo the streaming this whole file is for.
   */
  imported: number;
  /** Rows that held no values at all. A blank line is not an error and is not a record. */
  skipped: number;
  /**
   * Rows that produced at least one error, counted exactly, **not** derived from `errors`,
   * which is capped: the distinct rows in it say how many fitted in the cap, not how many failed.
   */
  failed: number;
  /** Sheet rows the imported records came from. Equal to `imported` until grouping lands. */
  rowsInImported: number;
  /** A **sample**, capped at `limits.maxReportedErrors`. `errorCount` is the true total. */
  errors: ImportRowError[];
  /** Every problem found, whether or not it was retained. */
  errorCount: number;
  /** `errors` is shorter than `errorCount`. */
  truncated: boolean;
  /** A sample of the warnings, capped like `errors`. A record with a warning was imported. */
  warnings: ImportRowError[];
  /** Every warning found, whether or not it was retained. */
  warningCount: number;
  /** What is wrong with the plan itself. An `error` here means no row was read at all. */
  planProblems: PlanProblem[];
  /** Data rows read from the sheet, blank ones included. */
  rowsRead: number;
  /**
   * What the file turned out to be, **absent when no byte of it was ever read**. A plan
   * refused before the stream is touched has nothing to report here, and a guessed field is
   * worse than a missing one: it is indistinguishable from a measured one.
   */
  format?: SheetFormat;
}

/** What a server tells a client whose plan groups rows, until the streaming runner can. */
export const GROUPING_NOT_STREAMED =
  'This server version does not group rows into records yet. The browser import does: import this file there, or remove "group" from the plan.';

export async function runImport<TMeta, TCtx>(options: RunImportOptions<TMeta, TCtx>): Promise<ImportRunResult> {
  const limits = resolveLimits(options.limits);
  const { adapter, ctx, onBatch } = options;

  // The plan is checked before a single row is read. A plan naming a field the schema does
  // not have is wrong about every row, so discovering it at row 30,000 of a file that has
  // already written 29,999 records is the worst available moment.
  const prepared = preparePlan(options.plan, adapter);
  if (!prepared.plan) {
    // Nothing was read, so nothing needs unwinding, but the request body is still open, and
    // an undrained socket is a leaked handle.
    destroySource(options.stream);
    return {
      imported: 0,
      skipped: 0,
      failed: 0,
      rowsInImported: 0,
      errors: [],
      errorCount: 0,
      truncated: false,
      warnings: [],
      warningCount: 0,
      planProblems: prepared.problems,
      rowsRead: 0,
    };
  }

  if (prepared.plan.group) {
    // Refused, not ignored: a runner that ignored `group` would import one record per row
    // and report success (spec §4, "Talking to an older server").
    destroySource(options.stream);
    const problem: PlanProblem = { level: 'error', code: 'PLAN_GROUP', path: 'group', message: GROUPING_NOT_STREAMED };
    throw new ImportError('INVALID_PLAN', GROUPING_NOT_STREAMED, { details: [...prepared.problems, problem] });
  }

  const sheet = await readSheet({ stream: options.stream, filename: options.filename, limits });

  const decimal = options.decimal ?? decimalMarkFor(sheet.delimiter);
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];
  let errorCount = 0;
  let warningCount = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let rowsRead = 0;
  let batchIndex = 0;

  let batch: unknown[][] = [];
  /** The spreadsheet row number of `batch[0]`. The header is row 1. */
  let firstRow = 2;

  /** Retained, not accumulated: a file where every row fails is as many objects as the file has rows. */
  const retain = (kept: ImportRowError[], found: readonly ImportRowError[]): void => {
    for (const problem of found) {
      if (kept.length >= limits.maxReportedErrors) break;
      kept.push(problem);
    }
  };

  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];

    // The plan as `preparePlan` left it: read, upgraded and checked once, above.
    const result = applyMapping(rows, prepared.plan, adapter, ctx, { decimal, firstRowNumber: firstRow });

    skipped += result.skipped;
    errorCount += result.errors.length;
    warningCount += result.warnings?.length ?? 0;
    // Rows, not problems: one row failing two checks is one row to go and fix. No row spans
    // a batch while grouping is refused, so the per-batch counts add up exactly.
    failed += result.failed ?? 0;
    retain(errors, result.errors);
    retain(warnings, result.warnings ?? []);

    if (result.records.length && onBatch) {
      const info: BatchInfo = { index: batchIndex, firstRow, imported };
      try {
        // Awaited before the next batch is pulled. This is the backpressure.
        await onBatch(result.records, info);
      } catch (cause) {
        throw new ImportError(
          'IMPORT_FAILED',
          'The import stopped partway through. Rows before the failure may already have ' +
            'been written — this import is not transactional.',
          { cause },
        );
      }
    }

    imported += result.records.length;
    firstRow += rows.length;
    batchIndex++;
  };

  try {
    for await (const row of sheet.rows) {
      rowsRead++;
      batch.push(row as unknown[]);
      if (batch.length >= limits.batchSize) await flush();
    }
    await flush();
  } catch (error) {
    // A failure anywhere — a limit, a malformed file, the consumer's own writer — leaves the
    // request body half-read. Destroying it is what stops a hostile uploader from holding a
    // socket open after the guard that refused them has already fired.
    destroySource(options.stream);
    throw error;
  }

  return {
    imported,
    skipped,
    failed,
    rowsInImported: imported,
    errors,
    errorCount,
    truncated: errorCount > errors.length,
    warnings,
    warningCount,
    planProblems: prepared.problems,
    rowsRead,
    format: sheet.format,
  };
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export interface PreviewSheetOptions<TMeta = unknown, TCtx = unknown> {
  stream: ByteSource;
  filename?: string;
  adapter: SchemaAdapter<TMeta, TCtx>;
  /** The language the adapter resolves its labels in, for the suggestion. */
  lang?: string;
  limits?: Partial<ImportLimits>;
}

/** What a first look at an uploaded file yields. */
export interface SheetPreview {
  headers: string[];
  /** The first few rows as text, for the mapping screen to show under each column. */
  sample: string[][];
  /** Every inferred match is tagged `guess`. */
  suggestion: MappingPlan;
  /** Data rows in the file, which the whole stream is read to count. */
  rowCount: number;
  format: SheetFormat;
  /** The field separator a CSV uses. Absent for a workbook. */
  delimiter?: CsvDelimiter;
  /** Slots of each array the suggestion was sized for, by array ref (`slotsFor`). */
  slots: Record<string, number>;
}

/**
 * Headers, a sample, and a suggested mapping.
 *
 * The whole file is read, because `rowCount` is a number the user is shown before they commit
 * and "about this many" is not a useful thing to tell someone about their own data. Reading it
 * also means every limit applies to a preview exactly as it applies to an import: a preview
 * endpoint that skipped them would be the cheapest way in.
 *
 * The suggestion is made from the headers alone, which is what a browser makes of them. It is
 * not given the sample rows: with them it would propose a group (spec §8), and `runImport`
 * here refuses a grouped plan until Phase 3.
 */
export async function previewSheet<TMeta, TCtx>(options: PreviewSheetOptions<TMeta, TCtx>): Promise<SheetPreview> {
  const limits = resolveLimits(options.limits);
  const sheet = await readSheet({ stream: options.stream, filename: options.filename, limits });

  const sample: string[][] = [];
  let rowCount = 0;

  try {
    for await (const row of sheet.rows) {
      rowCount++;
      if (sample.length < limits.sampleRows) sample.push(row.map(cellText));
    }
  } catch (error) {
    destroySource(options.stream);
    throw error;
  }

  return {
    headers: sheet.headers,
    sample,
    rowCount,
    suggestion: suggestMapping(sheet.headers, options.adapter, { lang: options.lang }),
    format: sheet.format,
    ...(sheet.delimiter ? { delimiter: sheet.delimiter } : {}),
    slots: slotsFor(sheet.headers, options.adapter, undefined, { lang: options.lang }),
  };
}
