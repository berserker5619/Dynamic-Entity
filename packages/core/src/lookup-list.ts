/**
 * lookup-list.ts — named master lists (`field.listName`) and the option-integrity report.
 *
 * A master list is a centrally-managed set of values addressed by name, shared by fields across
 * entities: `{ listName: 'countries', listValues: [{ code, name: { en, de }, sortOrder }] }`.
 * Framework-agnostic, like the rest of core — the registry that fetches lists lives in the
 * renderer; everything here is pure.
 *
 * Value identity is the **text**, not `_id` or `code` (parity plan §6.4): a list value maps to
 * a `DropdownOption` (= `LocalizedText`) and the whole object is what a record stores, exactly
 * as it does for inline options. The reference implementation instead displayed `name[lang]`
 * and stored `name['en']`, losing every other language on the way in.
 *
 * `_id`, `code`, `isSystemDefined` and `from` survive normalisation so a consumer can act on
 * them (e.g. refuse to delete a system-defined value). The library itself never reads them.
 */

import type { Subscribable } from './entity-reference.types';
import type {
  DropdownOption,
  EntityFormConfig,
  LocalizedText,
  NestedFieldConfig,
  NestedTabConfig,
} from './form-model.types';
import { getTabPath, normalizeLocalizedText, valuesMatch } from './form-logic';

/** Field types whose stored value comes from an option list. */
const CHOICE_TYPES = new Set(['dropdown', 'radio', 'multiSelect']);

/**
 * One value in a named master list.
 *
 * `_id` and `code` are carried, never stored in a record — see the module note. `sortOrder`
 * orders the resulting options; values without one keep their incoming order, after those
 * that have one.
 */
export interface LookupListValue {
  name: LocalizedText;
  _id?: string;
  code?: string;
  sortOrder?: number;
  /** Backend flag: the value is system-defined. Consumer-facing only. */
  isSystemDefined?: boolean;
  /** Provenance of the value, from the backend list model. Consumer-facing only. */
  from?: string;
}

/** What a consumer may hand us for one value: the full shape, a localised text, or a bare scalar. */
export type RawLookupListValue = LookupListValue | LocalizedText | string | number;

/** Context passed to a list loader. */
export interface LookupLoaderContext {
  /** Active language, for loaders that fetch one language at a time. */
  lang?: string;
}

/** Anything a list may be delivered as. */
export type LookupListResult =
  | RawLookupListValue[]
  | Promise<RawLookupListValue[]>
  | Subscribable<RawLookupListValue[]>;

/** A lazily-invoked list source. Preferred over a bare Promise, which resolves at provider time. */
export type LookupListLoader = (ctx?: LookupLoaderContext) => LookupListResult;

/** A registered list: either the values themselves, or a function that produces them. */
export type LookupListSource = LookupListResult | LookupListLoader;

/**
 * Normalise raw list values: coerce each to `LookupListValue`, then order by `sortOrder`.
 *
 * Tolerates bare strings/numbers and plain `LocalizedText`, so a consumer with a simple
 * `['Draft', 'Active']` list does not have to build the full shape. Metadata is preserved.
 */
export function normalizeLookupValues(
  raw: readonly RawLookupListValue[] | null | undefined,
): LookupListValue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(value => value !== null && value !== undefined)
    .map(toLookupListValue)
    .sort(bySortOrder);
}

/** Project normalised list values onto the canonical option shape — the `name` *is* the option. */
export function lookupValuesToOptions(values: readonly LookupListValue[]): DropdownOption[] {
  return values.map(value => value.name);
}

/** One raw value → `LookupListValue`. */
function toLookupListValue(raw: RawLookupListValue): LookupListValue {
  if (typeof raw === 'string' || typeof raw === 'number') {
    return { name: { en: String(raw) } };
  }
  const obj = raw as Record<string, unknown>;
  // `name` present means the full shape; anything else is a bare LocalizedText.
  if ('name' in obj) {
    return { ...(obj as Omit<LookupListValue, 'name'>), name: normalizeLocalizedText(obj['name']) };
  }
  return { name: normalizeLocalizedText(obj) };
}

