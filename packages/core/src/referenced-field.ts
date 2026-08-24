import { canonicalizeValue } from './form-logic';
import type { NestedFieldConfig, ReferencedSnapshot } from './form-model.types';

/**
 * Capture a snapshot of a source field's pertinent configuration
 * (label, type, validators, options, listName).
 */
export function createFieldSnapshot(sourceField: NestedFieldConfig): ReferencedSnapshot {
  return {
    label: sourceField.label ? JSON.parse(JSON.stringify(sourceField.label)) : undefined,
    type: sourceField.type,
    validators: sourceField.validators ? JSON.parse(JSON.stringify(sourceField.validators)) : undefined,
    options: sourceField.options ? JSON.parse(JSON.stringify(sourceField.options)) : undefined,
    listName: sourceField.listName,
  };
}

/**
 * Compare a referenced field's snapshot against the current source field.
 * Returns true if the source field is missing or has diverged from the snapshot.
 *
 * Comparison is key-order independent. `JSON.stringify` was used here, which reports drift
 * for `{en:'A',de:'B'}` against `{de:'B',en:'A'}` — the same option written by two different
 * serialisers. A config round-tripped through a backend that orders keys differently would
 * otherwise show phantom drift on every referenced field. `canonicalizeValue` exists for
 * exactly this and is reused rather than reimplemented.
 */
export function computeFieldDrift(
  referencedField: NestedFieldConfig,
  currentSourceField: NestedFieldConfig | undefined,
): boolean {
  if (!referencedField.isReferenced) return false;
  if (!currentSourceField) return true; // Source field deleted/missing -> drift

  const snapshot = referencedField.referencedSnapshot;
  if (!snapshot) return true; // Missing snapshot -> drift

  // Type mismatch
  if (snapshot.type !== currentSourceField.type) return true;

  // Label mismatch
  if (canonicalizeValue(snapshot.label ?? null) !== canonicalizeValue(currentSourceField.label ?? null)) {
    return true;
  }

  // Validators mismatch
  if (
    canonicalizeValue(snapshot.validators ?? null) !==
    canonicalizeValue(currentSourceField.validators ?? null)
  ) {
    return true;
  }

  // Options mismatch. Order is significant here — options are an ordered list, and
  // canonicalizeValue preserves array order while sorting object keys.
  if (
    canonicalizeValue(snapshot.options ?? null) !== canonicalizeValue(currentSourceField.options ?? null)
  ) {
    return true;
  }

  // Named list mismatch. Compared only when the snapshot carries the key, so snapshots
  // taken before listName was captured are not reported as drifted for lacking it.
  if ('listName' in snapshot && (snapshot.listName ?? null) !== (currentSourceField.listName ?? null)) {
    return true;
  }

  return false;
}
