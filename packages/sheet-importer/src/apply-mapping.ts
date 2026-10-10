/**
 * apply-mapping.ts — rows in, records out, over any adapter (spec §8).
 *
 * Dynamic Entity 2.3's algorithm (`core/src/import-engine.ts`, `applyMapping`) with the config
 * replaced by an adapter. A row that fails is collected, never thrown: an import of 400 rows
 * that stops at row 3 makes someone fix one thing and run it again, forty times.
 *
 * For each row:
 * 1. map it, entry by entry: the adapter's `coerce`, else `coerceValue`;
 * 2. compact or keep each array's slots, as the plan's `lists` say (§6);
 * 3. `finalize`, then `validate` (the adapter's, else the generic checks).
 *
 * Grouping (§5) is the next step, and a grouped plan is refused until then rather than
 * imported one record per row.
 */
import type { CoerceOutcome, ImportTarget, SchemaAdapter, TargetSet, ValueKind } from './adapter.types';
import { coerceValue } from './coerce';
import type { NormalizedPlan, PlanProblem } from './plan.types';
import { planSlots } from './plan-slots';
import { readPlan } from './read-plan';
import { getRecordValue, isEmptyValue, setRecordValue } from './record-path';
import type { ImportResult, ImportRowError } from './result.types';
import { validatePlan } from './validate-plan';
import { validateRecord } from './validate-record';

export interface ApplyMappingOptions {
  /** The sheet row number of `rows[0]`. Default 2: the header is always row 1 (Decision 8). */
  firstRowNumber?: number;
  /** The decimal mark in number text, on both sides of the wire (§8). */
  decimal?: '.' | ',';
}

export interface PreparedPlan {
  /** Present only when no problem is an `error`. */
  plan?: NormalizedPlan;
  problems: PlanProblem[];
}

/**
 * A plan made ready for an adapter: `readPlan`, then the adapter's `upgradeRefs`, then
 * `validatePlan` (§4, §7). `applyMapping` calls this itself; a caller MAY call it first to
 * fail fast.
 *
 * Duplicate refs are checked again after `upgradeRefs`, because a 2.2 ref and its current
 * name are two different strings until the upgrade makes them one.
 */
export function preparePlan<TMeta, TCtx>(input: unknown, adapter: SchemaAdapter<TMeta, TCtx>): PreparedPlan {
  const read = readPlan(input);
  if (!read.plan) return { problems: read.problems };
  const problems = [...read.problems];
  let plan = read.plan;

  if (adapter.upgradeRefs) {
    const upgraded = adapter.upgradeRefs(plan);
    // §7: upgradeRefs MUST only rewrite refs. Anything else is an adapter bug, not a plan problem.
    if (upgraded.plan.entries.length !== plan.entries.length) {
      throw new Error(`${adapter.id}: upgradeRefs added or dropped plan entries; it may only rewrite refs.`);
    }
    problems.push(...upgraded.problems);
    plan = { ...plan, entries: plan.entries.map((entry, i) => ({ ...entry, ref: upgraded.plan.entries[i].ref })) };
    const seen = new Set<string>();
    plan.entries.forEach((entry, i) => {
      if (seen.has(entry.ref)) {
        problems.push({
          level: 'error',
          code: 'PLAN_DUPLICATE_REF',
          path: `entries[${i}].ref`,
          message: `"${entry.ref}" is mapped more than once.`,
        });
      }
      seen.add(entry.ref);
    });
  }

  problems.push(...validatePlan(plan, adapter));
  return problems.some(problem => problem.level === 'error') ? { problems } : { plan, problems };
}

/** A `custom` kind anywhere a target can hold one, including as a list's items. */
function holdsCustom(kind: ValueKind): boolean {
  return kind.kind === 'custom' || (kind.kind === 'list' && holdsCustom(kind.of));
}

/**
 * Remove the holes a sparse write leaves, or keep slots by position (§6).
 *
 * Compacted (the default): items with no value are dropped and the rest renumbered, which is
 * 2.3's `compactArrays`. Positional: an empty slot before the last filled one is `null`, and
 * empty slots after it are trimmed.
 */
