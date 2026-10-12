/**
 * wire.types.ts — what crosses HTTP between a client and an import server (spec §9).
 *
 * Plain interfaces with no HTTP in them, for the same reason a `MappingPlan` is plain JSON:
 * the client and the server are separately deployed, and the shapes are the contract between
 * them. Moved from Dynamic Entity's `import-wire.types.ts`. Every field Dynamic Entity 2.x
 * sends is still here with its meaning; what v2 adds is optional, so a response from a 2.x
 * server still fits, and `planVersions` says which of the two it came from.
 */
import type { CsvDelimiter } from './csv';
import type { DateOrder } from './date-order';
import type { MappingPlan, PlanProblem } from './plan.types';
import type { ImportRowError } from './result.types';

/** Which adapter produced a response, so a client can tell when the two sides have moved apart. */
export interface AdapterStamp {
  /** The kind of adapter, e.g. `dynamic-entity` or `json-schema`. */
  name: string;
  /** The adapter implementation's semver. Compared at its major. */
  version: string;
}

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
   * Rows of each repeating field the suggestion was sized for, as one number for all of them.
   * Dynamic Entity's servers send it. Absent from one older than 2.3, which always sized for 3.
   */
  arrayBound?: number;
  /** v2: slots per array the suggestion was sized for, keyed by array ref (§6). */
  slots?: Record<string, number>;
  /** The field separator a CSV upload turned out to use. Absent for a workbook. */
  delimiter?: CsvDelimiter;
  /**
   * The order this server reads a date written in digits in, when a plan entry does not say.
   * Absent when it states none. A client reads its review sample with this, and must not
   * commit when it was itself told a different order.
   */
  dateOrder?: DateOrder;
  /**
   * The plan versions this server reads. Absent means `[1]`: a server from before plan v2.
   *
   * Not a warning when it differs: a plan using a v2-only feature MUST NOT be committed to a
   * server that does not list `2`, because a server that ignores `group` imports one record
   * per row and reports success (§4, "Talking to an older server").
   */
  planVersions?: number[];
  /**
   * The importer's version on the machine that produced this.
   *
   * The browser's engine and the server's are separately deployed and may differ. A client
   * compares this with its own, at major.minor, to notice that the two halves have moved
   * apart. A mismatch is a warning, not a refusal: a patch release is not a reason to stop
   * someone importing.
   */
  engineVersion: string;
  /** v2: the adapter on the machine that produced this. A mismatch at its major is a warning. */
  adapter?: AdapterStamp;
}

/**
 * What an import or a validation pass answers with.
 *
 * **The records are not here, and their absence is the feature.** A server-side import exists
 * because the file does not fit in memory; handing back fifty thousand records would undo
 * that on the way out. `imported` is the count, and where the records went is the consumer's
 * writer to know.
 */
export interface ImportCommitResponse {
  /**
   * Whether the records were **stored**. `/import` writes and reports `true`; `/validate`
   * runs the identical pipeline and reports `false`. Without it the two routes answer with
   * byte-identical bodies, and `imported`, a count of records *produced*, reads as a count of
   * records *written* on the one route where nothing was.
   */
  written: boolean;
  /** Records produced by the run. */
  imported: number;
  /** Rows that held no values at all. A blank line is not an error and is not a record. */
  skipped: number;
  /**
   * Rows that produced at least one error, counted exactly, **not** derived from `errors`,
   * which is a capped sample.
   */
  failed: number;
  /**
   * Data rows read from the sheet, blank ones included, so the counts reconcile:
   * `imported + skipped + failed === rowsRead` when no plan groups rows.
   */
  rowsRead: number;
  /** v2: sheet rows the imported records came from. Equal to `imported` without grouping. */
  rowsInImported?: number;
  /** A **sample** of the failures, capped by the server's `maxReportedErrors`. */
  errors: ImportRowError[];
  /** Every failure found, whether or not it was retained. */
  errorCount: number;
  /** `errors` is shorter than `errorCount`. */
  truncated: boolean;
  /** v2: a sample of the warnings. A record with a warning was imported. */
  warnings?: ImportRowError[];
  /** v2: every warning found, whether or not it was retained. */
  warningCount?: number;
  /** What is wrong with the plan itself. An `error` here means nothing was imported. */
  planProblems: PlanProblem[];
  /** See `ImportPreviewResponse.engineVersion`. */
  engineVersion: string;
  /** See `ImportPreviewResponse.adapter`. */
  adapter?: AdapterStamp;
}

/**
 * What a failing request answers with.
 *
 * A code and a message the library wrote, and nothing from below it: no stack, no filesystem
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
