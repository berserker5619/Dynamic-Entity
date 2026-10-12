/**
 * apply-mapping.ts — rows in, records out, over any adapter (spec §5, §8).
 *
 * Dynamic Entity 2.3's algorithm (`core/src/import-engine.ts`, `applyMapping`) with the config
 * replaced by an adapter, and grouping added. A row that fails is collected, never thrown: an
 * import of 400 rows that stops at row 3 makes someone fix one thing and run it again, forty
 * times.
 *
 * 1. Each row is mapped, entry by entry (the adapter's `coerce`, else `coerceValue`), into its
 *    parent fields and one item per collected array. Its numbered-column arrays are compacted
 *    or kept by position, as the plan's `lists` say (§6).
 * 2. Without `group`, each row is a record. With it, consecutive rows sharing a key are one
 *    record: parent fields first-row-wins, collected items appended (§5).
 * 3. Each record is finalized, then validated (the adapter's `validate`, else the generic
 *    checks), once, after its last row.
 * 4. Its problems are reported once each. A cell that could not be read names its own row,
 *    the same problem on several rows is one problem carrying those rows, and a target whose
 *    cell could not be read is not also called required.
 */
import type { CoerceOutcome, ImportTarget, SchemaAdapter, TargetSet, ValueKind } from './adapter.types';
import { cellText } from './cell-text';
import { coerceValue } from './coerce';
import { ImportFailure } from './import-failure';
import type { GroupSpec, NormalizedPlan, PlanProblem } from './plan.types';
import { planSlots, slotOf } from './plan-slots';
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

/** One sheet row, mapped: its cells, parent fields, item per collected array, and cell errors. */
interface MappedRow {
  rowNumber: number;
  cells: readonly unknown[];
  parent: Record<string, unknown>;
  items: Map<string, Record<string, unknown>>;
  errors: ImportRowError[];
  /** Parent refs whose cell could not be read, at the address the value would have had after its array settled. */
  unread: string[];
  /** The same for a collected array's item: paths within the item, by array ref. */
  unreadInItem: Map<string, string[]>;
}

/**
 * The same problem reported more than once in one record — a parent cell that fails on every
 * row of a group — as one problem carrying every row it came from.
 */
function mergeProblems(problems: ImportRowError[]): ImportRowError[] {
  const merged = new Map<string, ImportRowError>();
  for (const problem of problems) {
    const key = JSON.stringify([problem.code, problem.ref, problem.message]);
    const known = merged.get(key);
    if (!known) {
      merged.set(key, problem);
      continue;
    }
    const rows = [...new Set([...(known.rows ?? [known.row]), ...(problem.rows ?? [problem.row])])].sort((a, b) => a - b);
    merged.set(key, { ...known, row: rows[0], rows });
  }
  return [...merged.values()];
}

/** The rows of one record. A keyless group is a row with a blank key, imported on its own. */
interface Group {
  keyless: boolean;
  members: MappedRow[];
}

/**
 * Rows into groups (§5). A key is the tuple of trimmed `cellText` at the key columns, compared
 * as a tuple, so `["a|b", "c"]` and `["a", "b|c"]` are two keys. A row whose key cells are all
 * blank is its own group and never merged.
 *
 * Contiguous (the default): a group is a run of adjacent rows, and a key that comes back after
 * its run closed fails the whole import, naming the key and both rows. Otherwise rows of one
 * key gather wherever they are, in sheet order, and groups keep the order they first appear in.
 */
