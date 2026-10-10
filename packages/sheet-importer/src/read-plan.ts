/**
 * read-plan.ts — the one way a plan enters the engine (spec §4).
 *
 * Nothing else parses a plan, on either side of the wire. `readPlan` does every check that
 * needs no adapter (Decision 10); `validatePlan` later does only the ones that need targets.
 * A plan with any `error` is not returned, so nothing downstream ever sees a plan it would
 * have to second-guess.
 *
 * The rules are applied in the spec's order, and each check names the rule or decision it
 * implements, so a disagreement between this file and the spec is visible at the line.
 */
import type {
  GroupSpec,
  ListOptions,
  MappingEntry,
  MatchConfidence,
  NormalizedPlan,
  PlanProblem,
} from './plan.types';
import type { PlanProblemCode } from './problem-codes';
import { isUnsafePath } from './safe-path';

export interface ReadPlanOptions {
  /**
   * Tooling only (rule 5): an unknown key becomes a warning and is dropped, on any plan.
   * Never set for `runImport` or the HTTP router, where ignoring `group` would import one
   * record per row instead of one per group.
   */
  allowUnknownKeys?: boolean;
}

export interface ReadPlanResult {
  /** Present only when no problem is an `error`. */
  plan?: NormalizedPlan;
  problems: PlanProblem[];
}

/** Top-level keys of §3, plus the two v1 aliases, which are known on both versions (Decision 13). */
const TOP_LEVEL_KEYS = new Set([
  'planVersion',
  'target',
  'schemaVersion',
  'sourceHeaders',
  'entries',
  'lists',
  'group',
  'entity',
  'configVersion',
]);
const ENTRY_KEYS = new Set(['ref', 'column', 'header', 'constant', 'confidence', 'split']);
const LIST_OPTION_KEYS = new Set(['compact']);
const GROUP_KEYS = new Set(['key', 'collect', 'contiguous']);
const CONFIDENCE: ReadonlySet<string> = new Set<MatchConfidence>(['exact', 'guess']);

/** The longest separator `split` may carry (§3). */
const MAX_SPLIT_LENGTH = 8;

/** A plain data object, as JSON produces: not null, not an array, not a class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
/** A path segment for a map key that may itself contain dots. */
const keyPath = (base: string, key: string): string => `${base}[${JSON.stringify(key)}]`;

/**
 * Read a plan from anything — a parsed request body, a stored row, a hand-edited file.
 *
 * Returns the plan in v2 form with every default filled in, or no plan and the problems that
 * explain why. Warnings never withhold the plan.
 */
