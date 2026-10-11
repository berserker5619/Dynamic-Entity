/**
 * record-path.ts — reading and writing a record by dot path.
 *
 * The same rules as Dynamic Entity 2.3's `setRecordValue` and `getValueByPath`
 * (`core/src/import-engine.ts`, `core/src/form-logic.ts`), copied because the importer depends
 * on nothing in Dynamic Entity. A numeric segment creates an array, not an object with a `"0"`
 * key, and no path may walk through a prototype.
 */
import { isUnsafePath } from './safe-path';

const INDEX = /^\d+$/;

/** Write `value` at `path`, creating arrays for numeric segments. An unsafe path writes nothing. */
export function setRecordValue(record: Record<string, unknown>, path: string, value: unknown): void {
  if (!path || isUnsafePath(path)) return;
  const parts = path.split('.');
  let current: Record<string, unknown> = record;
  for (let i = 0; i < parts.length - 1; i++) {
    const existing = current[parts[i]];
    if (existing === null || typeof existing !== 'object') current[parts[i]] = INDEX.test(parts[i + 1]) ? [] : {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** The value at `path`, or `undefined`. An unsafe path reads nothing. */
export function getRecordValue(record: unknown, path: string): unknown {
  if (!path || isUnsafePath(path)) return undefined;
  let current: unknown = record;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** A `{}` as JSON makes one: not a `Date` or anything else with behaviour, which is opaque. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Empty for the purpose of "did the user put anything here". A `Date` is a value. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainRecord(value)) return Object.values(value).every(isEmptyValue);
  return false;
}
