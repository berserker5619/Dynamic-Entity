/**
 * form-logic.ts — framework-agnostic pure form logic (no Angular, no moment).
 * Used by the renderer/builder (and portable to any consumer): label resolution, display
 * formatting, nested tab/record value access, mask resolution, and conditional visibility.
 */

import type {
  AutoPatchConfig,
  DropdownOption,
  EntityFormConfig,
  LocalizedText,
  NestedFieldConfig,
  NestedTabConfig,
  PatchOnTrueMapping,
  RawDropdownOption,
  RichFieldType,
} from './form-model.types';

const EMPTY = '—';

/** Resolve a localized text to a display string: `lang` → `en` → first value → ''. */
export function resolveLabel(text: LocalizedText | undefined | null, lang = 'en'): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text[lang] ?? text['en'] ?? Object.values(text).find(Boolean) ?? '';
}

/**
 * The value an option stores. For the canonical shape that is the option object itself —
 * the displayed text **is** the value.
 *
 * There is deliberately no `{ value, label }` branch here: options are normalised to one
 * shape when a config enters the library (`normalizeConfigOptions`), so honouring a legacy
 * wrapper at this depth would let un-normalised input produce scalar values alongside
 * object values in the same form — the ambiguity the single shape exists to remove.
 */
export function getOptionStoredValue(option: unknown): unknown {
  if (option == null) return null;
  if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
    return option;
  }
  return option;
}

/**
 * Upcast any legacy option shape to the canonical `LocalizedText`.
 *
 * `{ value, label }` keeps the **label** — the label is what the user picked and what the
 * displayed-text-is-the-value contract stores. The old scalar `value` is dropped, so a
 * record saved under it will no longer match by identity; `valuesMatch` covers that by
 * comparing resolved labels.
 */
export function normalizeOption(option: RawDropdownOption | null | undefined): DropdownOption {
  if (option === null || option === undefined) return { en: '' };
  if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
    return { en: String(option) };
  }
  if (typeof option === 'object') {
    const o = option as Record<string, unknown>;
    if ('label' in o && o['label'] !== undefined) return normalizeLocalizedText(o['label']);
    if ('value' in o && o['value'] !== undefined) return normalizeLocalizedText(o['value']);
    return normalizeLocalizedText(o);
  }
  return { en: String(option) };
}

/**
 * Enforce the option-shape invariant on a whole config, at the point it enters the library.
 *
 * `DropdownOption` is `LocalizedText`, but a config arrives as plain JSON from storage or an
 * API and TypeScript cannot police that. Without this the type is a compile-time claim the
 * runtime never checks, and a legacy config would quietly produce scalar control values
 * alongside object ones in the same form.
 *
 * Returns a new config when anything changed, and the original object when nothing did, so
 * callers can use identity to skip redundant work.
 */
