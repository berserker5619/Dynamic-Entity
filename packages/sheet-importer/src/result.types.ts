/**
 * result.types.ts — what an import returns (spec §9).
 *
 * Shaped so a Dynamic Entity 2.x consumer still compiles: `ref` stays required, and every
 * field v2 adds is optional on the type, because code that *builds* a result (a custom
 * transport) must keep compiling too. The engine always sets them.
 */
import type { PlanProblem } from './plan.types';
import type { RowProblemCode } from './problem-codes';

/** One thing wrong with, or worth saying about, one record. */
export interface ImportRowError {
  /** The sheet row the record started on, counting the header as row 1. */
  row: number;
  /** v2: every sheet row of a grouped record, ascending. */
  rows?: number[];
  /** The target ref, or `''` for a problem that belongs to the whole record. */
  ref: string;
  column?: number;
  /** v2: compare this, never `message`. Set on everything the engine emits. */
  code?: RowProblemCode;
  message: string;
  raw?: unknown;
}

export interface ImportResult {
  records: Record<string, unknown>[];
  /** Errors only: every row here is a failed row. */
  errors: ImportRowError[];
  /** v2: never fail a record and are never counted as failed. */
  warnings?: ImportRowError[];
  /** Sheet rows that held no values at all. */
  skipped: number;
  planProblems: PlanProblem[];
  /** v2: sheet rows read. */
  rowsRead?: number;
  /** v2: records produced. */
  imported?: number;
  /** v2: sheet rows those records came from (equal to `imported` without grouping). */
  rowsInImported?: number;
  /** v2: sheet rows with an error. `rowsInImported + skipped + failed === rowsRead`. */
  failed?: number;
}
