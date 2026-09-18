/**
 * run-import.ts — the package, really. Everything else is plumbing around this file.
 *
 * `runImport` pulls rows off the reader in batches, hands each batch to core's `applyMapping`,
 * **awaits** `onBatch`, and drops the batch. Peak memory is a function of `batchSize`, not of
 * the file's size — which is the one reason this package exists, and the claim every decision
 * below is answerable against.
 *
 * Nothing here decides anything core already decides. The mapping rules, the coercion, the
 * validation and the record shape all come from `applyMapping`; this file's entire job is to
 * feed it and to not accumulate.
 */

import {
  applyMapping,
  deriveImportColumns,
  suggestMapping,
  validateMappingPlan,
  type ConfigProblem,
  type EntityFormConfig,
  type FormRule,
  type ImportLookups,
  type ImportRowError,
  type MappingPlan,
} from '@dynamic-entity/core';
import { destroySource, type ByteSource } from './bytes';
import { sampleText } from './cell-text';
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
 * pending writes — the exact failure this package exists to avoid, reached from the other
 * direction.
 *
 * **It must be idempotent.** A stream that fails at row 30,000 has already written 29,999
 * records, and an HTTP client — or a proxy, or a user — will retry. See SECURITY.md.
 */
export type OnBatch = (
  records: Record<string, unknown>[],
  info: BatchInfo,
) => void | Promise<void>;

export interface RunImportOptions {
  stream: ByteSource;
  /** Display only. The format is decided by the file's first bytes, never by its name. */
  filename?: string;
  plan: MappingPlan;
  config: EntityFormConfig;
  rules?: readonly FormRule[];
  /** Values for every `listName` the config mentions. A server has no `LOOKUP_REGISTRY`. */
  lookups?: ImportLookups;
  lang?: string;
  /** Omit to validate without writing: the identical pipeline, every error, nothing stored. */
  onBatch?: OnBatch;
  limits?: Partial<ImportLimits>;
}

export interface ImportRunResult {
  /**
   * Records the run produced — and therefore, when `onBatch` was supplied, how many were
   * handed over to be written. The records themselves are deliberately not here: returning
   * fifty thousand of them would undo the streaming this whole file is for.
   */
  imported: number;
  /** Rows that held no values at all. A blank line is not an error and is not a record. */
  skipped: number;
  /**
   * Rows that produced at least one error, counted exactly — **not** derived from `errors`.
   *
   * `errors` is capped, so counting the distinct rows in it answers how many rows fitted in the
   * cap rather than how many failed. Measured on a run of a thousand rows where two hundred
   * failed: the sample held seven of them. The number a user acts on is "which rows do I fix",
   * so it is the one that has to be exact.
   *
   * Row numbers never span a batch, so summing the per-batch distinct counts is exact rather
   * than approximate.
   */
  failed: number;
  /** A **sample**, capped at `limits.maxReportedErrors`. `errorCount` is the true total. */
  errors: ImportRowError[];
  /** Every problem found, whether or not it was retained. */
  errorCount: number;
  /** `errors` is shorter than `errorCount`. */
  truncated: boolean;
  /** What is wrong with the plan itself. An `error` here means no row was read at all. */
  planProblems: ConfigProblem[];
  /** Data rows read from the sheet, blank ones included. */
  rowsRead: number;
  /**
   * What the file turned out to be — **absent when no byte of it was ever read**.
   *
   * A plan refused before the stream is touched has nothing to report here, and it used to
   * report `'csv'` anyway. A guessed field is worse than a missing one: it is indistinguishable
   * from a measured one.
   */
  format?: SheetFormat;
}

/**
 * Check the plan before a single row is read.
 *
 * A plan naming a field the config does not have is wrong about every row, so discovering it
 * at row 30,000 of a file that has already written 29,999 records is the worst available
 * moment. `applyMapping` checks it too — per batch, on its own account — and this is not that
 * check moved but that check brought forward.
 */
