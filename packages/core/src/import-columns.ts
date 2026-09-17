/**
 * import-columns.ts — what a spreadsheet may contain for a given config.
 *
 * Everything here is derived from `EntityFormConfig` and nothing is authored, which is what
 * makes the generated template and the mapping target two views of one contract rather than
 * two lists that have to be kept in step.
 *
 * The walk itself is `collectFieldScopes`. This file does not re-implement it: `field-scopes.ts`
 * says in as many words that two copies of that walk would drift, and a column list that
 * disagreed with the renderer about where a value lives is exactly the drift it warns about.
 */

import { ROOT_SCOPE, collectFieldScopes, refOf } from './field-scopes';
import { getFieldTypeMeta } from './field-catalog';
import { resolveLabel, resolveOptionLabel } from './form-logic';
import type { EntityFormConfig, NestedFieldConfig, RichFieldType } from './form-model.types';
import type {
  DerivedColumns,
  ImportColumn,
  MappingPlan,
  UnsupportedColumn,
} from './import-model.types';
import type { ConfigProblem } from './validate-config';

export interface DeriveColumnsOptions {
  /** Language used to resolve labels and option text into header strings. Default `en`. */
  lang?: string;
  /** Include fields marked `readonly`. Default `false`. */
  includeReadonly?: boolean;
  /** Include fields marked `systemDefault`. Default `false`. */
  includeSystemDefault?: boolean;
  /**
   * How many rows of an `array` field get columns. Default 3.
   *
   * A flat sheet cannot express an unbounded repeating list, so the list is unrolled into
   * numbered columns and the number has to stop somewhere. Raising this multiplies the column
   * count by the array's child count, which is why the default is small.
   */
  maxArrayRows?: number;
}

/** Types whose value cannot survive a spreadsheet cell. */
const UNSUPPORTED_TYPES: Partial<Record<RichFieldType, string>> = {
  image: 'An image is a file reference, which a spreadsheet cell cannot carry.',
  file: 'An attachment is a file reference, which a spreadsheet cell cannot carry.',
};

/** Container types: they hold other fields and have no value of their own. */
const CONTAINER_TYPES = new Set<RichFieldType>(['group', 'array']);

/**
 * A field that holds a value, and where it sits relative to any repeating ancestor.
 *
 * This is the single derivation of "which fields can a sheet carry, and which of them repeat".
 * Column generation and record validation both read it, so a column that can be written is by
 * construction a column that gets validated — the two cannot disagree about arrays, which is
 * the place they would otherwise disagree first.
 */
export interface LeafTarget {
  field: NestedFieldConfig;
  scope: string;
  /** Structural address with no row numbers, e.g. `work.contacts.email`. */
  ref: string;
  /** The repeating ancestor's address when this field is inside an `array`, else `null`. */
  arrayRef: string | null;
  /** Path from that ancestor down to the field, e.g. `email`. Empty when there is none. */
  tail: string;
  /** More than one repeating ancestor — not expressible as flat columns. */
  nested: boolean;
}

/** `prefix` names an ancestor of `ref` (not `ref` itself). */
function isAncestorRef(prefix: string, ref: string): boolean {
  return ref.startsWith(`${prefix}.`);
}

/**
 * Every value-bearing field in a config, tagged with its repeating ancestor if it has one.
 *
 * Containers are dropped: a `group` or an `array` holds other fields and has no value of its
 * own, so neither is a column and neither is validated directly.
 */
export function collectLeafTargets(config: EntityFormConfig | null | undefined): LeafTarget[] {
  const entries = collectFieldScopes(config);

  // Array paths first, so a leaf can be told which of its ancestors repeat. Taken from the
  // same walk rather than a second one — see this file's header.
  const arrayRefs = entries
    .filter(entry => entry.field?.type === 'array' && entry.field.id)
    .map(entry => refOf(entry.field, entry.scope));

  const targets: LeafTarget[] = [];
  for (const entry of entries) {
    const field = entry.field;
    if (!field?.id || CONTAINER_TYPES.has(field.type)) continue;

    const ref = refOf(field, entry.scope);
    const ancestors = arrayRefs.filter(arrayRef => isAncestorRef(arrayRef, ref));
    // The innermost repeating ancestor is the longest matching prefix.
    const arrayRef = ancestors.length
      ? ancestors.reduce((a, b) => (b.length > a.length ? b : a))
      : null;

    targets.push({
      field,
      scope: entry.scope,
      ref,
      arrayRef,
      tail: arrayRef ? ref.slice(arrayRef.length + 1) : '',
      nested: ancestors.length > 1,
    });
  }
  return targets;
}