export function normalizeConfigOptions(config: EntityFormConfig): EntityFormConfig {
  // The signature says EntityFormConfig, but this is a library boundary: the renderer calls
  // it with whatever a host bound to `[config]`, and a null there is a bad input rather than
  // a reason to throw inside change detection.
  if (!config || typeof config !== 'object') return config;

  let changed = false;

  /** Two canonical options are the same when they carry the same languages and text. */
  const sameOption = (a: DropdownOption, b: unknown): boolean => {
    if (a === b) return true;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    const other = b as Record<string, unknown>;
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(other).length) return false;
    return aKeys.every(k => a[k] === other[k]);
  };

  const normalizeFieldOptions = (field: NestedFieldConfig): NestedFieldConfig => {
    // A malformed entry inside `fields` is passed through untouched rather than crashing the
    // walk: `validateConfig` is what reports it, and normalising is not the place to decide
    // a config is unusable.
    if (!field || typeof field !== 'object') return field;

    const children = asTyped(field.children)?.map(normalizeFieldOptions);
    const childrenChanged = !!children?.some((c, i) => c !== asArrayLoose(field.children)[i]);

    let options = field.options;
    let listName = field.listName;

    if (Array.isArray(options)) {
      const next = options
        .filter(opt => opt !== null && opt !== undefined)
        .map(opt => normalizeOption(opt as RawDropdownOption));
      // Compared by value, not reference: `normalizeLocalizedText` always allocates, so an
      // already-canonical option comes back as an equal-but-distinct object.
      if (next.length !== options.length || next.some((o, i) => !sameOption(o, options![i]))) {
        options = next;
        changed = true;
      }
    }

    if (options && options.length > 0 && typeof listName === 'string') {
      listName = undefined;
      changed = true;
    }

    if (options === field.options && listName === field.listName && !childrenChanged) return field;
    changed = true;
    const res: NestedFieldConfig = {
      ...field,
      ...(children ? { children } : {}),
      ...(options ? { options } : {}),
    };
    if (listName === undefined && typeof field.listName === 'string') {
      delete res.listName;
    }
    return res;
  };

  const normalizeTabOptions = (tab: NestedTabConfig): NestedTabConfig => {
    if (!tab || typeof tab !== 'object') return tab;

    const fields = asTyped(tab.fields)?.map(normalizeFieldOptions);
    const children = asTyped(tab.children)?.map(normalizeTabOptions);
    const fieldsChanged = !!fields?.some((f, i) => f !== asArrayLoose(tab.fields)[i]);
    const childrenChanged = !!children?.some((c, i) => c !== asArrayLoose(tab.children)[i]);

    if (!fieldsChanged && !childrenChanged) return tab;
    return { ...tab, ...(fields ? { fields } : {}), ...(children ? { children } : {}) };
  };

  const tabs = asTyped(config.tabs)?.map(normalizeTabOptions);
  if (!changed) return config;
  return { ...config, tabs: tabs ?? [] };
}

/** Check if two values (scalars or LocalizedText objects) match. */
export function valuesMatch(val1: unknown, val2: unknown, lang = 'en'): boolean {
  if (val1 === val2) return true;
  // At this point at least one side is null or undefined, and `==` is deliberate: a record
  // holding `null` and one holding `undefined` are both "no value" and must compare equal.
  // eslint-disable-next-line eqeqeq
  if (val1 == null || val2 == null) return val1 == val2;
  if (typeof val1 === 'object' || typeof val2 === 'object') {
    const l1 = resolveOptionLabel(val1, lang);
    const l2 = resolveOptionLabel(val2, lang);
    if (l1 && l2 && l1 === l2) return true;
    if (matchesInAnyLanguage(val1, val2)) return true;
    return canonicalizeValue(val1) === canonicalizeValue(val2);
  }
  return String(val1) === String(val2);
}

/**
 * Match on **any** language, not only the active one.
 *
 * The stored value carries every language (§2), so renaming one language of an option must not
 * orphan a record whose other languages still match: a record holding
 * `{ en: 'Active', de: 'Aktiv' }` still matches an option renamed to
 * `{ en: 'Active', de: 'Aktiviert' }` while `lang` is `de`. Without this, a rename in a
 * language nobody is looking at silently breaks display and comparison in the one they are.
 *
 * Two objects match when they agree on a shared key; an object and a scalar match when any of
 * the object's texts equals the scalar (the legacy single-language record). Keys are compared
 * like-for-like rather than as a flat value set — this helper alone will not equate
 * `{ en: 'A' }` with `{ de: 'A' }`. Note that `valuesMatch` as a whole is already looser than
 * that: `resolveLabel` falls back to the first available language, so two objects with no
 * language in common but the same spelling match on the label comparison above, and did
 * before this existed. This adds a rule; it does not tighten the ones around it.
 *
 * The accepted cost: two options that share one language's text but differ in another now
 * compare equal. That is the correct reading for a renamed value, which is the case this
 * exists to serve.
 */
