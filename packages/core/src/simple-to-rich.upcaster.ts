/**
 * simple-to-rich.upcaster.ts — migrates the old flat entity config model
 * (fields[] + field.tab) into the canonical nested EntityFormConfig model
 * (tabs[].fields[]).
 *
 * Register with migrateConfig so persisted flat configs stay loadable
 * across releases.
 */

import type { EntityFormConfig, NestedFieldConfig, NestedTabConfig } from './form-model.types';
import { normalizeLocalizedText } from './form-logic';

/**
 * Shape of a "simple" field from the old flat model.
 * Fields carry their own `tab` string to indicate which tab they belong to.
 */
interface SimpleField {
  id: string;
  type: string;
  tab?: string;
  label?: unknown;
  displayName?: string;
  name?: string;
  mandatory?: boolean;
  values?: unknown[];
  [key: string]: unknown;
}

/**
 * Shape of the old flat entity config (e.g., from the legacy `EntityComponent`).
 */
interface SimpleFlatConfig {
  entity?: string;
  type?: string;
  name?: unknown;
  fields?: SimpleField[];
  /** Legacy: array of `{ name, forms[] }` entity sections */
  entities?: Array<{ name: string; forms: SimpleField[] }>;
  [key: string]: unknown;
}

/**
 * Converts the old flat config model into a canonical nested `EntityFormConfig`.
 *
 * Conversion rules:
 * - `fields[].tab` → group fields by tab ID; each unique tab value becomes a `NestedTabConfig`
 * - If no `tab` on a field, all go into a default "general" tab
 * - `field.mandatory` → `validators.required`
 * - `field.values` (legacy dropdown options) → `options` as `DropdownOption[]`
 * - `field.displayName` or `field.name` → `label.en`
 * - Legacy `entities[].forms[]` → one tab per entity section
 */
export function simpleToRich(raw: unknown): EntityFormConfig {
  const config = raw as SimpleFlatConfig;

  const entityKey: string = config.entity ?? config.type ?? 'unknown';
  const name = normalizeLocalizedText(config.name ?? { en: entityKey });

  // ── Case 1: Legacy `entities[].forms[]` model ─────────────────────────────
  if (Array.isArray(config.entities) && config.entities.length > 0) {
    const tabs: NestedTabConfig[] = config.entities.map(entity => ({
      id: slugify(entity.name),
      label: { en: entity.name },
      visibility: true,
      fields: (entity.forms ?? []).map(f => simpleFieldToNested(f)),
    }));

    return { entity: entityKey, name, tabs };
  }

  // ── Case 2: Flat `fields[]` with optional `field.tab` ────────────────────
  const fields: SimpleField[] = Array.isArray(config.fields) ? config.fields : [];
  const tabMap = new Map<string, SimpleField[]>();

  for (const field of fields) {
    const tabId = field.tab ? slugify(field.tab) : 'general';
    if (!tabMap.has(tabId)) tabMap.set(tabId, []);
    tabMap.get(tabId)!.push(field);
  }

  if (tabMap.size === 0) {
    // No fields at all — produce a single empty general tab
    tabMap.set('general', []);
  }

  const tabs: NestedTabConfig[] = Array.from(tabMap.entries()).map(([tabId, tabFields], i) => ({
    id: tabId,
    label: { en: capitalize(tabId) },
    visibility: true,
    isPrimaryTab: i === 0,
    fields: tabFields.map(f => simpleFieldToNested(f)),
  }));

  return { entity: entityKey, name, tabs };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function simpleFieldToNested(f: SimpleField): NestedFieldConfig {
  const label = normalizeLocalizedText(f.label ?? f.displayName ?? f.name ?? f.id);
  const options = Array.isArray(f.values)
    ? (f.values as unknown[]).map(v => ({
        value: typeof v === 'object' && v !== null ? (v as Record<string, unknown>)['id'] ?? v : v,
        label: normalizeLocalizedText(
          typeof v === 'object' && v !== null
            ? ((v as Record<string, unknown>)['label'] ?? (v as Record<string, unknown>)['name'] ?? v)
            : v,
        ),
      }))
    : undefined;

  const field: NestedFieldConfig = {
    id: f.id,
    type: mapLegacyType(String(f.type ?? 'text')),
    label,
    visibility: true,
    validators: f.mandatory ? { required: true } : {},
  };

  if (options) field.options = options;

  return field;
}

/** Maps legacy type strings to the canonical `RichFieldType`. */
function mapLegacyType(t: string): NestedFieldConfig['type'] {
  const map: Record<string, NestedFieldConfig['type']> = {
    textbox:     'text',
    string:      'text',
    int:         'number',
    float:       'number',
    boolean:     'boolean',
    switch:      'boolean',
    bool:        'boolean',
    select:      'dropdown',
    multiselect: 'multiSelect',
    multi_select:'multiSelect',
    date_time:   'datetime',
    month_year:  'monthYear',
  };
  return (map[t.toLowerCase()] ?? t) as NestedFieldConfig['type'];
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function capitalize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