/**
 * How a value should be written in a cell, for the template's help row.
 *
 * Deliberately a format *hint* and not a parser directive — `coerceCell` accepts more than
 * this describes (several date spellings, `yes`/`1`/`true` for a boolean). This is what to
 * tell a person, and being stricter in the instruction than in the parser is the right way
 * round.
 */
function formatHint(field: NestedFieldConfig): string | undefined {
  switch (field.type) {
    case 'date':
      return 'YYYY-MM-DD';
    case 'datetime':
      return 'YYYY-MM-DD HH:mm';
    case 'time':
      return 'HH:mm';
    case 'monthYear':
      return 'YYYY-MM';
    case 'boolean':
    case 'checkbox':
      return 'true / false';
    case 'number':
    case 'currency':
      return 'a number';
    case 'multiSelect':
      return 'values separated by ;';
    default:
      return undefined;
  }
}

/** Option text a cell may hold, for the help row and for `coerceCell`'s error messages. */
function enumValuesFor(field: NestedFieldConfig, lang: string): string[] | undefined {
  if (!getFieldTypeMeta(field.type)?.hasOptions) return undefined;
  if (!Array.isArray(field.options) || field.options.length === 0) return undefined;
  const values = field.options.map(option => resolveOptionLabel(option, lang)).filter(Boolean);
  return values.length ? values : undefined;
}

/**
 * The address of one row of a repeating field: `contacts` + 2 → `contacts.2`.
 *
 * Dotted, not `contacts[2]`. Brackets are already spoken for — `toRefToken` wraps a rule's
 * field reference in them — and a second address syntax whose punctuation collides with the
 * first is how a config starts meaning different things to different readers. `getValueByPath`
 * already reads dotted numeric segments.
 */
export function formatArrayHeader(arrayRef: string, index: number): string {
  return `${arrayRef}.${index}`;
}

/**
 * Split a ref at its numeric segments: `work.contacts.2.email` → the path and `[2]`.
 *
 * Returns the indices in the order they appear, so a caller can tell a plain leaf (no
 * indices) from a row of a repeating field without re-parsing the string.
 */
export function parseArrayHeader(ref: string): { segments: string[]; indices: number[] } {
  const segments = String(ref ?? '').split('.');
  const indices = segments.filter(segment => /^\d+$/.test(segment)).map(Number);
  return { segments, indices };
}

/**
 * An upper bound on how far a plan's row numbers may reach.
 *
 * A plan is data, and a hand-edited one naming `contacts.999999.name` would otherwise make the
 * column derivation generate a million columns before deciding it did not like the ref.
 */
export const MAX_ARRAY_BOUND = 1000;

/**
 * The array bound a plan implies: the highest row number any of its refs names, plus one.
 *
 * This exists so a caller never has to tell `applyMapping` what `maxArrayRows` the plan was
 * authored with. That parameter was the cause of silent data loss — a plan written for five
 * rows, applied with the default three, had two of its columns quietly dropped and reported a
 * clean import. The information was in the plan the whole time; asking for it again is what
 * created the chance to disagree.
 */
export function arrayBoundOf(plan: MappingPlan | null | undefined): number {
  let highest = -1;
  for (const entry of plan?.entries ?? []) {
    if (!entry || typeof entry.ref !== 'string') continue;
    for (const index of parseArrayHeader(entry.ref).indices) {
      if (index > highest) highest = index;
    }
  }
  return Math.min(highest + 1, MAX_ARRAY_BOUND);
}

/** `contacts.0.email` → `contacts.email`, so a selection can name a field once. */
export function stripIndices(ref: string): string {
  return String(ref ?? '')
    .split('.')
    .filter(segment => !/^\d+$/.test(segment))
    .join('.');
}

/**
 * Every column a sheet may carry for this config, plus the fields it cannot carry.
 *
 * A field inside an `array` becomes one column per row index up to `maxArrayRows`. A field
 * inside an array *inside another array* becomes none: the column count would be the product
 * of both limits, and a template nobody can read is not a template. Those are reported as
 * unsupported rather than omitted, so the gap is visible.
 */
