/**
 * run-import.ts — a file in, records out, with memory bounded by `batchSize` and not by the file.
 *
 * Since 3.0 the runner is sheet-to-schema's (`sheet-to-schema/node`), which takes a schema
 * adapter. These are Dynamic Entity's signatures over it: a config, its rules and its lookups
 * in, and the same result out. The config becomes `entityFormConfigAdapter`, which is also
 * what a browser import runs on, so the two cannot disagree about what a file produces.
 *
 * Nothing here decides anything core already decides, and nothing here reads a row.
 */

import {
  arrayBoundFor,
  deriveImportColumns,
  entityFormConfigAdapter,
  planForConfig,
  suggestMapping,
  type AnyMappingPlan,
  type ConfigProblem,
  type CsvDelimiter,
  type DateOrder,
  type EntityFormConfig,
  type FormRule,
  type ImportLookups,
  type ImportRowError,
  type MappingPlan,
} from '@dynamic-entity/core';
import {
  previewSheet as previewOverAdapter,
  runImport as runOverAdapter,
  type BatchInfo as ImporterBatchInfo,
  type OnBatch as ImporterOnBatch,
} from 'sheet-to-schema/node';
import type { ByteSource } from './bytes';
import type { ImportLimits } from './limits';
import type { SheetFormat } from './read-sheet';

/** Where a batch sits in the user's spreadsheet, for a consumer that logs or reports progress. */
export type BatchInfo = ImporterBatchInfo;

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
export type OnBatch = ImporterOnBatch;

export interface RunImportOptions {
  stream: ByteSource;
  /** Display only. The format is decided by the file's first bytes, never by its name. */
  filename?: string;
  /** In either shape: plan v2, or a stored 2.x plan. */
  plan: AnyMappingPlan;
  config: EntityFormConfig;
  rules?: readonly FormRule[];
  /** Values for every `listName` the config mentions. A server has no `LOOKUP_REGISTRY`. */
  lookups?: ImportLookups;
  lang?: string;
  /**
   * The decimal mark in number cells. Defaults to `,` for a CSV that uses `;` between fields,
   * because that is what Excel writes in exactly those locales, and `.` otherwise.
   */
  decimal?: '.' | ',';
  /**
   * The order of a date written in digits, such as `05/09/2026`, for every column whose plan
   * entry states none. Without either, one that reads two ways fails its row: it is never
   * guessed. `MDY` reads it month first, as every release before 2.5.0 did without saying so.
   */
  dateOrder?: DateOrder;
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
   * Rows that produced at least one error, counted exactly — **not** derived from `errors`,
   * which is capped: the distinct rows in it say how many fitted in the cap, not how many
   * failed. The number a user acts on is "which rows do I fix", so it is the exact one.
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
   * What the file turned out to be — **absent when no byte of it was ever read**. A guessed
   * field is worse than a missing one: it is indistinguishable from a measured one.
   */
  format?: SheetFormat;
  /** Since 3.0: sheet rows the imported records came from. Equal to `imported` while no plan groups rows. */
  rowsInImported?: number;
  /** Since 3.0: a sample of the warnings, capped like `errors`. A record with a warning was imported. */
  warnings?: ImportRowError[];
  /** Since 3.0: every warning found, whether or not it was retained. */
  warningCount?: number;
}

/**
 * Run an import, or with no `onBatch` a validation: every row read, every error found.
 *
 * The plan is checked before a single row is read. A plan that groups rows is refused with
 * `INVALID_PLAN`: the streaming runner does not group yet, and one that ignored `group` would
 * import a record per row and report success. The browser import does group.
 */
export function runImport(options: RunImportOptions): Promise<ImportRunResult> {
  const { config } = options;
  return runOverAdapter({
    stream: options.stream,
    filename: options.filename,
    // A 2.x plan that names no entity is read against this config, as 2.x read it.
    plan: planForConfig(options.plan, config),
    adapter: entityFormConfigAdapter(config, { rules: options.rules, lookups: options.lookups }),
    ctx: { lang: options.lang },
    decimal: options.decimal,
    dateOrder: options.dateOrder,
    onBatch: options.onBatch,
    limits: options.limits,
  });
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
  /** Every inferred match is tagged `guess`. Plan v2 since 3.0. */
  suggestion: MappingPlan;
  /** Data rows in the file, which the whole stream is read to count. */
  rowCount: number;
  format: SheetFormat;
  /** The field separator a CSV uses. Absent for a workbook. */
  delimiter?: CsvDelimiter;
  /** Rows of each repeating field the suggestion was sized for — see `arrayBoundFor`. */
  arrayBound: number;
}

/**
 * The suggestion for a sheet's headers, and the rows of each repeating field it was sized for.
 *
 * **The same derivation the browser transport uses**, so the two suggest the same mapping for
 * the same file: sized from the headers, so a sheet with `Phone 6 Number` is offered six
 * rows, and without readonly and system-default fields, because nobody maps a column onto a
 * field the form fills in itself.
 */
export function suggestionFor(
  headers: readonly string[],
  config: EntityFormConfig,
  lang?: string,
): { suggestion: MappingPlan; arrayBound: number } {
  const arrayBound = arrayBoundFor(headers, config, null, lang);
  const { columns } = deriveImportColumns(config, { lang, maxArrayRows: arrayBound });
  return { suggestion: suggestMapping(headers, columns, config?.entity ?? ''), arrayBound };
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
  const preview = await previewOverAdapter({
    stream: options.stream,
    filename: options.filename,
    adapter: entityFormConfigAdapter(options.config, { includeReadonly: false, includeSystemDefault: false }),
    lang: options.lang,
    limits: options.limits,
  });
  return {
    headers: preview.headers,
    sample: preview.sample,
    rowCount: preview.rowCount,
    format: preview.format,
    ...(preview.delimiter ? { delimiter: preview.delimiter } : {}),
    ...suggestionFor(preview.headers, options.config, options.lang),
  };
}