function matchesInAnyLanguage(val1: unknown, val2: unknown): boolean {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  if (isPlainObject(val1) && isPlainObject(val2)) {
    return Object.keys(val1).some(key => {
      const a = val1[key];
      const b = val2[key];
      return typeof a === 'string' && a !== '' && a === b;
    });
  }

  const [obj, scalar] = isPlainObject(val1) ? [val1, val2] : isPlainObject(val2) ? [val2, val1] : [];
  if (!obj || scalar === undefined || typeof scalar === 'object') return false;
  const text = String(scalar);
  return text !== '' && Object.values(obj).some(v => typeof v === 'string' && v === text);
}

/**
 * Order-independent projection of a value for equality.
 *
 * `JSON.stringify` was used here and is key-order sensitive: `{en:'A',de:'B'}` and
 * `{de:'B',en:'A'}` are the same option written by two different serialisers, and must not
 * compare unequal just because the keys arrived in a different order.
 */
export function canonicalizeValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(canonicalizeValue).join('|');

  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .map(key => `${key}:${canonicalizeValue(obj[key])}`)
    .join('|');
}

/** Resolve option value for dropdown/radio/multiSelect options as a display string. */
export function resolveOptionValue(option: unknown, lang = 'en'): string | number | boolean {
  const stored = getOptionStoredValue(option);
  if (stored == null) return '';
  if (typeof stored === 'object') {
    return resolveLabel(stored as LocalizedText, lang);
  }
  return stored as string | number | boolean;
}

/** Resolve option display label for dropdown/radio/multiSelect options. Handles {value, label}, LocalizedText, or primitives. */
export function resolveOptionLabel(option: unknown, lang = 'en'): string {
  if (option == null) return '';
  if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
    return String(option);
  }
  if (typeof option === 'object') {
    const opt = option as Record<string, unknown>;
    if ('label' in opt && opt['label'] !== undefined) {
      return resolveLabel(opt['label'] as LocalizedText, lang);
    }
    return resolveLabel(opt as LocalizedText, lang);
  }
  return String(option);
}

/** Format a raw stored value for read-only display, per field type. */
/**
 * How a date, datetime or time is turned into display text.
 *
 * The defaults use the browser's locale, which is what this has always done — passing the
 * form's `language` instead would silently change the format for every existing consumer
 * whose browser is not set to it, and nobody asked for that. `language` selects *content*
 * (which `LocalizedText` key), which is a different question from how to format a date.
 *
 * A host that wants the two tied together, or a fixed format, replaces these:
 *
 * ```ts
 * setDateFormatters({ date: (d, lang) => d.toLocaleDateString(lang ?? []) });
 * ```
 */
export interface DateFormatters {
  date(value: Date, lang?: string): string;
  datetime(value: Date, lang?: string): string;
  time(value: Date, lang?: string): string;
}

const DEFAULT_DATE_FORMATTERS: DateFormatters = {
  date: d => d.toLocaleDateString(),
  datetime: d => d.toLocaleString(),
  time: d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
};

let formatters: DateFormatters = DEFAULT_DATE_FORMATTERS;

/**
 * Override how dates are displayed, for the whole application.
 *
 * Module-level rather than an injection token because `formatDisplayValue` is a pure
 * function in a framework-agnostic package — the renderer, the builder and a Node CLI all
 * call it, and only one of those has an injector. Pass a partial object to change one kind;
 * call with no argument to restore the defaults.
 */
export function setDateFormatters(next?: Partial<DateFormatters>): void {
  formatters = next ? { ...DEFAULT_DATE_FORMATTERS, ...next } : DEFAULT_DATE_FORMATTERS;
}