function checkPlan(plan: MappingPlan, config: EntityFormConfig, lang?: string): ConfigProblem[] {
  return validateMappingPlan(plan, config, {
    lang,
    // The same derivation `applyMapping` uses, or the two would disagree about which refs
    // exist and the pre-flight would pass a plan the run then rejects.
    includeReadonly: true,
    includeSystemDefault: true,
  });
}

export async function runImport(options: RunImportOptions): Promise<ImportRunResult> {
  const limits = resolveLimits(options.limits);
  const { plan, config, onBatch } = options;

  const planProblems = checkPlan(plan, config, options.lang);
  if (planProblems.some(problem => problem.level === 'error')) {
    // Nothing was read, so nothing needs unwinding — but the request body is still open, and
    // an undrained socket is a leaked handle.
    destroySource(options.stream);
    return {
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      errorCount: 0,
      truncated: false,
      planProblems,
      rowsRead: 0,
    };
  }

  const sheet = await readSheet({
    stream: options.stream,
    filename: options.filename,
    limits,
  });

  const errors: ImportRowError[] = [];
  let errorCount = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let rowsRead = 0;
  let batchIndex = 0;

  let batch: unknown[][] = [];
  /** The spreadsheet row number of `batch[0]`. The header is row 1. */
  let firstRow = 2;

  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];

    const result = applyMapping(rows, plan, config, {
      lang: options.lang,
      rules: options.rules,
      lookups: options.lookups,
      firstRowNumber: firstRow,
    });

    skipped += result.skipped;
    errorCount += result.errors.length;
    // Distinct rows, not problems: one row failing two validators is one row to go and fix.
    failed += new Set(result.errors.map(error => error.row)).size;
    // Retained, not accumulated. A file where every row fails is fifty thousand error objects
    // otherwise, which is the same unbounded growth as holding the file.
    for (const error of result.errors) {
      if (errors.length >= limits.maxReportedErrors) break;
      errors.push(error);
    }

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
    errors,
    errorCount,
    truncated: errorCount > errors.length,
    planProblems,
    rowsRead,
    format: sheet.format,
  };
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export interface PreviewSheetOptions {
  stream: ByteSource;
  filename?: string;
  config: EntityFormConfig;
  lang?: string;
  limits?: Partial<ImportLimits>;
}

/** What a first look at an uploaded file yields. Matches the renderer's `ImportPreview`. */
export interface SheetPreview {
  headers: string[];
  /** The first few rows as text, for the mapping screen to show under each column. */
  sample: string[][];
  /** Every inferred match is tagged `guess`. */
  suggestion: MappingPlan;
  /** Data rows in the file, which the whole stream is read to count. */
  rowCount: number;
  format: SheetFormat;
}

/**
 * Headers, a sample, and a suggested mapping.
 *
 * The whole file is read, because `rowCount` is a number the user is shown before they commit
 * and "about this many" is not a useful thing to tell someone about their own data. Reading it
 * also means every limit applies to a preview exactly as it applies to an import — a preview
 * endpoint that skipped them would be the cheapest way in.
 */
export async function previewSheet(options: PreviewSheetOptions): Promise<SheetPreview> {
  const limits = resolveLimits(options.limits);
  const sheet = await readSheet({
    stream: options.stream,
    filename: options.filename,
    limits,
  });

  const sample: string[][] = [];
  let rowCount = 0;

  try {
    for await (const row of sheet.rows) {
      rowCount++;
      if (sample.length < limits.sampleRows) sample.push(row.map(sampleText));
    }
  } catch (error) {
    destroySource(options.stream);
    throw error;
  }

  // The same derivation the browser transport uses, so the two suggest the same mapping for
  // the same file. Readonly and system-default fields stay out of a *suggestion* for the same
  // reason they are marked: nobody maps a column onto a field the form fills in itself.
  const { columns } = deriveImportColumns(options.config, { lang: options.lang });

  return {
    headers: sheet.headers,
    sample,
    rowCount,
    suggestion: suggestMapping(sheet.headers, columns, options.config?.entity ?? ''),
    format: sheet.format,
  };
}
