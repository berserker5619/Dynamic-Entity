/**
 * entity-reference.types.ts — contracts for consumer entity-reference option loaders & cascades.
 *
 * Framework-agnostic on purpose: the loader may return a plain array, a Promise, or anything
 * `Subscribable` (an rxjs `Observable` satisfies the structural type without core depending on rxjs).
 */

import type { EntityReferenceConfig, LocalizedText, NestedFieldConfig } from './form-model.types';
import { resolveLabel } from './form-logic';

/** One selectable option. `record` is the full linked record — it feeds `autoPatch`. */
export interface ReferenceOption {
  value: any;
  label: string;
  record?: Record<string, unknown>;
}

/** Context handed to a loader so it can filter/cascade/localise server-side. */
export interface ReferenceLoaderContext {
  /** Current value of `entityReference.parentField`, when this field cascades. */
  parentValue?: unknown;
  /** `entityReference.filters` merged with any caller-supplied filters. */
  filters?: Record<string, unknown>;
  /** Active language, for loaders that localise their labels. */
  lang?: string;
}

/** Minimal structural stand-in for `Observable<T>` — avoids an rxjs dependency in core. */
export interface Subscribable<T> {
  subscribe(observer: {
    next?: (value: T) => void;
    error?: (err: any) => void;
    complete?: () => void;
  }): unknown;
}

/** Anything a loader is allowed to return. */
export type ReferenceLoaderResult =
  | ReferenceOption[]
  | Promise<ReferenceOption[]>
  | Subscribable<ReferenceOption[]>;

/**
 * Consumer-registered option loader.
 *
 * `ctx` is optional so a zero-arg loader (`() => myService.list()`) remains a valid,
 * type-compatible registration.
 */
export type EntityReferenceLoader = (ctx?: ReferenceLoaderContext) => ReferenceLoaderResult;

/** Raw loader output before normalisation — records, primitives, or already-formed options. */
export type RawReferenceItem = ReferenceOption | Record<string, unknown> | string | number;

/**
 * Build an option label from a record using `displayFields`.
 * Falls back to `label`/`name`/`title`, then the raw value.
 */
export function buildReferenceLabel(
  record: Record<string, unknown>,
  displayFields: string[] | undefined,
  lang = 'en',
): string {
  const parts = (displayFields ?? [])
    .map(path => getByPath(record, path))
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(v => (typeof v === 'object' ? resolveLabel(v as LocalizedText, lang) : String(v)))
    .filter(Boolean);

  if (parts.length) return parts.join(' ');

  const fallback = record['label'] ?? record['name'] ?? record['title'];
  if (fallback !== null && fallback !== undefined) {
    return typeof fallback === 'object' ? resolveLabel(fallback as LocalizedText, lang) : String(fallback);
  }
  return String(record['value'] ?? record['id'] ?? record['_id'] ?? '');
}

/** Read a dot-path (`a.b.c`) out of a record. Returns `undefined` for any missing segment. */
export function getByPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

/**
 * Normalise whatever a loader returned into `ReferenceOption[]`.
 * Accepts primitives, `{ value, label }` options, and bare records (labelled via `displayFields`).
 */
export function normalizeReferenceOptions(
  raw: RawReferenceItem[] | null | undefined,
  cfg?: EntityReferenceConfig,
  lang = 'en',
): ReferenceOption[] {
  if (!Array.isArray(raw)) return [];

  return raw.map(item => {
    if (item === null || item === undefined) return { value: '', label: '' };

    if (typeof item === 'string' || typeof item === 'number') {
      return { value: item, label: String(item) };
    }

    const rec = item as Record<string, unknown>;
    const hasOptionShape = 'value' in rec && 'label' in rec;

    if (hasOptionShape) {
      const label = rec['label'];
      return {
        value: rec['value'],
        label: typeof label === 'object' ? resolveLabel(label as LocalizedText, lang) : String(label ?? ''),
        record: (rec['record'] as Record<string, unknown>) ?? rec,
      };
    }

    return {
      value: rec['value'] ?? rec['id'] ?? rec['_id'] ?? '',
      label: buildReferenceLabel(rec, cfg?.displayFields, lang),
      record: rec,
    };
  });
}

/**
 * Apply a cascade to already-loaded options.
 *
 * - `lookupPath` — the child options live in a nested array on the **parent's** record
 *   (the parent option is located in `options` by `parentValue`).
 * - `lookupFilter` — keep options whose record matches `parentValue` at that dot-path.
 *
 * With a `parentField` configured but no parent value selected, this returns `[]`:
 * a cascade child must not offer unfiltered options.
 */
export function applyCascadeFilter(
  options: ReferenceOption[],
  parentValue: unknown,
  cfg: EntityReferenceConfig | undefined,
  lang = 'en',
): ReferenceOption[] {
  if (!cfg?.parentField) return options;
  if (parentValue === null || parentValue === undefined || parentValue === '') return [];

  if (cfg.lookupPath) {
    const parent = options.find(o => o.value === parentValue);
    const nested = parent?.record ? getByPath(parent.record, cfg.lookupPath) : undefined;
    return normalizeReferenceOptions(nested as RawReferenceItem[], cfg, lang);
  }

  if (cfg.lookupFilter) {
    return options.filter(o => {
      const actual = o.record ? getByPath(o.record, cfg.lookupFilter!) : undefined;
      return actual === parentValue || String(actual ?? '') === String(parentValue);
    });
  }

  return options;
}

/** Every field that cascades off `parentFieldId`, searched across the whole field tree. */
export function findCascadeChildren(
  fields: NestedFieldConfig[] | undefined,
  parentFieldId: string,
): NestedFieldConfig[] {
  const found: NestedFieldConfig[] = [];
  for (const field of fields ?? []) {
    if (field.entityReference?.parentField === parentFieldId) found.push(field);
    if (field.children?.length) found.push(...findCascadeChildren(field.children, parentFieldId));
  }
  return found;
}