export function deriveImportColumns(
  config: EntityFormConfig | null | undefined,
  options: DeriveColumnsOptions = {},
): DerivedColumns {
  const lang = options.lang ?? 'en';
  const maxArrayRows = Math.max(1, options.maxArrayRows ?? 3);
  const columns: ImportColumn[] = [];
  const unsupported: UnsupportedColumn[] = [];

  const targets = collectLeafTargets(config);

  // A scope segment is a tab id or a container field id, and a heading wants its label.
  // Built once: resolving it per column meant re-walking the whole config for every field.
  const scopeLabels = new Map<string, string>();
  collectTabLabels(config?.tabs, lang, scopeLabels);
  for (const entry of collectFieldScopes(config)) {
    const field = entry.field;
    if (field?.id && CONTAINER_TYPES.has(field.type) && !scopeLabels.has(field.id)) {
      scopeLabels.set(field.id, resolveLabel(field.label, lang) || field.id);
    }
  }

  for (const target of targets) {
    const { field, ref } = target;

    const unsupportedReason = UNSUPPORTED_TYPES[field.type];
    if (unsupportedReason) {
      unsupported.push({ ref, field, reason: unsupportedReason });
      continue;
    }
    if (target.nested) {
      unsupported.push({
        ref,
        field,
        reason:
          'Nested repeating fields would need one column per combination of row numbers. ' +
          'Import this array separately.',
      });
      continue;
    }
    if (field.visibility === false) continue;
    if (field.readonly && !options.includeReadonly) continue;
    if (field.systemDefault && !options.includeSystemDefault) continue;

    const label = resolveLabel(field.label, lang) || field.id;
    const header = headerFor(target.scope, label, scopeLabels);
    const enumValues = enumValuesFor(field, lang);
    const format = formatHint(field);
    const base = {
      scope: target.scope,
      field,
      required: field.validators?.required === true,
      ...(enumValues ? { enumValues } : {}),
      ...(format ? { format } : {}),
    };

    if (!target.arrayRef) {
      columns.push({ ...base, ref, header });
      continue;
    }

    // One column per row of the repeating parent. The index goes into the ref at the array's
    // own boundary, not at the end, because that is where the record nests it.
    for (let index = 0; index < maxArrayRows; index++) {
      columns.push({
        ...base,
        ref: `${formatArrayHeader(target.arrayRef, index)}.${target.tail}`,
        header: `${header} ${index + 1}`,
        arrayIndex: index,
      });
    }
  }

  return { columns, unsupported };
}

/**
 * A column heading a person can act on.
 *
 * Bare labels collide — "Address" exists on Personal Details and on Work Details, which is the
 * whole reason a field's identity is its path rather than its id — so a heading that is only
 * the label names two columns the same thing. The scope is prefixed when there is one.
 */
function headerFor(scope: string, label: string, scopeLabels: Map<string, string>): string {
  if (scope === ROOT_SCOPE) return label;
  const prefix = scope
    .split('.')
    .map(segment => scopeLabels.get(segment) ?? segment)
    .filter(Boolean);
  return prefix.length ? `${prefix.join(' / ')} / ${label}` : label;
}

/** Every tab's label by id, including nested tabs. */
function collectTabLabels(
  tabs: EntityFormConfig['tabs'] | undefined,
  lang: string,
  into: Map<string, string>,
): void {
  for (const tab of tabs ?? []) {
    if (tab?.id && !into.has(tab.id)) into.set(tab.id, resolveLabel(tab.label, lang) || tab.id);
    collectTabLabels(tab?.children, lang, into);
  }
}

/** A generated spreadsheet: its columns, and the help text that goes under each. */
export interface TemplateSpec {
  entity: string;
  sheetName: string;
  columns: ImportColumn[];
  /** Parallel to `columns`: the guidance row a template puts under the headers. */
  notes: string[];
  unsupported: UnsupportedColumn[];
}

/**
 * The sheet to hand a user so their data arrives already in the right shape.
 *
 * `fields` selects a subset by ref; omitting it takes every derivable column. An unknown ref
 * is ignored rather than fatal — a stored selection outliving the field it named is ordinary,
 * and refusing to generate anything would be a worse answer than generating the rest.
 */
