/**
 * import-model.types.ts — the contracts for turning a spreadsheet into records.
 *
 * Three shapes, and the boundaries between them are the point:
 *
 *   `ImportColumn`  — what a config says a sheet *may* contain. Derived, never authored.
 *   `MappingPlan`   — what a user says their sheet *does* contain. Authored, persisted,
 *                     and the only one of the three that crosses a network.
 *   `ImportResult`  — what came out, including every row that failed and why.
 *
 * `MappingPlan` is plain JSON with no functions and no class instances, deliberately: it is
 * posted to a server, stored, and re-run against next month's file. Anything in it that could
 * not survive `JSON.parse(JSON.stringify(x))` would be a plan that works in the browser and
 * silently degrades everywhere else.
 */

import type { NestedFieldConfig } from './form-model.types';
import type { ConfigProblem } from './validate-config';

/**
 * One column a sheet may carry for a config, derived from the config alone.
 *
 * `ref` is the field's address in the record — the same dotted string `refOf` produces, and
 * the same one a rule names. There is one address language in this library, not two.
 */
export interface ImportColumn {
  /** Dot-path address in the record, e.g. `work.address` or `contacts.0.email`. */
  ref: string;
  /** Dotted path of the containing scope, or `ROOT_SCOPE`. */
  scope: string;
  field: NestedFieldConfig;
  /** Suggested header text for a generated template. */
  header: string;
  required: boolean;
  /** Resolved option labels for `dropdown` / `radio` / `multiSelect`. */
  enumValues?: string[];
  /** Human format hint for the template's help row, e.g. `YYYY-MM-DD`. */
  format?: string;
  /** Index within the repeating parent, for a column produced by an `array` field. */
  arrayIndex?: number;
}

/**
 * A field the config declares but a sheet cannot carry, with the reason.
 *
 * Reported rather than dropped. An `image` field silently missing from a generated template
 * looks identical to one nobody thought to include, and the user finds out when the import
 * they believed was complete turns out not to be.
 */
export interface UnsupportedColumn {
  ref: string;
  field: NestedFieldConfig;
  reason: string;
}

/** Every column a config offers, plus the ones it cannot offer and why. */
export interface DerivedColumns {
  columns: ImportColumn[];
  unsupported: UnsupportedColumn[];
}

/**
 * One target column, and where its value comes from.
 *
 * `column` is a **zero-based index**, not header text. A real sheet may have two columns both
 * headed "Notes", or a header that is blank; text cannot address the second of those and
 * silently resolves to the first. `header` rides along for display and for noticing that a
 * re-run's sheet has changed shape — it is never what the value is read by.
 *
 * `column` and `constant` are mutually exclusive, and an entry must have one of them. A target
 * with no entry at all is simply unmapped, which is why `column` is optional rather than
 * nullable: `null` would have had to mean both "unmapped" and "has a constant instead".
 */
export interface MappingEntry {
  /** Target field address. At most one entry per `ref` in a plan. */
  ref: string;
  /** Zero-based column index in the source sheet. */
  column?: number;
  /** Header text at `column` when the plan was authored. Display and drift detection only. */
  header?: string;
  /** A literal applied to every row, for a field the sheet does not carry. */
  constant?: unknown;
  /** `guess` marks a match the suggester inferred rather than read. */
  confidence?: 'exact' | 'guess';
}

/**
 * A complete mapping from one sheet's columns onto one entity's fields.
 *
 * `configVersion` and `sourceHeaders` are both snapshots taken when the plan was authored, so
 * re-running a stored plan can say "the config has moved on" or "this file's columns are not
 * the ones you mapped" rather than quietly importing into the wrong fields.
 */
export interface MappingPlan {
  entity: string;
  configVersion?: number;
  /** The headers this plan was authored against. */
  sourceHeaders?: string[];
  entries: MappingEntry[];
}

/**
 * One thing wrong with one cell of one row.
 *
 * `row` is the row's position in the source sheet, counting the header as row 1, so it is the
 * number the user sees in their spreadsheet's gutter. Reporting a zero-based index of the data
 * rows would be correct and useless.
 */
export interface ImportRowError {
  row: number;
  ref: string;
  column?: number;
  message: string;
  raw?: unknown;
}

/**
 * The outcome of an import.
 *
 * `records` holds only the rows that produced a usable record; a row with any error is not in
 * it. `skipped` counts rows that held no values at all — a blank line in the middle of a sheet
 * is not an error and should not be reported as one, but a user who expected 400 records and
 * got 397 deserves to see where the other three went.
 */
export interface ImportResult {
  records: Record<string, unknown>[];
  errors: ImportRowError[];
  skipped: number;
  /**
   * What is wrong with the plan itself, rather than with any row.
   *
   * An `error` here means **nothing was imported**: a plan naming a field the config does not
   * have is wrong about every row, and importing whichever of its columns happened to resolve
   * is how a sheet loses a column while reporting success. Warnings — a plan authored against
   * an older config version, or naming another entity — do not stop the import.
   */
  planProblems: ConfigProblem[];
}