export function formatDisplayValue(
  type: RichFieldType | string,
  options: DropdownOption[] | undefined,
  raw: unknown,
  lang = 'en',
): string {
  if (raw === null || raw === undefined || raw === '') return EMPTY;

  switch (type) {
    case 'boolean':
    case 'checkbox':
      return raw === true || raw === 'true' ? 'Yes' : 'No';

    case 'password':
      return raw ? '••••••••' : EMPTY;

    case 'date':
    case 'monthYear': {
      const d = new Date(raw as string);
      return Number.isNaN(d.getTime()) ? EMPTY : formatters.date(d, lang);
    }
    case 'datetime': {
      const d = new Date(raw as string);
      return Number.isNaN(d.getTime()) ? EMPTY : formatters.datetime(d, lang);
    }

    // A bare time has no date and no zone, so it is stored as `HH:mm` and never goes
    // through `new Date(raw)` — which cannot parse it at all. The arbitrary date below
    // exists only to reach the locale time formatter.
    case 'time': {
      const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(raw));
      if (!match) return EMPTY;
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours > 23 || minutes > 59) return EMPTY;
      return formatters.time(new Date(2000, 0, 1, hours, minutes), lang);
    }

    case 'dropdown':
    case 'radio': {
      const opt = (options ?? []).find(o => valuesMatch(getOptionStoredValue(o), raw, lang));
      if (opt) return resolveOptionLabel(opt, lang);
      if (typeof raw === 'object') return resolveLabel(raw as LocalizedText, lang);
      return String(raw);
    }

    case 'multiSelect': {
      if (!Array.isArray(raw)) return typeof raw === 'object' ? resolveLabel(raw as LocalizedText, lang) : String(raw);
      return raw
        .map(item => {
          const opt = (options ?? []).find(o => valuesMatch(getOptionStoredValue(o), item, lang));
          if (opt) return resolveOptionLabel(opt, lang);
          if (typeof item === 'object') return resolveLabel(item as LocalizedText, lang);
          return String(item);
        })
        .filter(Boolean)
        .join(', ');
    }

    default:
      return typeof raw === 'object' ? resolveLabel(raw as LocalizedText, lang) : String(raw);
  }
}

// ─── Nested record access & Dot-Notation ──────────────────────────────────────

/**
 * Keys that must never be walked or written through when building a path.
 *
 * Paths here come from config (`refererField`, tab ids), and config is authored in a
 * low-code builder or loaded from an API — it is data, not code the library controls. A
 * path of `__proto__.isAdmin` would otherwise write onto `Object.prototype` and affect
 * every object in the running application.
 */
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** True when a dot-path contains a segment that could reach an object's prototype. */
export function isUnsafePath(path: string): boolean {
  return path.split('.').some(part => UNSAFE_PATH_KEYS.has(part));
}

/** Extract a nested property value by dot-notation path (e.g. "employment.jobTitle"). */
export function getValueByPath(obj: any, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  // Reading through `__proto__` would surface prototype internals as a field value.
  if (parts.some(part => UNSAFE_PATH_KEYS.has(part))) return undefined;

  let curr = obj;
  for (const part of parts) {
    if (curr == null) return undefined;
    curr = curr[part];
  }
  return curr;
}

/** Set a nested property value by dot-notation path (e.g. "employment.jobTitle"). */
export function setValueByPath(obj: any, path: string, value: unknown): void {
  if (!obj || !path) return;
  const parts = path.split('.');
  if (parts.some(part => UNSAFE_PATH_KEYS.has(part))) return;

  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (curr[part] == null || typeof curr[part] !== 'object') {
      curr[part] = {};
    }
    curr = curr[part];
  }
  curr[parts[parts.length - 1]] = value;
}

/** Find a tab anywhere in the (possibly nested) tab tree by id. */
export function findTab(tabs: NestedTabConfig[] | undefined, tabId: string): NestedTabConfig | null {
  for (const tab of tabs ?? []) {
    if (tab.id === tabId) return tab;
    const child = findTab(tab.children, tabId);
    if (child) return child;
  }
  return null;
}

