import type { EntityFormConfig, NestedFieldConfig, NestedTabConfig } from './form-model.types';

/**
 * Where a field's value lives in the record.
 *
 * A **scope** is the object a field is stored under, and it mirrors exactly the group the
 * renderer builds a control in: a tab opens one, a `flatData` tab shares its parent's, and a
 * `group` or `array` field opens one for its children. That is why `address` on Personal
 * Details and `address` on Work Details are two different fields — they are
 * `{ personal: { address }, work: { address } }`, not one key written twice.
 *
 * This is the single definition of that rule. The validator uses it to decide what counts as
 * a duplicate, and the renderer uses it to warn when a rule names an id that two scopes
 * define. Two copies of this walk would drift, and the failure when they did would be a
 * config that validates and then misbehaves.
 */
export interface FieldScopeEntry {
  field: NestedFieldConfig;
  /** Dotted path of the containing scope, e.g. `personal` or `incident.details.addr`. */
  scope: string;
  /** Config path for diagnostics, e.g. `tabs[0].fields[1]`. */
  path: string;
}

/** Config collections may be any shape; `?.` guards undefined and nothing else. */
function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export const ROOT_SCOPE = '(root)';

const scopeKey = (segments: readonly string[]): string => segments.join('.') || ROOT_SCOPE;

/** Every field in the config, each tagged with the scope its value is stored under. */
export function collectFieldScopes(
  config: EntityFormConfig | null | undefined,
): FieldScopeEntry[] {
  const entries: FieldScopeEntry[] = [];
  if (!config || !Array.isArray(config.tabs)) return entries;

  const visitField = (field: NestedFieldConfig, path: string, scope: readonly string[]): void => {
    if (!field || typeof field !== 'object') return;
    entries.push({ field, scope: scopeKey(scope), path });

    // A container stores its children under itself, so they are not siblings of the field.
    const isContainer = field.type === 'group' || field.type === 'array';
    const childScope = isContainer && field.id ? [...scope, field.id] : scope;
    asArray(field.children).forEach((child, i) => visitField(child, `${path}.children[${i}]`, childScope));
  };

  const visitTab = (tab: NestedTabConfig, path: string, scope: readonly string[]): void => {
    if (!tab || typeof tab !== 'object') return;
    // `flatData` puts the tab's fields at the parent's level rather than under the tab id.
    const tabScope = tab.flatData || !tab.id ? scope : [...scope, tab.id];
    asArray(tab.fields).forEach((f, i) => visitField(f, `${path}.fields[${i}]`, tabScope));
    asArray(tab.children).forEach((t, i) => visitTab(t, `${path}.children[${i}]`, tabScope));
  };

  config.tabs.forEach((tab, i) => visitTab(tab, `tabs[${i}]`, []));
  return entries;
}

/**
 * Field id → the scopes that define it, for ids defined more than once.
 *
 * An entry here is an id that the flat wiring cannot name: rules, `showWhen` and cascade
 * parents all carry a bare id with no scope, so the reference has no answer and the runtime
 * would resolve it by search order.
 */
export function ambiguousFieldIds(
  config: EntityFormConfig | null | undefined,
): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const entry of collectFieldScopes(config)) {
    if (!entry.field.id) continue;
    const scopes = byId.get(entry.field.id) ?? [];
    if (!scopes.includes(entry.scope)) scopes.push(entry.scope);
    byId.set(entry.field.id, scopes);
  }
  for (const [id, scopes] of [...byId]) {
    if (scopes.length < 2) byId.delete(id);
  }
  return byId;
}

/** The full address of a field: its scope path, then its id. */
export function fieldRefFor(scope: string, id: string): string {
  return scope === ROOT_SCOPE ? id : `${scope}.${id}`;
}

/**
 * Fills in `refererField` for every field that does not already declare one.
 *
 * An authored value is left alone. `refererField` has always been a binding override, so a
 * config that deliberately points a field at another path must keep pointing there — taking
 * that over as an identity would silently rebind data.
 *
 * Mutates the config given, so a caller that must not disturb its input should clone first.
 */
export function assignFieldRefs<T extends EntityFormConfig | null | undefined>(config: T): T {
  for (const entry of collectFieldScopes(config)) {
    if (!entry.field?.id || entry.field.refererField) continue;
    entry.field.refererField = fieldRefFor(entry.scope, entry.field.id);
  }
  return config;
}

/** A field's address: what it declares, or what its position implies. */
export function refOf(field: { id: string; refererField?: string }, scope: string): string {
  return field.refererField ?? fieldRefFor(scope, field.id);
}

/** Wraps a ref for use in a rule or condition: `personal.city` → `[personal.city]`. */
export function toRefToken(path: string): string {
  return `[${path}]`;
}

/**
 * Reads a reference written by a rule, `showWhen` key or cascade parent.
 *
 * `[personal.addresses.city]` is a ref and names exactly one field. Anything else is a bare
 * field id, which is how every config written before refs existed addresses a field — those
 * keep resolving by id, so nothing has to be rewritten to keep working.
 */
export function parseFieldRef(reference: string): { kind: 'ref' | 'id'; value: string } {
  // `?.trim()` guards undefined but not a number, an array or an object — and a reference
  // is config data, so it may be any of them.
  const trimmed = typeof reference === 'string' ? reference.trim() : '';
  const isRef = trimmed.length > 2 && trimmed.startsWith('[') && trimmed.endsWith(']');
  return isRef
    ? { kind: 'ref', value: trimmed.slice(1, -1).trim() }
    : { kind: 'id', value: trimmed };
}
