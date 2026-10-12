/**
 * import-engine.ts — flat spreadsheet rows in, nested records out.
 *
 * The governing constraint for everything here: **an imported record must be
 * indistinguishable from one the form would have produced and accepted.** That is why
 * validation runs the rules engine rather than only the field validators, why a `dropdown`
 * cell becomes the option *object* rather than the text that was typed, and why records are
 * stamped with the config version on the way out.
 *
 * Since 3.0 the loop that turns rows into records is sheet-to-schema's, and so is the
 * suggester. What makes the result a Dynamic Entity record is in `import-internals.ts`, which
 * this file re-exports unchanged, and reaches the engine through `entityFormConfigAdapter`.
 * `applyMapping` and `suggestMapping` keep the signatures they had.
 *
 * Pure and I/O-free, so the same functions run in a browser tab and in a server's stream
 * handler.
 */

import {
  applyMapping as applyOverAdapter,
  suggestMapping as suggestOverAdapter,
  type ImportTarget,
  type SchemaAdapter,
  type TargetArray,
} from 'sheet-to-schema';
import { entityFormConfigAdapter } from './entity-form-config-adapter';
import { resolveLabel } from './form-logic';
import type { EntityFormConfig } from './form-model.types';
import { planFor } from './import-columns';
import type { CoerceOptions, ValidateRecordOptions } from './import-internals';
import type { AnyMappingPlan, ImportColumn, ImportResult, MappingPlan } from './import-model.types';

export * from './import-internals';

/**
 * Derived columns as the adapter the suggester reads.
 *
 * `suggestMapping` is given columns, already unrolled to however many rows its caller chose,
 * and not a config. So the columns are the targets, whatever slots are asked for, and each
 * array is offered exactly the rows it was derived with.
 */
function columnsAdapter(columns: readonly ImportColumn[], entity: string): SchemaAdapter<ImportColumn> {
  const targets: ImportTarget<ImportColumn>[] = columns.map(column => {
    const label = resolveLabel(column.field.label) || '';
    const inArray = column.arrayRef !== undefined && column.arrayIndex !== undefined;
    return {
      ref: column.ref,
      // The slot sits at the array's own boundary: `work.contacts.1.email`.
      shapeRef: inArray
        ? `${column.arrayRef}${column.ref.slice((column.arrayRef as string).length + 1 + String(column.arrayIndex).length)}`
        : column.ref,
      header: column.header,
      matchKeys: label ? [label, column.field.id] : [column.field.id],
      required: column.required,
      value: { kind: 'custom' },
      ...(inArray ? { arrayRef: column.arrayRef, arrayIndex: column.arrayIndex } : {}),
      ...(inArray && column.arrayLabel ? { arrayLabel: column.arrayLabel } : {}),
      meta: column,
    };
  });
  const arrays: TargetArray[] = [...new Set(columns.flatMap(column => (column.arrayRef === undefined ? [] : [column.arrayRef])))].map(ref => ({
    ref,
    label: columns.find(column => column.arrayRef === ref)?.arrayLabel ?? ref,
    itemKind: 'object',
    required: false,
    positional: false,
  }));
  return { id: entity, adapterVersion: '0.0.0', targets: () => ({ targets, arrays, unsupported: [] }) };
}

/**
 * Guess which sheet column feeds which field.
 *
 * Exact matches first — a header that *is* a ref, or that matches a generated template's
 * heading — then a normalised text match against the field's label and id. Anything inferred
 * is tagged `guess` so the UI can mark it: a mapping the user was never shown is one they
 * cannot correct, and a wrong guess silently importing into the wrong field is the worst
 * outcome this feature has.
 *
 * Each header feeds at most one field and each field takes at most one header. A sheet with
 * two "Notes" columns therefore maps one of them and leaves the other for the user.
 *
 * Since 3.0 the plan it returns is plan v2: `target` where 2.x wrote `entity`, and
 * `planVersion: 2`.
 */
export function suggestMapping(headers: readonly string[], columns: readonly ImportColumn[], entity = ''): MappingPlan {
  return suggestOverAdapter(headers, columnsAdapter(columns, entity));
}

export interface ApplyMappingOptions extends CoerceOptions, ValidateRecordOptions {
  /** Stamp each record with the config's version. Default `true`. */
  stamp?: boolean;
  /**
   * The row number the first data row has in the user's spreadsheet. Default 2, because the
   * header is row 1 and that is the number they see in the gutter.
   */
  firstRowNumber?: number;
  /**
   * @deprecated Has no effect, and has not since 2.1: the plan decides how far its array rows
   * reach, so a plan can never be applied shorter than it was written.
   */
  maxArrayRows?: number;
}

/**
 * Turn mapped rows into records.
 *
 * A row that fails is **collected, not thrown** — the same choice `validateConfig` makes in
 * returning every problem rather than the first. An import of 400 rows that stops at row 3
 * makes the user fix one thing and run it again, 40 times.
 *
 * Rows are positional, matching what `parseCsv` and the `SHEET_PARSER` contract produce,
 * because a mapping entry addresses a column by index.
 *
 * Takes a plan in either shape, v2 or 2.x. Since 3.0 this is sheet-to-schema's `applyMapping`
 * over `entityFormConfigAdapter`, so a plan may group rows into records, and every error
 * carries a `code`.
 */
export function applyMapping(
  rows: readonly (readonly unknown[])[],
  plan: AnyMappingPlan,
  config: EntityFormConfig,
  options: ApplyMappingOptions = {},
): ImportResult {
  const adapter = entityFormConfigAdapter(config, { rules: options.rules, lookups: options.lookups });
  const result = applyOverAdapter(
    rows,
    planFor(plan, config),
    adapter,
    { lang: options.lang, decimal: options.decimal, dateOrder: options.dateOrder, stamp: options.stamp },
    { firstRowNumber: options.firstRowNumber },
  );
  return {
    records: result.records,
    errors: result.errors,
    skipped: result.skipped,
    planProblems: result.planProblems,
    // Only a grouped plan can warn, and a 2.x result had no such field.
    ...(result.warnings?.length ? { warnings: result.warnings } : {}),
  };
}