export function readPlan(input: unknown, options: ReadPlanOptions = {}): ReadPlanResult {
  const problems: PlanProblem[] = [];
  const add = (level: PlanProblem['level'], code: PlanProblemCode, path: string, message: string): void => {
    problems.push({ level, code, path, message });
  };
  const done = (plan?: NormalizedPlan): ReadPlanResult =>
    problems.some(problem => problem.level === 'error') || !plan ? { problems } : { plan, problems };

  // Rule 1: a plain object with an `entries` array. Nothing else is worth reading.
  if (!isPlainObject(input)) {
    add('error', 'PLAN_SHAPE', '', 'Mapping plan is missing or not an object.');
    return done();
  }
  // Narrowed once into a const: a nested function does not see a parameter's narrowing.
  const raw: Record<string, unknown> = input;
  if (!Array.isArray(raw['entries'])) {
    add('error', 'PLAN_SHAPE', 'entries', 'entries must be an array.');
    return done();
  }

  // Rule 3: absent is v1, 2 is v2, anything else is a version this reader cannot interpret,
  // so nothing else about the plan is meaningful to check.
  const version = input['planVersion'];
  if (version !== undefined && version !== 2) {
    add('error', 'PLAN_VERSION', 'planVersion', `planVersion ${JSON.stringify(version)} is not one this reader knows; it reads v1 (no planVersion) and 2.`);
    return done();
  }
  const v2 = version === 2;

  // Rule 5: keys the format does not define. On v1 a top-level stranger is the consumer's own
  // metadata (`id`, `name`), which 2.3 tolerated, so it is a warning and is dropped.
  const unknownKey = (path: string, key: string, topLevelOfV1: boolean): void => {
    const lenient = options.allowUnknownKeys || topLevelOfV1;
    add(lenient ? 'warning' : 'error', 'PLAN_UNKNOWN_KEY', path, `"${key}" is not a mapping-plan field${lenient ? '; it is ignored' : ''}.`);
  };
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) unknownKey(key, key, !v2);
  }

  // Rule 4: a v2 field on a plan that does not say it is v2 is a writer that forgot the stamp.
  // Reading it as v1 would ignore it — `group` ignored imports one record per row.
  const v2Only: string[] = [];
  if (input['lists'] !== undefined) v2Only.push('lists');
  if (input['group'] !== undefined) v2Only.push('group');
  (input['entries'] as unknown[]).forEach((entry, i) => {
    if (isPlainObject(entry) && entry['split'] !== undefined) v2Only.push(`entries[${i}].split`);
  });
  if (!v2) {
    for (const path of v2Only) {
      add('error', 'PLAN_VERSION', path, `${path} is a v2 field; a plan carrying it must set planVersion: 2.`);
    }
  }

  // Rule 2, and Decision 11: the target, by either name. A plan naming no target cannot be
  // checked against any adapter.
  const target = readAlias('target', 'entity', isText, 'a non-empty string');
  // Absent under both names. A present but malformed or conflicting one is already reported.
  if (input['target'] === undefined && input['entity'] === undefined) {
    add('error', 'PLAN_SHAPE', 'target', 'A plan must name its target (target, or entity in a v1 plan).');
  }
  const schemaVersion = readAlias(
    'schemaVersion',
    'configVersion',
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
    'a number',
  );

  /**
   * One field by its v2 name or its v1 name. A wrongly typed value is `PLAN_SHAPE` (Decision 12).
   * Both names agreeing is a warning to drop the old one; disagreeing is an error. On a v2 plan
   * the old name alone is also a warning: v2 writers emit v2 names only (§4, "Writing").
   */
  function readAlias<T>(name: string, oldName: string, valid: (value: unknown) => value is T, expected: string): T | undefined {
    const value = raw[name];
    const old = raw[oldName];
    const present = value !== undefined;
    const oldPresent = old !== undefined;
    if (present && !valid(value)) add('error', 'PLAN_SHAPE', name, `${name} must be ${expected}.`);
    if (oldPresent && !valid(old)) add('error', 'PLAN_SHAPE', oldName, `${oldName} must be ${expected}.`);
    if (present && oldPresent) {
      if (value !== old) {
        add('error', 'PLAN_ALIAS_CONFLICT', oldName, `${oldName} (${JSON.stringify(old)}) and ${name} (${JSON.stringify(value)}) disagree; keep ${name} only.`);
        return undefined;
      }
      add('warning', 'PLAN_ALIAS_USED', oldName, `${oldName} is the v1 name of ${name}; drop it.`);
    } else if (oldPresent && v2) {
      add('warning', 'PLAN_ALIAS_USED', oldName, `${oldName} is the v1 name of ${name}; a v2 plan should use ${name}.`);
    }
    const chosen = present ? value : old;
    return valid(chosen) ? chosen : undefined;
  }

  const sourceHeaders = input['sourceHeaders'];
  if (sourceHeaders !== undefined && !(Array.isArray(sourceHeaders) && sourceHeaders.every(h => typeof h === 'string'))) {
    add('error', 'PLAN_SHAPE', 'sourceHeaders', 'sourceHeaders must be an array of strings.');
  }

  const entries = readEntries(input['entries'] as unknown[]);
  const group = input['group'] === undefined ? undefined : readGroup(input['group']);
  const lists = input['lists'] === undefined ? undefined : readLists(input['lists'], group);

  function readEntries(raw: unknown[]): MappingEntry[] {
    const out: MappingEntry[] = [];
    const seen = new Set<string>();
    raw.forEach((entry, i) => {
      const at = `entries[${i}]`;
      if (!isPlainObject(entry)) {
        add('error', 'PLAN_SHAPE', at, 'Entry is not an object.');
        return;
      }
      for (const key of Object.keys(entry)) if (!ENTRY_KEYS.has(key)) unknownKey(`${at}.${key}`, key, false);

      const ref = entry['ref'];
      if (!isText(ref)) {
        add('error', 'PLAN_SHAPE', `${at}.ref`, 'An entry needs a target field ref.');
        return;
      }
      // Rule 6.
      if (isUnsafePath(ref)) add('error', 'PLAN_UNSAFE_PATH', `${at}.ref`, `"${ref}" names a reserved object key.`);
      if (seen.has(ref)) add('error', 'PLAN_DUPLICATE_REF', `${at}.ref`, `"${ref}" is mapped more than once.`);
      seen.add(ref);

      const hasColumn = entry['column'] !== undefined;
      const hasConstant = entry['constant'] !== undefined;
      if (hasColumn && hasConstant) add('error', 'PLAN_SOURCE', at, 'An entry takes either a column or a constant, not both.');
      if (!hasColumn && !hasConstant) add('error', 'PLAN_SOURCE', at, 'An entry needs either a column or a constant.');
      if (hasColumn && !isIndex(entry['column'])) add('error', 'PLAN_SOURCE', `${at}.column`, 'column must be a zero-based integer index.');

      const header = entry['header'];
      if (header !== undefined && typeof header !== 'string') add('error', 'PLAN_SHAPE', `${at}.header`, 'header must be a string.');
      const confidence = entry['confidence'];
      if (confidence !== undefined && !CONFIDENCE.has(confidence as string)) {
        add('error', 'PLAN_SHAPE', `${at}.confidence`, 'confidence must be "exact" or "guess".');
      }
      const split = entry['split'];
      if (split !== undefined && !(isText(split) && split.length <= MAX_SPLIT_LENGTH)) {
        add('error', 'PLAN_SHAPE', `${at}.split`, `split must be a separator of 1 to ${MAX_SPLIT_LENGTH} characters.`);
      }

      // Only the fields the format defines are carried, so a dropped unknown key stays dropped.
      out.push({
        ref,
        ...(hasColumn ? { column: entry['column'] as number } : {}),
        ...(header !== undefined ? { header: header as string } : {}),
        ...(hasConstant ? { constant: entry['constant'] } : {}),
        ...(confidence !== undefined ? { confidence: confidence as MatchConfidence } : {}),
        ...(split !== undefined ? { split: split as string } : {}),
      });
    });
    return out;
  }

  function readGroup(raw: unknown): Required<GroupSpec> | undefined {
    if (!isPlainObject(raw)) {
      add('error', 'PLAN_GROUP', 'group', 'group must be an object.');
      return undefined;
    }
    for (const key of Object.keys(raw)) if (!GROUP_KEYS.has(key)) unknownKey(`group.${key}`, key, false);

    const key = raw['key'];
    if (!Array.isArray(key) || key.length === 0) {
      add('error', 'PLAN_GROUP', 'group.key', 'group.key must be a non-empty array of column indices.');
    } else {
      key.forEach((column, i) => {
        if (!isIndex(column)) add('error', 'PLAN_GROUP', `group.key[${i}]`, 'A group key column must be a zero-based integer index.');
      });
    }
    const collect = raw['collect'];
    if (!Array.isArray(collect) || collect.length === 0) {
      add('error', 'PLAN_GROUP', 'group.collect', 'group.collect must be a non-empty array of array refs.');
    } else {
      collect.forEach((ref, i) => {
        if (!isText(ref)) add('error', 'PLAN_GROUP', `group.collect[${i}]`, 'A collected array ref must be a non-empty string.');
        else if (isUnsafePath(ref)) add('error', 'PLAN_UNSAFE_PATH', `group.collect[${i}]`, `"${ref}" names a reserved object key.`);
      });
    }
    const contiguous = raw['contiguous'];
    if (contiguous !== undefined && typeof contiguous !== 'boolean') {
      add('error', 'PLAN_GROUP', 'group.contiguous', 'group.contiguous must be true or false.');
    }
    if (!Array.isArray(key) || !Array.isArray(collect)) return undefined;
    // Rule 7: the default is filled in here, once.
    return { key: key as number[], collect: collect as string[], contiguous: contiguous === undefined ? true : (contiguous as boolean) };
  }

  function readLists(raw: unknown, readGroupSpec: Required<GroupSpec> | undefined): Record<string, ListOptions> | undefined {
    if (!isPlainObject(raw)) {
      add('error', 'PLAN_LIST_OPTION', 'lists', 'lists must be an object keyed by array ref.');
      return undefined;
    }
    const collected = new Set(readGroupSpec?.collect ?? []);
    const out: Record<string, ListOptions> = {};
    for (const [ref, options] of Object.entries(raw)) {
      const at = keyPath('lists', ref);
      if (!ref) {
        add('error', 'PLAN_LIST_OPTION', at, 'A lists key must be an array ref.');
        continue;
      }
      if (isUnsafePath(ref)) add('error', 'PLAN_UNSAFE_PATH', at, `"${ref}" names a reserved object key.`);
      if (!isPlainObject(options)) {
        add('error', 'PLAN_LIST_OPTION', at, 'List options must be an object.');
        continue;
      }
      for (const key of Object.keys(options)) if (!LIST_OPTION_KEYS.has(key)) unknownKey(`${at}.${key}`, key, false);
      const compact = options['compact'];
      if (compact !== undefined && typeof compact !== 'boolean') {
        add('error', 'PLAN_LIST_OPTION', `${at}.compact`, 'compact must be true or false.');
      }
      // §6: compaction is about numbered-column slots; a collected array has none.
      if (compact !== undefined && collected.has(ref)) {
        add('error', 'PLAN_LIST_OPTION', `${at}.compact`, `"${ref}" is collected across a group's rows, so compact does not apply to it.`);
      }
      out[ref] = compact === undefined ? {} : { compact: compact as boolean };
    }
    return out;
  }

  if (target === undefined) return done();
  return done({
    planVersion: 2,
    target,
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    ...(Array.isArray(sourceHeaders) ? { sourceHeaders: [...(sourceHeaders as string[])] } : {}),
    entries,
    ...(lists !== undefined ? { lists } : {}),
    ...(group !== undefined ? { group } : {}),
  });
}
