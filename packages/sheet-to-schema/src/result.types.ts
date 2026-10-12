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
  /** The first of `rows`: the row the record started on, or the row of the cell. The header is row 1. */
  row: number;
  /**
   * v2, on a grouped record: the sheet rows the problem came from, ascending. Every row of the
   * record for a problem with the record as a whole; the cell's own row for a cell that could
   * not be read, or every row the same cell problem occurred on; and for rows that disagree,
   * the row the value was kept from, then each row carrying the other value.
   */
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
