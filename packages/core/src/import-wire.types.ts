/**
 * import-wire.types.ts — the shapes an import crosses a network in.
 *
 * **In core, and not in either package that uses them.** A server writes them and a browser
 * reads them, and core is the only thing both sides already depend on — so putting them in
 * `@dynamic-entity/server` would make the Angular package depend on a Node package to describe
 * a JSON body, and putting them in the Angular package would be worse still.
 *
 * Plain interfaces with no HTTP in them, for the same reason `MappingPlan` is plain JSON: a
 * shape that only survives one transport is a shape that quietly stops being true the first
 * time someone puts it behind a queue, a Lambda, or a framework that is not Express.
 */

import type { ImportRowError, MappingPlan } from './import-model.types';
import type { ConfigProblem } from './validate-config';

/** What a first look at an uploaded file answers with. */
export interface ImportPreviewResponse {
  headers: string[];
  /** The first few rows as text, for the mapping screen to show under each column. */
  sample: string[][];
  /** Where the suggester got to. Every inferred match is tagged `guess`. */
  suggestion: MappingPlan;
  /** Data rows in the file, which may be far more than `sample` holds. */
  rowCount: number;
  /**
   * `CORE_VERSION` on the machine that produced this.
   *
   * The browser's engine and the server's are separately deployed and may differ.
   * `MappingPlan.configVersion` catches config drift and says nothing about engine drift, so
   * this is what a client compares against its own to notice that the two halves have moved
   * apart. A mismatch is a warning, not a refusal: a patch release is not a reason to stop
   * someone importing.
   */
  engineVersion: string;
}

/**
 * What an import or a validation pass answers with.
 *
 * **The records are not here, and their absence is the feature.** A server-side import exists
 * because the file does not fit in memory; handing back fifty thousand records would undo
 * that on the way out. `imported` is the count, and where the records went is the consumer's
 * `onImport` to know.
 */
export interface ImportCommitResponse {
  /**
   * Whether the records were **stored**.
   *
   * `/import` writes and reports `true`; `/validate` runs the identical pipeline and reports
   * `false`. Without it the two routes answer with byte-identical bodies, and `imported` — a
   * count of records *produced* — reads as a count of records *written* on the one route where
   * nothing was. The field name is the contract, so the contract needs this beside it.
   */
  written: boolean;
  /**
   * Records produced by the run.
   *
   * On `/import` these were handed to the consumer's writer. On `/validate` they were built,
   * checked and dropped — see `written`.
   */
  imported: number;
  /** Rows that held no values at all. A blank line is not an error and is not a record. */
  skipped: number;
  /**
   * Rows that produced at least one error, counted exactly — **not** derived from `errors`.
   *
   * `errors` is a capped sample, so counting the distinct rows in it answers a different and
   * much smaller question. A run of a thousand rows where two hundred failed reported seven,
   * because seven was how many distinct rows fitted in the first twenty retained problems. The
   * number a user acts on is "which rows do I go and fix", so it is the one that has to be
   * exact.
   */
  failed: number;
  /**
   * Data rows read from the sheet, blank ones included.
   *
   * Here so the counts reconcile: `imported + skipped + failed === rowsRead`. Without it a
   * caller who expected four hundred records and got three hundred and ninety-seven has no way
   * to find out where the other three went, which is the whole reason `skipped` exists.
   */
  rowsRead: number;
  /** A **sample** of the failures, capped by the server's `maxReportedErrors`. */
  errors: ImportRowError[];
  /** Every failure found, whether or not it was retained. */
  errorCount: number;
  /** `errors` is shorter than `errorCount`. */
  truncated: boolean;
  /** What is wrong with the plan itself. An `error` here means nothing was imported. */
  planProblems: ConfigProblem[];
  /** See `ImportPreviewResponse.engineVersion`. */
  engineVersion: string;
}

/**
 * What a failing request answers with.
 *
 * A code and a message the library wrote, and nothing from below it — no stack, no filesystem
 * path, no parser internals. A client that has to match on message text is a client that
 * breaks when the text improves, which is why `code` is there and is closed.
 */
export interface ImportErrorResponse {
  error: {
    code: string;
    message: string;
    /** Present only for a rejected mapping plan: the caller's own plan, described back. */
    details?: unknown;
  };
}
