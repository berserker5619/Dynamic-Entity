/**
 * Comparing import output now that imported rows carry a fresh `$rowId`.
 *
 * Since 3.2 an import hands every object row of an array a new random id on its way out, so two
 * runs over the same file can never be deep-equal, and a parity expectation written before
 * ids existed cannot hold one. `expectFreshRowIds` checks every row got one; `withoutRowIds`
 * then gives back the records as the expectation describes them. The expectations themselves
 * are not touched.
 */
import { ROW_ID_KEY } from '../src/row-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/** The value with every array row's `$rowId` removed, at any depth. */
export function withoutRowIds<T>(value: T, isRow = false): T {
  if (Array.isArray(value)) return value.map(item => withoutRowIds(item, true)) as unknown as T;
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isRow && key === ROW_ID_KEY) continue;
    out[key] = withoutRowIds(child);
  }
  return out as T;
}

/** Every `$rowId` found in the records, once per row object, in walk order. */
export function rowIdsIn(value: unknown, isRow = false, seen = new Set<object>()): unknown[] {
  if (Array.isArray(value)) return value.flatMap(item => rowIdsIn(item, true, seen));
  if (!isPlainObject(value) || seen.has(value)) return [];
  seen.add(value);
  return Object.entries(value).flatMap(([key, child]) => (isRow && key === ROW_ID_KEY ? [child] : rowIdsIn(child, false, seen)));
}

/**
 * Each id the records carry is a distinct v4 UUID. A row stored twice — a moved array sits at
 * its position and at its `refererField` — is one row object, and is counted once.
 */
export function expectFreshRowIds(records: unknown): void {
  const ids = rowIdsIn(records);
  for (const id of ids) expect(id).toMatch(UUID);
  expect(new Set(ids).size).toBe(ids.length);
}
