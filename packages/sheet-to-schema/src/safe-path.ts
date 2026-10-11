/**
 * safe-path.ts — refusing paths that reach an object's prototype.
 *
 * A plan's refs become property paths the engine writes through. `__proto__.isAdmin` would
 * otherwise write onto `Object.prototype` and affect every object in the running application.
 *
 * The same rule as Dynamic Entity's `isUnsafePath` (`core/src/form-logic.ts`), copied rather
 * than imported: the importer depends on nothing in Dynamic Entity (spec, "Package boundaries").
 */

/** Segments that must never be walked or written through. */
export const UNSAFE_PATH_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** True when a dot path has a segment that could reach an object's prototype. A non-string names no path. */
export function isUnsafePath(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  return path.split('.').some(part => UNSAFE_PATH_KEYS.has(part));
}
