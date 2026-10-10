/**
 * validate-record.ts — the generic checks, for an adapter with no `validate` (spec §8).
 *
 * `required`, number `min`/`max`, string length, `pattern`, `format` and list item counts,
 * each reported with its `RECORD_*` code. The meanings are Dynamic Entity 2.3's
 * `applyFieldValidators` (`core/src/import-engine.ts`), keyed by `ValueKind` instead of field
 * validators; the email, URL and phone tests are copied from DE for the same reason as the
 * rest of this package.
 *
 * A repeating target is checked per item that exists, as 2.3 does. An empty optional array is
 * not a failure, and requiring a child of an item nobody added would make one impossible.
 */
import type { ImportTarget, RecordProblem, TargetArray, TargetSet } from './adapter.types';
import { getRecordValue } from './record-path';

/** Approximates Angular's `Validators.email`, as DE does. */
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const PHONE_CHARS = /^\+?[0-9\s().-]+$/;

/** An absolute `http:` or `https:` URL with a host. */
function isValidUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Digits with the usual separators and an optional leading `+`, holding 7 to 15 digits. */
function isValidPhone(value: string): boolean {
  if (!PHONE_CHARS.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

const absent = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/** One target's checks against one value. */
function check(target: ImportTarget, value: unknown, ref: string, problems: RecordProblem[]): void {
  const name = target.header || target.shapeRef;
  const report = (code: RecordProblem['code'], message: string) => problems.push({ ref, code, message, raw: value });
  if (absent(value)) {
    if (target.required) report('RECORD_REQUIRED', `${name} is required`);
    // Every other check describes a value, and there is not one.
    return;
  }
  const kind = target.value;
  if (kind.kind === 'number' && typeof value === 'number') {
    if (kind.min !== undefined && value < kind.min) report('RECORD_RANGE', `${name} must be at least ${kind.min}`);
    if (kind.max !== undefined && value > kind.max) report('RECORD_RANGE', `${name} must be at most ${kind.max}`);
  }
  if (kind.kind === 'string' && typeof value === 'string') {
    if (kind.minLength !== undefined && value.length < kind.minLength) {
      report('RECORD_RANGE', `${name} must be at least ${kind.minLength} characters`);
    }
    if (kind.maxLength !== undefined && value.length > kind.maxLength) {
      report('RECORD_RANGE', `${name} must be at most ${kind.maxLength} characters`);
    }
    if (kind.pattern !== undefined) {
      // A pattern is schema data; an unparseable one is the schema's problem, not a reason to throw mid-import.
      let pattern: RegExp | null = null;
      try {
        pattern = new RegExp(kind.pattern);
      } catch {
        pattern = null;
      }
      if (pattern && !pattern.test(value)) report('RECORD_FORMAT', `${name} does not match the required format`);
    }
    if (kind.format === 'email' && !EMAIL.test(value)) report('RECORD_FORMAT', `${name} is not a valid email address`);
    if (kind.format === 'url' && !isValidUrl(value)) report('RECORD_FORMAT', `${name} is not a valid web address`);
    if (kind.format === 'phone' && !isValidPhone(value)) report('RECORD_FORMAT', `${name} is not a valid phone number`);
  }
  if (kind.kind === 'list' && Array.isArray(value)) {
    if (kind.minItems !== undefined && value.length < kind.minItems) report('RECORD_RANGE', `${name} must have at least ${kind.minItems} items`);
    if (kind.maxItems !== undefined && value.length > kind.maxItems) report('RECORD_RANGE', `${name} must have at most ${kind.maxItems} items`);
  }
}

/** Every generic problem with a finished record, against the targets it was built from. */
export function validateRecord(record: Record<string, unknown>, set: TargetSet): RecordProblem[] {
  const problems: RecordProblem[] = [];
  const arrays = new Map<string, TargetArray>(set.arrays.map(array => [array.ref, array]));

  // An array the schema requires must have an item. Its items' own checks follow.
  for (const array of arrays.values()) {
    if (array.required && absent(getRecordValue(record, array.ref))) {
      problems.push({ ref: array.ref, code: 'RECORD_REQUIRED', message: `${array.label || array.ref} is required` });
    }
  }

  const seenShapes = new Set<string>();
  for (const target of set.targets) {
    if (target.arrayRef === undefined) {
      check(target, getRecordValue(record, target.ref), target.ref, problems);
      continue;
    }
    // Slots were compacted or kept by position, so a slot target's own ref no longer says which
    // item it is. Check each item that exists, once per shape.
    if (seenShapes.has(target.shapeRef)) continue;
    seenShapes.add(target.shapeRef);
    const items = getRecordValue(record, target.arrayRef);
    if (!Array.isArray(items)) continue;
    const tail = target.shapeRef.slice(target.arrayRef.length + 1);
    items.forEach((item, index) => {
      // A positional hole is a slot the sheet left empty, not an item to judge.
      if (item === null || item === undefined) return;
      const value = tail ? getRecordValue(item, tail) : item;
      check(target, value, tail ? `${target.arrayRef}.${index}.${tail}` : `${target.arrayRef}.${index}`, problems);
    });
  }
  return problems;
}
