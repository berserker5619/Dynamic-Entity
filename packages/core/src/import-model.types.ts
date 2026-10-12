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

import type { MappingEntry as ImporterEntry, MappingPlan as ImporterPlan, RowProblemCode } from 'sheet-to-schema';
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
  /** The repeating parent's address with no row number, e.g. `work.contacts`. */
  arrayRef?: string;
  /** The repeating parent's label, resolved — what a sheet's own numbered headers start with. */
  arrayLabel?: string;
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
 * One target, and where its value comes from: a column, or a constant for every row.
 *
 * Since 3.0 this is sheet-to-schema's type. It is the 2.x entry with two optional v2 fields
 * added, `split` and `dateOrder`, so a 2.x entry is one.
 *
 * `column` is a **zero-based index**, not header text. A real sheet may have two columns both
 * headed "Notes", or a header that is blank; text cannot address the second of those and
 * silently resolves to the first. `header` rides along for display and for noticing that a
 * re-run's sheet has changed shape — it is never what the value is read by.
 *
 * `column` and `constant` are mutually exclusive, and an entry must have one of them.
 */
export type MappingEntry = ImporterEntry;

/**
 * A complete mapping from one sheet's columns onto one entity's fields: **plan v2**.
 *
 * Since 3.0 this is sheet-to-schema's type, and the one to write. It names its entity as
 * `target` and the config version as `schemaVersion`, says `planVersion: 2`, and may carry
 * `lists` and `group`. Everything that takes a plan also takes the 2.x shape, `MappingPlanV1`,
 * so a stored 2.x plan keeps importing as it is.
 *
 * Plain JSON with no functions and no class instances, deliberately: it is posted to a server,
 * stored, and re-run against next month's file.
 */
export type MappingPlan = ImporterPlan;

/**
 * The 2.x plan: `entity` and `configVersion` where plan v2 has `target` and `schemaVersion`.
 *
 * @deprecated Write `MappingPlan`. A stored plan of this shape is still read everywhere a plan
 * is taken, with no warning, and is saved as v2 the next time the mapper saves it. Reading it
 * is not what goes away; the name for writing it is.
 */
export interface MappingPlanV1 {
  entity: string;
  configVersion?: number;
  /** The headers this plan was authored against. */
  sourceHeaders?: string[];
  entries: MappingEntry[];
}

/** A plan in either shape, which is what every Dynamic Entity function that takes one accepts. */
export type AnyMappingPlan = MappingPlan | MappingPlanV1;

/**
 * One thing wrong with one cell of one row.
 *
 * `row` is the row's position in the source sheet, counting the header as row 1, so it is the
 * number the user sees in their spreadsheet's gutter. Reporting a zero-based index of the data
 * rows would be correct and useless.
 */
export interface ImportRowError {
  row: number;
  /** 3.0, on a record built from several rows: the sheet rows the problem came from, ascending. */
  rows?: number[];
  ref: string;
  column?: number;
  /**
   * 3.0: which check this is. Compare this, never `message`. Set on everything the engine
   * reports; optional so that code building its own row errors still compiles.
   */
  code?: RowProblemCode;
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
  /**
   * 3.0: what is worth saying about a record that was nevertheless imported, such as rows of
   * one group that disagree. Never counted as failures. Absent when there are none.
   */
  warnings?: ImportRowError[];
  /**
   * How many records were written when the transport did the writing and cannot hand them back.
   *
   * The in-browser transport returns every record in `records`, so this is absent there and
   * `records.length` is the count. A **server** transport streams — the whole reason it exists
   * — and returning fifty thousand records on the way out would undo that, so it reports a
   * number and leaves `records` empty. A caller wanting "how many" should read
   * `imported ?? records.length`; one wanting the records themselves is asking a question only
   * the local transport can answer.
   */
  imported?: number;
  /**
   * Failures found, when `errors` is only a sample of them.
   *
   * A streaming import caps what it retains — fifty thousand error objects is the same
   * unbounded growth as holding the file — so the count and the sample are different numbers
   * and both are reported. Absent means `errors` is complete.
   */
  errorCount?: number;
  /** `errors` is a sample rather than the whole set. */
  truncated?: boolean;
  /**
   * Rows that produced at least one error, when `errors` is only a sample of the reasons.
   *
   * Absent for an in-browser import, where `errors` is complete and the distinct rows in it are
   * the answer. Present for a streaming one, where counting the sample would report how many
   * rows fitted in the cap rather than how many failed.
   */
  failed?: number;
}