export function buildTemplateSpec(
  config: EntityFormConfig | null | undefined,
  options: DeriveColumnsOptions & { fields?: readonly string[] } = {},
): TemplateSpec {
  const lang = options.lang ?? 'en';
  const { columns, unsupported } = deriveImportColumns(config, options);

  const wanted = options.fields ? new Set(options.fields) : null;
  const selected = wanted
    ? columns.filter(column => wanted.has(column.ref) || wanted.has(stripIndices(column.ref)))
    : columns;

  const notes = selected.map(column => {
    const parts: string[] = [];
    if (column.required) parts.push('Required');
    if (column.format) parts.push(column.format);
    if (column.enumValues?.length) parts.push(`One of: ${column.enumValues.join(', ')}`);
    const hint = resolveLabel(column.field.hint, lang);
    if (hint) parts.push(hint);
    return parts.join(' · ');
  });

  return {
    entity: config?.entity ?? '',
    sheetName: resolveLabel(config?.name, lang) || config?.entity || 'Import',
    columns: selected,
    notes,
    unsupported,
  };
}

/**
 * Check a mapping plan against the config it claims to target.
 *
 * Returns `ConfigProblem[]` — the same shape `validateConfig` returns, so a plan's problems
 * print through `formatConfigProblems` and read like a config's. A server must run this
 * **before** reading a single row: a plan naming fields that do not exist is not something to
 * discover halfway through a 50,000-row file.
 */
export function validateMappingPlan(
  plan: MappingPlan | null | undefined,
  config: EntityFormConfig | null | undefined,
  options: DeriveColumnsOptions = {},
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const add = (level: ConfigProblem['level'], path: string, message: string): void => {
    problems.push({ level, path, message });
  };

  if (!plan || typeof plan !== 'object') {
    add('error', '', 'Mapping plan is missing or not an object.');
    return problems;
  }
  if (!Array.isArray(plan.entries)) {
    add('error', 'entries', 'entries must be an array.');
    return problems;
  }

  if (config?.entity && plan.entity && plan.entity !== config.entity) {
    add('warning', 'entity', `Plan targets "${plan.entity}" but the config is "${config.entity}".`);
  }
  if (
    typeof plan.configVersion === 'number' &&
    typeof config?.version === 'number' &&
    plan.configVersion !== config.version
  ) {
    add(
      'warning',
      'configVersion',
      `Plan was authored against config version ${plan.configVersion}; the config is now ${config.version}.`,
    );
  }

  // Derived from the plan rather than taken from the caller, so a plan's own row numbers are
  // always in scope and an unknown ref means the *config* lacks the field — not that the
  // column list happened to be generated too short to contain it.
  const known = new Set(
    deriveImportColumns(config, {
      ...options,
      maxArrayRows: Math.max(options.maxArrayRows ?? 0, arrayBoundOf(plan), 1),
    }).columns.map(column => column.ref),
  );
  const seen = new Set<string>();

  plan.entries.forEach((entry, i) => {
    const at = `entries[${i}]`;
    if (!entry || typeof entry !== 'object') {
      add('error', at, 'Entry is not an object.');
      return;
    }
    if (!entry.ref || typeof entry.ref !== 'string') {
      add('error', `${at}.ref`, 'An entry needs a target field ref.');
      return;
    }
    if (!known.has(entry.ref)) {
      add('error', `${at}.ref`, `References unknown field "${entry.ref}".`);
    }
    // One entry per target. Two entries for one field is not a merge, it is a race between
    // whichever the writer applies last — so it is rejected rather than resolved.
    if (seen.has(entry.ref)) {
      add('error', `${at}.ref`, `"${entry.ref}" is mapped more than once.`);
    }
    seen.add(entry.ref);

    const hasColumn = entry.column !== undefined;
    const hasConstant = entry.constant !== undefined;
    if (hasColumn && hasConstant) {
      add('error', at, 'An entry takes either a column or a constant, not both.');
    }
    if (!hasColumn && !hasConstant) {
      add('error', at, 'An entry needs either a column or a constant.');
    }
    if (hasColumn && (!Number.isInteger(entry.column) || (entry.column as number) < 0)) {
      add('error', `${at}.column`, 'column must be a zero-based integer index.');
    }
  });

  return problems;
}
