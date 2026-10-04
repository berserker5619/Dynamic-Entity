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

/** A `refererField` that points somewhere other than where the field sits. */
export function isRefOverride(field: { id: string; refererField?: string }, scope: string): boolean {
  return !!field.refererField && field.refererField !== fieldRefFor(scope, field.id);
}

/** A field entry together with where its value actually lives in a record. */
export interface FieldRefEntry extends FieldScopeEntry {
  /** The value's address in the record, e.g. `contact.phones.number` (no row numbers). */
  ref: string;
  /** Address of the object holding the field's siblings, or `ROOT_SCOPE`. */
  recordScope: string;
  /** Directly on a tab, which is the only place the renderer honours a container's override. */
  tabLevel: boolean;
  /**
   * `refererField` points somewhere other than the field's position, rebased or not: a
   * deliberate override rather than the builder's stamp.
   */
  authored: boolean;
}

/** A field entry's config path ends at a tab's `fields`, not at a container's `children`. */
const TAB_LEVEL_PATH = /\.fields\[\d+\]$/;

const isContainer = (field: NestedFieldConfig): boolean =>
  field.type === 'group' || field.type === 'array';

/**
 * Every field with the address its value is read from and written to.
 *
 * Usually that is `refOf`. The exception is a container — a `group` or `array` — whose
 * `refererField` moves it: the renderer copies the container's whole value to the override
 * (`extractRecord`) and reads it back from there (`patchForm`), so its children move with it.
 * `refOf` alone cannot see that, because a child's scope is built from ids, and a child's own
 * `refererField` is usually just the builder's stamp of that id-built position.
 *
 * So a moved container's subtree is rebased under the override. Only tab-level containers
 * move, because those are the only ones the renderer reads an override for; an override
 * anywhere deeper is ignored, and `validateConfig` says so. A leaf's own authored override is
 * kept as it always was.
 */
export function collectFieldRefs(config: EntityFormConfig | null | undefined): FieldRefEntry[] {
  const entries = collectFieldScopes(config);

  // Positional address → override, for every container the renderer actually moves.
  const moved = new Map<string, string>();
  for (const entry of entries) {
    const field = entry.field;
    if (!field?.id || !isContainer(field) || !TAB_LEVEL_PATH.test(entry.path)) continue;
    if (isRefOverride(field, entry.scope)) moved.set(fieldRefFor(entry.scope, field.id), field.refererField!);
  }

  const rebase = (path: string): string => {
    let from = '';
    for (const candidate of moved.keys()) {
      if ((path === candidate || path.startsWith(`${candidate}.`)) && candidate.length > from.length) {
        from = candidate;
      }
    }
    return from ? moved.get(from)! + path.slice(from.length) : path;
  };

  return entries.map(entry => {
    const field = entry.field;
    const tabLevel = TAB_LEVEL_PATH.test(entry.path);
    const recordScope = entry.scope === ROOT_SCOPE ? ROOT_SCOPE : rebase(entry.scope);
    if (!field?.id) return { ...entry, ref: '', recordScope, tabLevel, authored: false };

    const rebased = rebase(fieldRefFor(entry.scope, field.id));
    const authored = isRefOverride(field, entry.scope) && field.refererField !== rebased;
    // A container is where the renderer puts it. A leaf keeps an override it was authored with.
    const ref = authored && !isContainer(field) ? field.refererField! : rebased;
    return { ...entry, ref, recordScope, tabLevel, authored };
  });
}

/**
 * Every name a rule, `showWhen` key or cascade parent may call a field by: its bare id, and its
 * ref in brackets. The ref is `refOf`, the same address the builder writes into a rule.
 */
export function namesOfField(field: { id: string; refererField?: string }, scope: string): string[] {
  return [field.id, toRefToken(refOf(field, scope))];
}

/**
 * The value map rules and `showWhen` are evaluated against.
 *
 * Every field appears under both of its names (`namesOfField`). The bare id is what most
 * configs use, but ids are unique only per scope, so when two scopes define one the last field
 * walked wins; `[personal.address]` names one field and cannot be ambiguous. One flat map, so
 * `evaluateFormRules` needs no knowledge of refs at all — the extra keys simply resolve.
 *
 * The form and the importer both build it here, from wherever each keeps its values, so a rule
 * cannot mean one thing on screen and another in a spreadsheet. `valueOf` returns `undefined`
 * for a field with no single value — a field inside an array row — and that field is left out.
 */
export function flattenFieldValues<E extends FieldScopeEntry>(
  entries: readonly E[],
  valueOf: (entry: E) => { value: unknown } | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    if (!entry.field?.id) continue;
    const found = valueOf(entry);
    if (!found) continue;
    for (const name of namesOfField(entry.field, entry.scope)) out[name] = found.value;
  }
  return out;
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