/** Returns the array of path keys for a given tab in the tab hierarchy, respecting `flatData`. */
export function getTabPath(tabs: NestedTabConfig[] | undefined, targetId: string, currentPath: string[] = []): string[] | null {
  for (const tab of tabs ?? []) {
    const nextPath = tab.flatData ? currentPath : [...currentPath, tab.id];
    if (tab.id === targetId) return nextPath;
    const childPath = getTabPath(tab.children, targetId, nextPath);
    if (childPath) return childPath;
  }
  return null;
}

/** The sub-object holding a tab's fields in a record — the record root when `flatData`. */
export function getTabData(tabId: string, record: any, config?: EntityFormConfig): any {
  if (!record) return null;
  const tabs = config?.tabs;
  if (!tabs) {
    return record[tabId] ?? record;
  }
  const path = getTabPath(tabs, tabId);
  if (!path) {
    const tab = findTab(tabs, tabId);
    return tab?.flatData ? record : record?.[tabId];
  }
  if (path.length === 0) return record;
  let curr = record;
  for (const p of path) {
    if (curr == null) return null;
    curr = curr[p];
  }
  return curr;
}

/** Merge a tab's form value back into a record, honoring `flatData`. Returns the record. */
export function setTabData(
  record: any,
  tab: NestedTabConfig | string,
  formValue: Record<string, unknown>,
  config?: EntityFormConfig,
): any {
  const target = record ?? {};
  const tabId = typeof tab === 'string' ? tab : tab.id;
  const tabs = config?.tabs ?? (typeof tab === 'object' ? [tab] : undefined);
  const path = tabs ? getTabPath(tabs, tabId) : (typeof tab === 'object' && tab.flatData ? [] : [tabId]);

  if (!path || path.length === 0) {
    Object.assign(target, formValue);
    return target;
  }
  // Tab ids are config data too, and this walk creates intermediate objects the same way.
  if (path.some(p => UNSAFE_PATH_KEYS.has(p))) return target;

  let curr = target;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    if (curr[p] == null || typeof curr[p] !== 'object') {
      curr[p] = {};
    }
    curr = curr[p];
  }
  const last = path[path.length - 1];
  curr[last] = { ...(curr[last] ?? {}), ...formValue };
  return target;
}

/** Ensure every `array` field in the config is stored as an array (coerce null/undefined → []). */
export function normalizeArrayStructures(record: any, config: EntityFormConfig): any {
  if (!record) return record;
  const walkFields = (fields: NestedFieldConfig[] | undefined, container: any) => {
    for (const f of fields ?? []) {
      if (!container) continue;
      if (f.type === 'array') {
        if (!Array.isArray(container[f.id])) container[f.id] = container[f.id] == null ? [] : [container[f.id]];
      } else if (f.type === 'group' && container[f.id]) {
        walkFields(f.children, container[f.id]);
      }
    }
  };
  const walkTabs = (tabs: NestedTabConfig[] | undefined) => {
    for (const tab of tabs ?? []) {
      const container = getTabData(tab.id, record, config);
      walkFields(tab.fields, container);
      if (tab.children) walkTabs(tab.children);
    }
  };
  walkTabs(config.tabs);
  return record;
}

// ─── Masking (3-level: form → tab → field) ────────────────────────────────────

export function resolveEffectiveMask(formMask?: boolean, tabMask?: boolean, fieldMask?: boolean): boolean {
  return !!(formMask || tabMask || fieldMask);
}

/** Whether a field should be masked for a user (any of the user's roles is a masked role). */
export function shouldMaskField(
  field: NestedFieldConfig,
  tab: NestedTabConfig | undefined,
  config: EntityFormConfig,
  userRoles: string[],
  maskedRoles: string[],
): boolean {
  if (!maskedRoles.some(r => userRoles.includes(r))) return false;
  return resolveEffectiveMask(config.maskData, tab?.maskData, field.maskData);
}

// ─── Conditional visibility (showWhen / dependsOn) ────────────────────────────

