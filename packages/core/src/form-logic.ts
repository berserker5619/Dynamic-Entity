/**
 * form-logic.ts — framework-agnostic pure form logic (no Angular, no moment).
 * Used by the renderer/builder (and portable to any consumer): label resolution, display
 * formatting, nested tab/record value access, mask resolution, and conditional visibility.
 */

import type {
  DropdownOption,
  EntityFormConfig,
  LocalizedText,
  NestedFieldConfig,
  NestedTabConfig,
  RichFieldType,
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
