/**
 * form-logic.ts — framework-agnostic pure form logic (no Angular, no moment).
 * Used by the renderer/builder (and portable to any consumer): label resolution, display
 * formatting, nested tab/record value access, mask resolution, and conditional visibility.
 */

import type {
  AutoPatchConfig,
  DropdownOption,
  EntityFormConfig,
  FormRule,
  LocalizedText,
  NestedFieldConfig,
  NestedTabConfig,
  PatchOnTrueMapping,
  RichFieldType,
  RuleEvaluationResult,
  RuleOperator,
} from './form-model.types';

const EMPTY = '—';

/** Resolve a localized text to a display string: `lang` → `en` → first value → ''. */
export function resolveLabel(text: LocalizedText | undefined | null, lang = 'en'): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text[lang] ?? text['en'] ?? Object.values(text).find(Boolean) ?? '';
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
      const opt = (options ?? []).find(o => o.value === raw);
      return opt ? resolveLabel(opt.label, lang) : String(raw);
    }

    case 'multiSelect': {
      if (!Array.isArray(raw)) return String(raw);
      return raw
        .map(item => {
          const opt = (options ?? []).find(o => o.value === item);
          return opt ? resolveLabel(opt.label, lang) : String(item);
        })
        .filter(Boolean)
        .join(', ');
    }

    default:
      return String(raw);
  }
}

// ─── Nested record access (honors flatData) ──────────────────────────────────

/** Find a tab anywhere in the (possibly nested) tab tree by id. */
export function findTab(tabs: NestedTabConfig[] | undefined, tabId: string): NestedTabConfig | null {
  for (const tab of tabs ?? []) {
    if (tab.id === tabId) return tab;
    const child = findTab(tab.children, tabId);
    if (child) return child;
  }
  return null;
}

/** The sub-object holding a tab's fields in a record — the record root when `flatData`. */
export function getTabData(tabId: string, record: any, config: EntityFormConfig): any {
  const tab = findTab(config.tabs, tabId);
  if (!tab) return null;
  return tab.flatData ? record : record?.[tabId];
}

/** Merge a tab's form value back into a record, honoring `flatData`. Returns the record. */
export function setTabData(record: any, tab: NestedTabConfig, formValue: Record<string, unknown>): any {
  const target = record ?? {};
  if (tab.flatData) Object.assign(target, formValue);
  else target[tab.id] = { ...(target[tab.id] ?? {}), ...formValue };
  return target;
}

/** Ensure every `array` field in the config is stored as an array (coerce null/undefined → []). */
export function normalizeArrayStructures(record: any, config: EntityFormConfig): any {
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
      walkFields(tab.fields, tab.flatData ? record : record?.[tab.id]);
      walkTabs(tab.children);
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
      if (values[key] !== expected) return false;
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

/**
 * Ensures a label value is always a well-formed LocalizedText object.
 * Coerces strings and plain primitives; passes objects through.
 */
export function normalizeLocalizedText(label: unknown): LocalizedText {
  if (!label) return { en: '' };
  if (typeof label === 'string') return { en: label };
  if (typeof label === 'object' && !Array.isArray(label)) return label as LocalizedText;
  return { en: String(label) };
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

  // Normalize options
  const rawOptions = (f['options'] ?? []) as unknown[];
  const options = (Array.isArray(rawOptions) ? rawOptions : []).map((opt: unknown) => {
    if (!opt) return { value: '', label: { en: '' } };
    if (typeof opt === 'string') return { value: opt, label: { en: opt } };
    if (typeof opt === 'object') {
      const o = opt as Record<string, unknown>;
      // Already { value, label: LocalizedText }
      if ('value' in o && 'label' in o) return { value: o['value'], label: normalizeLocalizedText(o['label']) };
      // Plain LocalizedText used as option label, no value wrapper
      return { value: o['en'] ?? Object.values(o)[0] ?? '', label: normalizeLocalizedText(o) };
    }
    return { value: opt, label: { en: String(opt) } };
  });

  return {
    ...rest,
    id: computedId,
    label: normalizeLocalizedText(f['label']),
    options,
    children: (children as unknown[]).map(c => normalizeField(c)),
  } as NestedFieldConfig;
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
    isPrimaryTab: (t['isPrimaryTab'] as boolean) ?? false,
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

// ─── Rule Engine Evaluator ────────────────────────────────────────────────────

/**
 * Evaluates a set of `FormRule`s against the current form values.
 * Rules are sorted by priority (ascending) before evaluation.
 * Returns sets of hidden fields/tabs, validation errors, warnings, and info banners.
 */
export function evaluateRules(
  rules: FormRule[],
  formValues: Record<string, unknown>,
  sessionBaseline?: Record<string, unknown>,
): RuleEvaluationResult {
  const result: RuleEvaluationResult = {
    hiddenFields: [],
    hiddenTabs: [],
    validationErrors: {},
    validationWarnings: {},
    infoBanners: {},
  };

  const sorted = [...rules].filter(r => r.enabled).sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    const triggerValue = formValues[rule.fieldId];
    const conditionsMet = rule.conditions.every(cond =>
      evaluateCondition(cond.operator, triggerValue, cond.value, cond.compareType === 'field'
        ? formValues[cond.compareToField ?? '']
        : cond.value, sessionBaseline?.[rule.fieldId])
    );

    if (!conditionsMet) continue;

    for (const target of rule.targets) {
      const action = rule.action;
      if (action.type === 'visibility') {
        if (action.value === false) {
          if (target.type === 'field') result.hiddenFields.push(target.id);
          else result.hiddenTabs.push(target.id);
        }
      } else if (action.type === 'validation') {
        result[action.severity === 'warning' ? 'validationWarnings' : 'validationErrors'][target.id] = String(action.value);
      } else if (action.type === 'info') {
        result.infoBanners[target.id] = String(action.value);
      }
    }
  }

  return result;
}

function evaluateCondition(
  operator: RuleOperator,
  value: unknown,
  ruleValue: unknown,
  compareValue: unknown,
  baseline?: unknown,
): boolean {
  const compare = compareValue !== undefined ? compareValue : ruleValue;
  const str = (v: unknown) => String(v ?? '').toLowerCase();

  switch (operator) {
    case 'EQUAL':           return value === compare;
    case 'NOT_EQUAL':       return value !== compare;
    case 'CONTAINS':        return str(value).includes(str(compare));
    case 'NOT_CONTAINS':    return !str(value).includes(str(compare));
    case 'STARTS_WITH':     return str(value).startsWith(str(compare));
    case 'ENDS_WITH':       return str(value).endsWith(str(compare));
    case 'IS_EMPTY':        return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    case 'IS_NOT_EMPTY':    return !(value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0));
    case 'LESS_THAN':       return Number(value) < Number(compare);
    case 'MORE_THAN':       return Number(value) > Number(compare);
    case 'LESS_THAN_EQUAL': return Number(value) <= Number(compare);
    case 'MORE_THAN_EQUAL': return Number(value) >= Number(compare);
    case 'DATE_BEFORE':     return new Date(value as string) < new Date(compare as string);
    case 'DATE_AFTER':      return new Date(value as string) > new Date(compare as string);
    case 'IN':              return Array.isArray(compare) ? compare.includes(value) : false;
    case 'NOT_IN':          return Array.isArray(compare) ? !compare.includes(value) : true;
    case 'HAS_ITEMS':       return Array.isArray(value) && value.length > 0;
    case 'VALUE_CHANGED':   return baseline !== undefined && value !== baseline;
    default:                return false;
  }
}

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