/** Evaluate a field's static `showWhen` visibility against the current record values. */
export function evaluateFieldVisibility(field: NestedFieldConfig, values: Record<string, unknown>): boolean {
  if (field.visibility === false) return false;
  if (field.showWhen) {
    for (const [key, expected] of Object.entries(field.showWhen)) {
      if (!valuesMatch(values[key], expected)) return false;
    }
  }
  return true;
}

// ─── Label / ID utilities ────────────────────────────────────────────────────

/**
 * Converts a human label into a camelCase slug field ID.
 * Example: "Employee Count" → "employeeCount", "first_name" → "firstName"
 */
export function labelToId(label: string): string {
  if (!label) return '';
  const cleaned = label
    .trim()
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .replace(/[_-]+/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

/** Collision-safe ID generator. Prefix defaults to 'field'. */
let _idCounter = 0;
export function uniqueId(prefix = 'field'): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`;
}

/**
 * Maps a BCP-47 locale string to the 2-char language code used in LocalizedText.
 * Falls back to 'en' for any unrecognised locale.
 * Example: 'de-DE' → 'de', 'fr-FR' → 'fr', 'en-US' → 'en'
 */
export function getLocaleLang(locale: string): string {
  if (!locale) return 'en';
  const prefix = locale.split('-')[0].toLowerCase();
  const supported = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ar'];
  return supported.includes(prefix) ? prefix : 'en';
}

/** Coerces a value into a valid LocalizedText map ({ en: string }). */
export function normalizeLocalizedText(value: unknown): LocalizedText {
  if (!value) return { en: '' };
  if (typeof value === 'string') return { en: value };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const out: LocalizedText = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') out[k] = v;
      else if (v != null) out[k] = String(v);
    }
    if (Object.keys(out).length > 0) return out;
  }
  return { en: String(value) };
}

// ─── Config normalization (from raw API / storage) ────────────────────────────

/**
 * Normalises a raw field from storage into a well-typed NestedFieldConfig.
 * Handles legacy string options, label/value pairs, object-keyed children.
 */
export function normalizeField(field: unknown): NestedFieldConfig {
  if (!field || typeof field !== 'object') return field as NestedFieldConfig;
  const f = field as Record<string, unknown>;
  const computedId = String(f['id'] ?? f['_id'] ?? '');
  const { _id, ...rest } = f;
  void _id; // suppress unused-var warning

  // Normalize children — handle object-keyed map: { fieldId: { ... } } → array
  let children = (f['children'] ?? []) as unknown[];
  if (children && !Array.isArray(children)) {
    children = Object.entries(children as Record<string, unknown>).map(([id, c]) => ({
      ...(c as object),
      id,
    }));
  }

  // Normalise options to the one canonical shape: a language-keyed object whose displayed
  // text is the stored value. Legacy shapes ({value,label}, bare string/number) are upcast
  // here, at the parse boundary, so nothing downstream has to branch on shape.
  // Nullish entries are dropped rather than upcast: a blank option is a phantom choice in
  // the dropdown, which is worse than the missing entry it came from.
  const rawOptions = f['options'];
  const normalizedOptions = Array.isArray(rawOptions)
    ? rawOptions.filter((opt: unknown) => opt !== null && opt !== undefined).map(opt => normalizeOption(opt as RawDropdownOption))
    : undefined;

  const normalized: NestedFieldConfig = {
    ...rest,
    id: computedId,
    label: normalizeLocalizedText(f['label']),
    children: (children as unknown[]).map(c => normalizeField(c)),
  } as NestedFieldConfig;

  // Only attach options when they were present in the raw data
  if (normalizedOptions !== undefined) normalized.options = normalizedOptions;

  // Option/list exclusivity: inline options win over listName. Drop listName when inline options exist.
  if (normalized.options && normalized.options.length > 0 && typeof normalized.listName === 'string') {
    delete normalized.listName;
  }

  return normalized;
}

/**
 * Normalises a raw tab from storage, supporting object-keyed fields and children.
 */
/**
 * Coerce a `tabs` / `fields` / `children` slot into an array.
 *
 * Older configs stored these as objects keyed by id, so an object is converted and its key
 * lifted into `id`. Anything else — a string, a number, `null` — is not a collection and
 * becomes an empty one, because the alternative is `.map` throwing on data the caller has
 * no control over.
 */
/** Comparison helper for the structural-sharing checks; never indexes a non-array. */
function asArrayLoose(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Keep `undefined` as `undefined` — the structural-sharing checks below distinguish "absent"
 * from "empty" — but turn any other non-array into an empty one. `?.map` only ever guarded
 * the first of those, so a `fields: ''` from a hand-edited config threw.
 */
function asTyped<T>(value: T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [];
}

function toEntryArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([id, v]) =>
      v && typeof v === 'object' ? { ...(v as object), id } : { id },
    );
  }
  return [];
}

export function normalizeTab(tab: unknown): NestedTabConfig {
  if (!tab || typeof tab !== 'object') return tab as NestedTabConfig;
  const t = tab as Record<string, unknown>;
  const computedId = String(t['id'] ?? t['_id'] ?? '');
  const { _id, ...rest } = t;
  void _id;

  // `x && !Array.isArray(x)` let every *falsy* non-array through untouched — a `''` or a
  // `0` in `fields` reached `.map` and threw. Anything that is not an array is either an
  // object to convert or nothing usable at all.
  const fields = toEntryArray(t['fields']);
  const children = toEntryArray(t['children']);

  return {
    ...rest,
    id: computedId,
    label: normalizeLocalizedText(t['label']),
    isPrimaryTab: Boolean(t['isPrimaryTab']),
    fields: fields.map(f => normalizeField(f)),
    children: children.map(c => normalizeTab(c)),
  } as NestedTabConfig;
}

/**
 * Normalises a full raw EntityFormConfig from storage/API.
 * Handles both array-based and object-keyed tabs.
 */
export function normalizeConfig(config: unknown): EntityFormConfig {
  if (!config || typeof config !== 'object') return config as EntityFormConfig;
  const c = config as Record<string, unknown>;
  const computedId = String(c['id'] ?? c['_id'] ?? '');
  const { _id, ...rest } = c;
  void _id;

  const tabs = toEntryArray(c['tabs']);

  return {
    ...rest,
    id: computedId,
    name: normalizeLocalizedText(c['name'] ?? { en: (c['entity'] as string) ?? 'New Entity' }),
    isSystemDefined: (c['isSystemDefined'] as boolean) ?? false,
    tabs: tabs.map(t => normalizeTab(t)),
  } as unknown as EntityFormConfig;
}

// ─── Rule evaluation ─────────────────────────────────────────────────────────
// Rules live in `rules-engine.ts` (`evaluateFormRules`). A second implementation used to
// sit here with subtly different semantics — strict `===` for EQUAL where the engine
// coerces — and no consumer. Two exported engines meant an importer could silently get
// the wrong comparison rules, so this one was removed rather than kept in sync.

// ─── AutoPatch / PatchOnTrue ──────────────────────────────────────────────────

/**
 * Builds a partial patch object for a target tab from an autoPatch config
 * and the selected entity reference record.
 * Returns `{ fieldId: value }` pairs to patch into the target tab's form.
 */
export function applyAutoPatch(
  config: AutoPatchConfig,
  selectedRecord: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const mapping of config.mappings) {
    if (mapping.source in selectedRecord) {
      patch[mapping.target] = selectedRecord[mapping.source];
    }
  }
  return patch;
}

/**
 * When a boolean field flips to `true`, copy `from` → `to` fields within the same record.
 * Returns partial patch of `{ toFieldId: fromFieldValue }`.
 */
export function applyPatchOnTrue(
  mappings: PatchOnTrueMapping[],
  record: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const mapping of mappings) {
    if (mapping.from in record) {
      patch[mapping.to] = record[mapping.from];
    }
  }
  return patch;
}