function groupRows(mapped: MappedRow[], group: Required<GroupSpec>): Group[] {
  const groups: Group[] = [];
  const open = new Map<string, Group>();
  const closed = new Map<string, number>();
  // Asserted, not annotated: it is reassigned inside close(), which narrowing cannot see.
  let current = null as { key: string; group: Group } | null;

  const close = (): void => {
    if (current) closed.set(current.key, current.group.members[current.group.members.length - 1].rowNumber);
    current = null;
  };

  for (const row of mapped) {
    const tuple = group.key.map(column => cellText(row.cells[column]).trim());
    if (tuple.every(part => part === '')) {
      if (group.contiguous) close();
      groups.push({ keyless: true, members: [row] });
      continue;
    }
    const key = JSON.stringify(tuple);

    if (!group.contiguous) {
      const existing = open.get(key);
      if (existing) existing.members.push(row);
      else {
        const fresh: Group = { keyless: false, members: [row] };
        open.set(key, fresh);
        groups.push(fresh);
      }
      continue;
    }

    if (current?.key === key) {
      current.group.members.push(row);
      continue;
    }
    close();
    const lastRow = closed.get(key);
    if (lastRow !== undefined) {
      throw new ImportFailure(
        'GROUP_NOT_CONTIGUOUS',
        `The rows for group ${tuple.join(' / ')} are not together: the group ended at row ${lastRow} and starts again at row ${row.rowNumber}. Sort the sheet by the key columns.`,
        { key: tuple, rows: [lastRow, row.rowNumber] },
      );
    }
    const fresh: Group = { keyless: false, members: [row] };
    groups.push(fresh);
    current = { key, group: fresh };
  }
  return groups;
}

/**
 * Turn rows into records. `plan` may be anything a plan arrived as: it is read, upgraded and
 * validated here, and an `error` among those stops the run before the first row is read.
 *
 * Throws `ImportFailure` (`GROUP_NOT_CONTIGUOUS`) when a contiguous group's key comes back.
 */
