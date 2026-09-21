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

/**
 * The one walk over a config's fields.
 *
 * `collectFieldScopes` and `fieldsUnderTab` are the same traversal asked two questions, and
 * the second one existing as its own copy is exactly how a nested field ends up visible to
 * one caller and invisible to another. `keep` decides which entries are collected; the walk
 * always descends everything, because a tab's scope depends on every tab above it.
 */
function walkFieldScopes(
  config: EntityFormConfig | null | undefined,
  keep: (tabChain: readonly string[]) => boolean,
): FieldScopeEntry[] {
  const entries: FieldScopeEntry[] = [];
  if (!config || !Array.isArray(config.tabs)) return entries;

  const visitField = (
    field: NestedFieldConfig,
    path: string,
    scope: readonly string[],
    collect: boolean,
  ): void => {
    if (!field || typeof field !== 'object') return;
    if (collect) entries.push({ field, scope: scopeKey(scope), path });

    // A container stores its children under itself, so they are not siblings of the field.
    const isContainer = field.type === 'group' || field.type === 'array';
    const childScope = isContainer && field.id ? [...scope, field.id] : scope;
    asArray(field.children).forEach((child, i) =>
      visitField(child, `${path}.children[${i}]`, childScope, collect),
    );
  };

  const visitTab = (
    tab: NestedTabConfig,
    path: string,
    scope: readonly string[],
    tabChain: readonly string[],
  ): void => {
    if (!tab || typeof tab !== 'object') return;
    // `flatData` puts the tab's fields at the parent's level rather than under the tab id.
    const tabScope = tab.flatData || !tab.id ? scope : [...scope, tab.id];
    const chain = tab.id ? [...tabChain, tab.id] : tabChain;
    const collect = keep(chain);
    asArray(tab.fields).forEach((f, i) => visitField(f, `${path}.fields[${i}]`, tabScope, collect));
    asArray(tab.children).forEach((t, i) => visitTab(t, `${path}.children[${i}]`, tabScope, chain));
  };

  config.tabs.forEach((tab, i) => visitTab(tab, `tabs[${i}]`, [], []));
  return entries;
}

/** Every field in the config, each tagged with the scope its value is stored under. */
export function collectFieldScopes(
  config: EntityFormConfig | null | undefined,
): FieldScopeEntry[] {
  return walkFieldScopes(config, () => true);
}

/**
 * Every field a tab owns — its own, its sub-tabs', and every `group`/`array` child of either.
 *
 * "Owns" is the render question, not the storage question: a field inside a `group` on a
 * sub-tab is saved when that tab is saved, so it is a field the tab's rules apply to. The
 * scope on each entry is still the storage scope, which is what `refOf` needs to build the
 * address a rule addresses the field by.
 *
 * Returns an empty array for a tab id that does not exist, which is indistinguishable from a
 * tab holding no fields — callers that need to tell those apart check `findTab` themselves.
 */
export function fieldsUnderTab(
  config: EntityFormConfig | null | undefined,
  tabId: string,
): FieldScopeEntry[] {
  if (!tabId) return [];
  return walkFieldScopes(config, chain => chain.includes(tabId));
}

/** Every tab id at or below `tabId` — the tab itself and its sub-tabs, however deep. */
export function tabIdsUnderTab(
  config: EntityFormConfig | null | undefined,
  tabId: string,
): Set<string> {
  const out = new Set<string>();
  if (!tabId) return out;
  const visit = (tabs: NestedTabConfig[] | undefined, inside: boolean): void => {
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (!tab || typeof tab !== 'object') continue;
      const within = inside || tab.id === tabId;
      if (within && tab.id) out.add(tab.id);
      visit(tab.children, within);
    }
  };
  visit(config?.tabs, false);
  return out;
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
