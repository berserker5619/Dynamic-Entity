/**
 * Deep clone with a JSON fallback.
 *
 * `structuredClone` is not universally available (older browsers, and jsdom before v22),
 * so it must never be called unguarded — an unguarded call throws a ReferenceError and the
 * caller silently does nothing. Config and rule objects are JSON-safe, so the fallback is
 * lossless here.
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