export function applyMapping<TMeta, TCtx>(
  rows: readonly (readonly unknown[])[],
  plan: unknown,
  adapter: SchemaAdapter<TMeta, TCtx>,
  ctx: TCtx,
  options: ApplyMappingOptions = {},
): ImportResult {
  const prepared = preparePlan(plan, adapter);
  if (!prepared.plan) {
    return {
      records: [],
      errors: [],
      warnings: [],
      skipped: 0,
      planProblems: prepared.problems,
      rowsRead: 0,
      imported: 0,
      rowsInImported: 0,
      failed: 0,
    };
  }
  const ready = prepared.plan;
  const group = ready.group;

  // A collected array is mapped by shape ref with no slot (§6), so it is asked for one slot to
  // learn its item targets, exactly as validatePlan does.
  const slots = planSlots(ready);
  for (const ref of group?.collect ?? []) slots[ref] = Math.max(slots[ref] ?? 0, 1);
  const set: TargetSet<TMeta> = adapter.targets({ slots });
  if (!adapter.coerce && set.targets.some(target => holdsCustom(target.value))) {
    throw new Error(`${adapter.id}: a target has a "custom" value kind but the adapter has no coerce.`);
  }

  const collected = new Set(group?.collect ?? []);
  const byRef = new Map<string, ImportTarget<TMeta>>(set.targets.map(target => [target.ref, target]));
  const byShape = new Map<string, ImportTarget<TMeta>>();
  for (const target of set.targets) {
    if (target.arrayRef !== undefined && collected.has(target.arrayRef)) byShape.set(target.shapeRef, target);
  }
  const collectOf = (ref: string): string | undefined => group?.collect.find(array => ref.startsWith(`${array}.`));

  /**
   * What a grouped record compares across its rows: each parent leaf, and each numbered-column
   * array as a whole (§5, rule 4). Collected arrays are appended, never compared.
   */
  const parentUnits: string[] = [];
  for (const target of set.targets) {
    const unit = target.arrayRef === undefined ? target.ref : collected.has(target.arrayRef) ? null : target.arrayRef;
    if (unit !== null && !parentUnits.includes(unit)) parentUnits.push(unit);
  }

  const mapRow = (cells: readonly unknown[], rowNumber: number): { row: MappedRow; sawValue: boolean } => {
    const row: MappedRow = { rowNumber, cells, parent: {}, items: new Map(), errors: [], unread: [], unreadInItem: new Map() };
    const unreadRefs: string[] = [];
    let sawValue = false;
    for (const entry of ready.entries) {
      const collect = collectOf(entry.ref);
      // validatePlan has established that every ref is a target, by shape for a collected array.
      const target = (collect ? byShape.get(entry.ref) : byRef.get(entry.ref)) as ImportTarget<TMeta>;
      const fromColumn = entry.column !== undefined;
      const raw = fromColumn ? cells[entry.column as number] : entry.constant;

      // A non-text constant is already a value, authored against the schema; coercing it would
      // stringify an object to "[object Object]". Typed text is read like any cell.
      const outcome: CoerceOutcome =
        !fromColumn && typeof raw !== 'string'
          ? { value: raw }
          : (adapter.coerce?.(target, raw, ctx) ?? coerceValue(target.value, raw, { decimal: options.decimal, split: entry.split, dateOrder: entry.dateOrder }));

      if ('error' in outcome) {
        row.errors.push({
          row: rowNumber,
          ref: entry.ref,
          ...(fromColumn ? { column: entry.column } : {}),
          code: outcome.code,
          message: outcome.error,
          raw,
        });
        if (collect) row.unreadInItem.set(collect, [...(row.unreadInItem.get(collect) ?? []), entry.ref.slice(collect.length + 1)]);
        else unreadRefs.push(entry.ref);
        sawValue = true;
        continue;
      }
      if (outcome.value === undefined) continue;
      // A constant is not evidence the user put anything in this row.
      if (fromColumn) sawValue = true;
      if (collect) {
        const item = row.items.get(collect) ?? {};
        setRecordValue(item, entry.ref.slice(collect.length + 1), outcome.value);
        row.items.set(collect, item);
      } else {
        setRecordValue(row.parent, entry.ref, outcome.value);
      }
    }
    /** Where each slot's item is once its array has settled, or `null` when it left no item. */
    const landed = new Map<string, (slot: number) => number | null>();
    for (const array of set.arrays) {
      if (collected.has(array.ref)) continue;
      const items = getRecordValue(row.parent, array.ref);
      const compact = ready.lists?.[array.ref]?.compact ?? true;
      const before: unknown[] = Array.isArray(items) ? items : [];
      if (Array.isArray(items)) setRecordValue(row.parent, array.ref, settleArray(items, compact));
      landed.set(array.ref, slot => {
        if (isEmptyValue(before[slot])) return null;
        return compact ? before.slice(0, slot).filter(item => !isEmptyValue(item)).length : slot;
      });
    }
    for (const ref of unreadRefs) {
      const at = slotOf(ref);
      const land = at && landed.get(at.arrayRef);
      if (!at || !land) {
        row.unread.push(ref);
        continue;
      }
      const index = land(at.slot);
      if (index !== null) row.unread.push(`${at.arrayRef}.${index}${ref.slice(at.arrayRef.length + 1 + String(at.slot).length)}`);
    }
    return { row, sawValue };
  };

  const records: Record<string, unknown>[] = [];
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];
  let skipped = 0;
  let failed = 0;
  let rowsInImported = 0;

  /**
   * Finalize and judge one record. In a grouped record a problem with the whole record carries
   * every row it came from, and a cell that could not be read carries its own. A warning
   * arrives with its rows already on it.
   *
   * `unread` holds the refs whose cell could not be read. Such a target is absent from the
   * record, but it is not one nobody filled in, so it is not reported as required as well
   * (§5; 2.3 reported both).
   */
  const finish = (
    record: Record<string, unknown>,
    rowNumbers: number[],
    cellErrors: ImportRowError[],
    recordWarnings: ImportRowError[],
    unread: ReadonlySet<string>,
  ): void => {
    const ofRecord = (problem: ImportRowError): ImportRowError => (group ? { ...problem, row: rowNumbers[0], rows: rowNumbers } : problem);
    const ofCell = (problem: ImportRowError): ImportRowError => (group ? { ...problem, rows: [problem.row] } : problem);
    const finished = adapter.finalize ? adapter.finalize(record, ctx) : record;
    const problems = (adapter.validate ? adapter.validate(finished, ctx) : validateRecord(finished, set)).filter(
      problem => !(problem.code === 'RECORD_REQUIRED' && unread.has(problem.ref)),
    );
    const recordErrors = mergeProblems([
      ...cellErrors.map(ofCell),
      ...problems.map(problem => ofRecord({ row: rowNumbers[0], ref: problem.ref, code: problem.code, message: problem.message, raw: problem.raw })),
    ]);
    warnings.push(...recordWarnings);
    if (recordErrors.length) {
      errors.push(...recordErrors);
      // §5: if any row of a group fails, the whole record fails and every row of it counts.
      failed += rowNumbers.length;
      return;
    }
    records.push(finished);
    rowsInImported += rowNumbers.length;
  };

  /** §5: one record from a group's rows. First row wins, later blanks are ignored, items append. */
  const buildGroup = ({ keyless, members }: Group): void => {
    const record: Record<string, unknown> = {};
    const origin = new Map<string, number>();
    const rowNumbers = members.map(member => member.rowNumber);
    const recordWarnings: ImportRowError[] = keyless
      ? [{ row: rowNumbers[0], rows: rowNumbers, ref: '', code: 'RECORD_GROUP_NO_KEY', message: 'No group key; imported as its own record.' }]
      : [];
    /** One warning per value that disagrees with the kept one, by parent unit and that value. */
    const conflicts = new Map<string, ImportRowError & { rows: number[] }>();
    for (const unit of parentUnits) {
      for (const member of members) {
        const value = getRecordValue(member.parent, unit);
        if (value === undefined) continue;
        const kept = origin.get(unit);
        if (kept === undefined) {
          origin.set(unit, member.rowNumber);
          setRecordValue(record, unit, value);
        } else if (JSON.stringify(value) !== JSON.stringify(getRecordValue(record, unit))) {
          // The warning names the two rows to look at: the one the value was kept from, and the
          // one that disagrees. Rows that agree are not on it, and each other value gets its own.
          const conflict = `${unit} ${JSON.stringify(value)}`;
          const known = conflicts.get(conflict);
          if (known) {
            known.rows.push(member.rowNumber);
            continue;
          }
          const warning = {
            row: kept,
            rows: [kept, member.rowNumber],
            ref: unit,
            code: 'RECORD_GROUP_CONFLICT' as const,
            message: `Rows disagree on ${unit}; kept row ${kept}.`,
            raw: value,
          };
          conflicts.set(conflict, warning);
          recordWarnings.push(warning);
        }
      }
    }
    const unread = new Set(members.flatMap(member => member.unread));
    for (const array of collected) {
      // Not de-duplicated: two identical line items are two items. An all-blank item is no item.
      const items: Record<string, unknown>[] = [];
      for (const member of members) {
        const item = member.items.get(array);
        if (!item || isEmptyValue(item)) continue;
        for (const path of member.unreadInItem.get(array) ?? []) unread.add(`${array}.${items.length}.${path}`);
        items.push(item);
      }
      if (items.length) setRecordValue(record, array, items);
    }
    finish(record, rowNumbers, members.flatMap(member => member.errors), recordWarnings, unread);
  };

  const firstRow = options.firstRowNumber ?? 2;
  const mapped: MappedRow[] = [];
  rows.forEach((cells, i) => {
    const { row, sawValue } = mapRow(cells, firstRow + i);
    if (sawValue) mapped.push(row);
    else skipped++;
  });

  if (group) for (const members of groupRows(mapped, group)) buildGroup(members);
  else for (const row of mapped) finish(row.parent, [row.rowNumber], row.errors, [], new Set(row.unread));

  return {
    records,
    errors,
    warnings,
    skipped,
    planProblems: prepared.problems,
    rowsRead: rows.length,
    imported: records.length,
    rowsInImported,
    failed,
  };
}
