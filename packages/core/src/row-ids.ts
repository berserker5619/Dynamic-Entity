/**
 * row-ids.ts — a stable identity for each row of an `array` field.
 *
 * An array row has no identity of its own: its index changes on every insert, delete and
 * reorder, and its values change on every edit. Anything that has to say "this row" across
 * two saves — a change history, an audit trail, a comment thread — has nothing to hold on to.
 * `$rowId` is that handle. It lives on the row object next to the row's fields, and like
 * `$key` on an option value, the `$` prefix keeps it out of the field-id namespace:
 * `validateConfig` refuses a field id that starts with `$`.
 */

import { getValueByPath } from './form-logic';
import type { EntityFormConfig, NestedFieldConfig, NestedTabConfig } from './form-model.types';

/** The key a row object carries its identity under. */
export const ROW_ID_KEY = '$rowId';

/** Prefix of the positional ids `applyRowIds` gives rows saved before 3.2. */
export const LEGACY_ROW_ID_PREFIX = 'legacy-';

/** The two Web Crypto calls used here, typed locally: core compiles without the DOM lib. */
interface RowIdCrypto {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

/**
 * A fresh row id.
 *
 * `crypto.randomUUID` exists only in a secure context (HTTPS or localhost), and an app served
 * over plain HTTP on an intranet is common enough that a row added there must still get one.
 * `crypto.getRandomValues` has no such restriction; `Math.random` covers a runtime with no
 * `crypto` at all. A row id needs to be unique, not unguessable.
 */
export function newRowId(): string {
  const c = (globalThis as { crypto?: RowIdCrypto }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);

  // RFC 4122 version 4 layout, so a fallback id looks like any other.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Whether a row already carries an id. Any value counts: an existing id is never rewritten. */
export function hasRowId(row: unknown): boolean {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const id = (row as Record<string, unknown>)[ROW_ID_KEY];
  return id !== undefined && id !== null && id !== '';
}

/**
 * Give every object row in one list an id, in place.
 *
 * Rows that lack one get `legacy-1`, `legacy-2`, … in list order, skipping any number the list
 * already uses. The result depends only on the list, so migrating the same stored record twice,
 * or on two servers, gives the same ids.
 */
export function assignLegacyRowIds(rows: unknown[]): void {
  const used = new Set<unknown>();
  for (const row of rows) if (hasRowId(row)) used.add((row as Record<string, unknown>)[ROW_ID_KEY]);

  let next = 1;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || hasRowId(row)) continue;
    while (used.has(`${LEGACY_ROW_ID_PREFIX}${next}`)) next++;
    const id = `${LEGACY_ROW_ID_PREFIX}${next++}`;
    used.add(id);
    (row as Record<string, unknown>)[ROW_ID_KEY] = id;
  }
}

/** Give every object row in one list that lacks an id a fresh one, in place. */
export function assignNewRowIds(rows: unknown[]): void {
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || hasRowId(row)) continue;
    (row as Record<string, unknown>)[ROW_ID_KEY] = newRowId();
  }
}

/**
 * Call `visit` with every list of object rows a record holds, outermost first.
 *
 * Walks the record against the config, as `applyOptionKeys` does: tabs (honouring `flatData`),
 * groups, and every row of every `array` field with `children`, nested to any depth. An array
 * of plain values has no columns and nowhere to put an id, so it is skipped.
 *
 * A tab field with a `refererField` is also stored at that root path, and the form reads it
 * from there first, so that copy is visited too. Without it, a record loaded in the form and
 * the same record migrated on a server would disagree about the moved rows.
 */
export function forEachRowList(
  record: Record<string, unknown>,
  config: EntityFormConfig | null | undefined,
  visit: (rows: unknown[]) => void,
): void {
  const visitFields = (fields: NestedFieldConfig[] | undefined, container: unknown): void => {
    if (!container || typeof container !== 'object' || Array.isArray(container)) return;
    const holder = container as Record<string, unknown>;

    for (const field of Array.isArray(fields) ? fields : []) {
      if (!field?.id) continue;
      const current = holder[field.id];
      if (current === undefined || current === null) continue;

      if (field.type === 'group') {
        visitFields(field.children, current);
      } else if (field.type === 'array' && Array.isArray(current) && field.children?.length) {
        visit(current);
        for (const row of current) visitFields(field.children, row);
      }
    }
  };

  const visitTabs = (tabs: NestedTabConfig[] | undefined, container: unknown): void => {
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (!tab?.id) continue;
      // `flatData` stores a tab's fields at the parent's level rather than under the tab id.
      const scope = tab.flatData ? container : (container as Record<string, unknown>)?.[tab.id];
      if (scope) visitFields(tab.fields, scope);
      for (const field of Array.isArray(tab.fields) ? tab.fields : []) {
        if (!field?.id || !field.refererField) continue;
        visitFields([field], { [field.id]: getValueByPath(record, field.refererField) });
      }
      if (scope) visitTabs(tab.children, scope);
    }
  };

  if (record && typeof record === 'object') visitTabs(config?.tabs, record);
}

/**
 * Give every row a record holds that lacks a `$rowId` a fresh one, in place, and return it.
 *
 * For records that are new by definition — an import's output — where a positional id would
 * be wrong: two imported records are two sets of new rows, not two loads of the same ones.
 * The import engine's own output stays free of ids, so it remains deterministic and
 * comparable; the server's `runImport` and the browser's import commit call this as records
 * leave it. A stored record is `applyRowIds`'s job instead.
 */
export function stampNewRowIds<T extends Record<string, unknown>>(
  record: T,
  config: EntityFormConfig | null | undefined,
): T {
  forEachRowList(record, config, assignNewRowIds);
  return record;
}