/**
 * Order by `sortOrder`. Missing sorts last rather than as 0, so adding one ordered value to an
 * unordered list does not silently reshuffle the rest; `Array.prototype.sort` is stable, so
 * equal entries keep their incoming order.
 */
function bySortOrder(a: LookupListValue, b: LookupListValue): number {
  const left = typeof a.sortOrder === 'number' ? a.sortOrder : Number.POSITIVE_INFINITY;
  const right = typeof b.sortOrder === 'number' ? b.sortOrder : Number.POSITIVE_INFINITY;
  return left - right;
}

// ─── Option-integrity report ─────────────────────────────────────────────────

/** One stored choice value with no matching option in its field's current list. */
export interface UnmatchedValue {
  /** Dot-path to the value in the record, e.g. `employment.status` or `employment.roles[1]`. */
  path: string;
  tabId: string;
  fieldId: string;
  /** Set when the field draws its options from a named list rather than inline options. */
  listName?: string;
  value: unknown;
}

/** Options for a named list, as a plain object or a Map. */
export type LookupListMap =
  | Record<string, readonly DropdownOption[]>
  | Map<string, readonly DropdownOption[]>;

/**
 * Report every stored choice value that no longer matches an option — the orphans left behind
 * when a list value is renamed (parity plan §6.4).
 *
 * Because a lookup list is centrally managed, one admin edit can orphan records across every
 * entity using that list. Accepting that trade is not the same as making it undetectable: this
 * is the report a consumer runs to find the damage and drive a migration. It never rewrites
 * anything.
 *
 * A field is **skipped**, not reported, when its options cannot be determined — a `listName`
 * absent from `lists` means "unknown", not "unmatched", so a caller that forgets to supply a
 * list gets no findings rather than false ones.
 */
export function findUnmatchedValues(
  record: Record<string, unknown> | null | undefined,
  config: EntityFormConfig | null | undefined,
  lists: LookupListMap = {},
  lang = 'en',
): UnmatchedValue[] {
  if (!record || !config?.tabs) return [];
  const found: UnmatchedValue[] = [];

  const optionsFor = (field: NestedFieldConfig): readonly DropdownOption[] | undefined => {
    if (field.options?.length) return field.options;
    if (!field.listName) return undefined;
    return lists instanceof Map ? lists.get(field.listName) : lists[field.listName];
  };

  const check = (
    field: NestedFieldConfig,
    value: unknown,
    path: string,
    tabId: string,
    options: readonly DropdownOption[],
  ): void => {
    if (value === null || value === undefined || value === '') return;
    if (options.some(option => valuesMatch(option, value, lang))) return;
    found.push({
      path,
      tabId,
      fieldId: field.id,
      ...(field.listName ? { listName: field.listName } : {}),
      value,
    });
  };

  const walkFields = (
    fields: NestedFieldConfig[] | undefined,
    container: unknown,
    basePath: string,
    tabId: string,
  ): void => {
    if (!container || typeof container !== 'object') return;
    for (const field of fields ?? []) {
      const value = (container as Record<string, unknown>)[field.id];
      const path = basePath ? `${basePath}.${field.id}` : field.id;

      if (field.type === 'group') {
        walkFields(field.children, value, path, tabId);
        continue;
      }
      if (field.type === 'array') {
        if (!Array.isArray(value)) continue;
        value.forEach((row, index) => walkFields(field.children, row, `${path}[${index}]`, tabId));
        continue;
      }
      if (!CHOICE_TYPES.has(field.type)) continue;

      const options = optionsFor(field);
      if (!options) continue;

      if (Array.isArray(value)) {
        value.forEach((entry, index) => check(field, entry, `${path}[${index}]`, tabId, options));
      } else {
        check(field, value, path, tabId, options);
      }
    }
  };

  const walkTabs = (tabs: NestedTabConfig[] | undefined): void => {
    for (const tab of tabs ?? []) {
      const path = getTabPath(config.tabs, tab.id) ?? [];
      const container = path.reduce<unknown>(
        (curr, key) => (curr == null ? curr : (curr as Record<string, unknown>)[key]),
        record,
      );
      walkFields(tab.fields, container, path.join('.'), tab.id);
      walkTabs(tab.children);
    }
  };

  walkTabs(config.tabs);
  return found;
}