function settleArray(items: unknown[], compact: boolean): unknown[] {
  if (compact) return items.filter(item => !isEmptyValue(item));
  let last = -1;
  items.forEach((item, i) => {
    if (!isEmptyValue(item)) last = i;
  });
  return Array.from({ length: last + 1 }, (_, i) => (isEmptyValue(items[i]) ? null : items[i]));
}

/**
 * Turn rows into records. `plan` may be anything a plan arrived as: it is read, upgraded and
 * validated here, and an `error` among those stops the run before the first row is read.
 */
export function applyMapping<TMeta, TCtx>(
  rows: readonly (readonly unknown[])[],
  plan: unknown,
  adapter: SchemaAdapter<TMeta, TCtx>,
  ctx: TCtx,
  options: ApplyMappingOptions = {},
): ImportResult {
  const prepared = preparePlan(plan, adapter);
  const nothing = (planProblems: PlanProblem[]): ImportResult => ({
    records: [],
    errors: [],
    warnings: [],
    skipped: 0,
    planProblems,
    rowsRead: 0,
    imported: 0,
    rowsInImported: 0,
    failed: 0,
  });
  if (!prepared.plan) return nothing(prepared.problems);
  const ready = prepared.plan;

  if (ready.group) {
    return nothing([
      ...prepared.problems,
      { level: 'error', code: 'PLAN_GROUP', path: 'group', message: 'Grouping is not implemented in this build yet.' },
    ]);
  }

  const set: TargetSet<TMeta> = adapter.targets({ slots: planSlots(ready) });
  if (!adapter.coerce && set.targets.some(target => holdsCustom(target.value))) {
    throw new Error(`${adapter.id}: a target has a "custom" value kind but the adapter has no coerce.`);
  }
  const byRef = new Map<string, ImportTarget<TMeta>>(set.targets.map(target => [target.ref, target]));
  const firstRow = options.firstRowNumber ?? 2;

  const records: Record<string, unknown>[] = [];
  const errors: ImportRowError[] = [];
  let skipped = 0;
  let failed = 0;

  rows.forEach((row, i) => {
    const rowNumber = firstRow + i;
    const record: Record<string, unknown> = {};
    const rowErrors: ImportRowError[] = [];
    let sawValue = false;

    for (const entry of ready.entries) {
      // validatePlan has established that every ref is a target.
      const target = byRef.get(entry.ref) as ImportTarget<TMeta>;
      const fromColumn = entry.column !== undefined;
      const raw = fromColumn ? row[entry.column as number] : entry.constant;

      // A non-text constant is already a value, authored against the schema; coercing it would
      // stringify an object to "[object Object]". Typed text is read like any cell.
      const outcome: CoerceOutcome =
        !fromColumn && typeof raw !== 'string'
          ? { value: raw }
          : (adapter.coerce?.(target, raw, ctx) ?? coerceValue(target.value, raw, { decimal: options.decimal, split: entry.split }));

      if ('error' in outcome) {
        rowErrors.push({
          row: rowNumber,
          ref: entry.ref,
          ...(fromColumn ? { column: entry.column } : {}),
          code: outcome.code,
          message: outcome.error,
          raw,
        });
        sawValue = true;
        continue;
      }
      if (outcome.value === undefined) continue;
      // A constant is not evidence the user put anything in this row.
      if (fromColumn) sawValue = true;
      setRecordValue(record, entry.ref, outcome.value);
    }

    if (!sawValue) {
      skipped++;
      return;
    }

    for (const array of set.arrays) {
      const items = getRecordValue(record, array.ref);
      if (!Array.isArray(items)) continue;
      const compact = ready.lists?.[array.ref]?.compact ?? true;
      setRecordValue(record, array.ref, settleArray(items, compact));
    }

    const finished = adapter.finalize ? adapter.finalize(record, ctx) : record;
    const problems = adapter.validate ? adapter.validate(finished, ctx) : validateRecord(finished, set);
    for (const problem of problems) {
      rowErrors.push({ row: rowNumber, ref: problem.ref, code: problem.code, message: problem.message, raw: problem.raw });
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      failed++;
      return;
    }
    records.push(finished);
  });

  return {
    records,
    errors,
    warnings: [],
    skipped,
    planProblems: prepared.problems,
    rowsRead: rows.length,
    imported: records.length,
    rowsInImported: records.length,
    failed,
  };
}
