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
  RichFieldType,
} from './form-model.types';

const EMPTY = '—';

/** Resolve a localized text to a display string: `lang` → `en` → first value → ''. */
export function resolveLabel(text: LocalizedText | undefined | null, lang = 'en'): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text[lang] ?? text['en'] ?? Object.values(text).find(Boolean) ?? '';
}

/** Resolve the actual stored value for an option (LocalizedText object, scalar, or opt.value). */
export function getOptionStoredValue(option: unknown): any {
  if (option == null) return null;
  if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
    return option;
  }
  if (typeof option === 'object') {
    const opt = option as Record<string, any>;
    if ('value' in opt && opt['value'] !== undefined) {
      return opt['value'];
    }
    return opt;
  }
  return option;
}

/** Check if two values (scalars or LocalizedText objects) match. */
export function valuesMatch(val1: unknown, val2: unknown, lang = 'en'): boolean {
  if (val1 === val2) return true;
  if (val1 == null || val2 == null) return val1 == val2;
  if (typeof val1 === 'object' || typeof val2 === 'object') {
    const l1 = resolveOptionLabel(val1, lang);
    const l2 = resolveOptionLabel(val2, lang);
    if (l1 && l2 && l1 === l2) return true;
    return JSON.stringify(val1) === JSON.stringify(val2);
  }
  return String(val1) === String(val2);
}

/** Resolve option value for dropdown/radio/multiSelect options as a display string. */
export function resolveOptionValue(option: unknown, lang = 'en'): any {
  const stored = getOptionStoredValue(option);
  if (stored == null) return '';
  if (typeof stored === 'object') {
    return resolveLabel(stored as LocalizedText, lang);
  }
  return stored;
}

/** Resolve option display label for dropdown/radio/multiSelect options. Handles {value, label}, LocalizedText, or primitives. */
export function resolveOptionLabel(option: unknown, lang = 'en'): string {
  if (option == null) return '';
  if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
    return String(option);
  }
  if (typeof option === 'object') {
    const opt = option as Record<string, any>;
    if ('label' in opt && opt['label'] !== undefined) {
      return resolveLabel(opt['label'], lang);
    }
    return resolveLabel(opt as LocalizedText, lang);
  }
  return String(option);
}

/** Format a raw stored value for read-only display, per field type. */
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
      return Number.isNaN(d.getTime()) ? EMPTY : d.toLocaleDateString();
    }
    case 'datetime': {
      const d = new Date(raw as string);
      return Number.isNaN(d.getTime()) ? EMPTY : d.toLocaleString();
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

/** Extract a nested property value by dot-notation path (e.g. "employment.jobTitle"). */
export function getValueByPath(obj: any, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
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

  // Normalize options — only include if the raw field had options or children
  const rawOptions = f['options'];
  const normalizedOptions = Array.isArray(rawOptions)
    ? rawOptions.map((opt: unknown) => {
        if (!opt) return { value: '', label: { en: '' } };
        if (typeof opt === 'string') return { value: opt, label: { en: opt } };
        if (typeof opt === 'object') {
          const o = opt as Record<string, unknown>;
          // Already { value, label: LocalizedText }
          if ('value' in o && 'label' in o) return { value: o['value'], label: normalizeLocalizedText(o['label']) };
          // Plain LocalizedText used as option label/value directly
          const loc = normalizeLocalizedText(o);
          return { value: loc, label: loc };
        }
        return { value: opt, label: { en: String(opt) } };
      })
    : undefined;

  const normalized: NestedFieldConfig = {
    ...rest,
    id: computedId,
    label: normalizeLocalizedText(f['label']),
    children: (children as unknown[]).map(c => normalizeField(c)),
  } as NestedFieldConfig;

  // Only attach options when they were present in the raw data
  if (normalizedOptions !== undefined) normalized.options = normalizedOptions;

  return normalized;
}

/**
 * Normalises a raw tab from storage, supporting object-keyed fields and children.
 */
export function normalizeTab(tab: unknown): NestedTabConfig {
  if (!tab || typeof tab !== 'object') return tab as NestedTabConfig;
  const t = tab as Record<string, unknown>;
  const computedId = String(t['id'] ?? t['_id'] ?? '');
  const { _id, ...rest } = t;
  void _id;

  let fields = (t['fields'] ?? []) as unknown[];
  if (fields && !Array.isArray(fields)) {
    fields = Object.entries(fields as Record<string, unknown>).map(([id, f]) => ({ ...(f as object), id }));
  }

  let children = (t['children'] ?? []) as unknown[];
  if (children && !Array.isArray(children)) {
    children = Object.entries(children as Record<string, unknown>).map(([id, c]) => ({ ...(c as object), id }));
  }

  return {
    ...rest,
    id: computedId,
    label: normalizeLocalizedText(t['label']),
    isPrimaryTab: Boolean(t['isPrimaryTab']),
    fields: (fields as unknown[]).map(f => normalizeField(f)),
    children: (children as unknown[]).map(c => normalizeTab(c)),
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

  let tabs = (c['tabs'] ?? []) as unknown[];
  if (tabs && !Array.isArray(tabs)) {
    tabs = Object.entries(tabs as Record<string, unknown>).map(([id, t]) => ({ ...(t as object), id }));
  }

  return {
    ...rest,
    id: computedId,
    name: normalizeLocalizedText(c['name'] ?? { en: (c['entity'] as string) ?? 'New Entity' }),
    isSystemDefined: (c['isSystemDefined'] as boolean) ?? false,
    tabs: (tabs as unknown[]).map(t => normalizeTab(t)),
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

