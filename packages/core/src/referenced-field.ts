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
  };
}

/**
 * Compare a referenced field's snapshot against the current source field.
 * Returns true if the source field is missing or has diverged from the snapshot.
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

  // Label mismatch (compare JSON serialization)
  if (JSON.stringify(snapshot.label ?? null) !== JSON.stringify(currentSourceField.label ?? null)) {
    return true;
  }

  // Validators mismatch
  if (JSON.stringify(snapshot.validators ?? null) !== JSON.stringify(currentSourceField.validators ?? null)) {
    return true;
  }

  // Options mismatch
  if (JSON.stringify(snapshot.options ?? null) !== JSON.stringify(currentSourceField.options ?? null)) {
    return true;
  }

  return false;
}
