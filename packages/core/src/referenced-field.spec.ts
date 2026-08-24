import type { NestedFieldConfig, ReferencedSnapshot } from './form-model.types';
import { createFieldSnapshot, computeFieldDrift } from './referenced-field';

describe('referenced-field utilities', () => {
  const sourceField: NestedFieldConfig = {
    id: 'email',
    type: 'email',
    label: { en: 'Email Address', de: 'E-Mail-Adresse' },
    validators: { required: true },
    options: undefined,
  };

  describe('createFieldSnapshot', () => {
    it('creates a clean snapshot of the source field properties', () => {
      const snapshot = createFieldSnapshot(sourceField);
      expect(snapshot).toEqual({
        label: { en: 'Email Address', de: 'E-Mail-Adresse' },
        type: 'email',
        validators: { required: true },
        options: undefined,
      });
    });
  });

  describe('computeFieldDrift', () => {
    it('returns false for non-referenced fields', () => {
      expect(computeFieldDrift(sourceField, sourceField)).toBe(false);
    });

    it('returns false when referenced snapshot matches source field exactly', () => {
      const refField: NestedFieldConfig = {
        id: 'userEmail',
        type: 'email',
        label: { en: 'Email Address', de: 'E-Mail-Adresse' },
        isReferenced: true,
        referencedEntityKey: 'users',
        referencedFieldId: 'email',
        referencedSnapshot: createFieldSnapshot(sourceField),
      };
      expect(computeFieldDrift(refField, sourceField)).toBe(false);
    });

    it('returns true when current source field is missing', () => {
      const refField: NestedFieldConfig = {
        id: 'userEmail',
        type: 'email',
        label: { en: 'Email' },
        isReferenced: true,
        referencedEntityKey: 'users',
        referencedFieldId: 'email',
        referencedSnapshot: createFieldSnapshot(sourceField),
      };
      expect(computeFieldDrift(refField, undefined)).toBe(true);
    });

    it('returns true when source field type changes', () => {
      const refField: NestedFieldConfig = {
        id: 'userEmail',
        type: 'email',
        label: { en: 'Email' },
        isReferenced: true,
        referencedEntityKey: 'users',
        referencedFieldId: 'email',
        referencedSnapshot: createFieldSnapshot(sourceField),
      };
      const modifiedSource: NestedFieldConfig = { ...sourceField, type: 'text' };
      expect(computeFieldDrift(refField, modifiedSource)).toBe(true);
    });

    it('returns true when source field label changes', () => {
      const refField: NestedFieldConfig = {
        id: 'userEmail',
        type: 'email',
        label: { en: 'Email' },
        isReferenced: true,
        referencedEntityKey: 'users',
        referencedFieldId: 'email',
        referencedSnapshot: createFieldSnapshot(sourceField),
      };
      const modifiedSource: NestedFieldConfig = {
        ...sourceField,
        label: { en: 'Primary Email Address' },
      };
      expect(computeFieldDrift(refField, modifiedSource)).toBe(true);
    });
  });
});

/**
 * Drift is advisory but noisy when wrong: a config re-serialised by a backend that orders
 * object keys differently must not report every referenced field as drifted.
 */
describe('drift comparison is key-order independent', () => {
  const makeRef = (referencedSnapshot: ReferencedSnapshot): NestedFieldConfig => ({
    id: 'ref',
    type: 'dropdown',
    label: { en: 'Ref' },
    isReferenced: true,
    referencedSnapshot,
  });

  const makeSource = (over: Partial<NestedFieldConfig>): NestedFieldConfig => ({
    id: 'src',
    type: 'dropdown',
    label: { en: 'Ref' },
    ...over,
  });

  it('does not report drift when only label key order differs', () => {
    const ref = makeRef({ type: 'dropdown', label: { en: 'Status', de: 'Status' } });
    const source = makeSource({ label: { de: 'Status', en: 'Status' } });

    expect(computeFieldDrift(ref, source)).toBe(false);
  });

  it('does not report drift when only option key order differs', () => {
    const ref = makeRef({ type: 'dropdown', label: { en: 'Ref' }, options: [{ en: 'Active', de: 'Aktiv' }] });
    const source = makeSource({ options: [{ de: 'Aktiv', en: 'Active' }] });

    expect(computeFieldDrift(ref, source)).toBe(false);
  });

  it('still reports drift when a label actually changes', () => {
    const ref = makeRef({ type: 'dropdown', label: { en: 'Status' } });
    const source = makeSource({ label: { en: 'State' } });

    expect(computeFieldDrift(ref, source)).toBe(true);
  });

  it('still reports drift when option order changes, since options are ordered', () => {
    const ref = makeRef({ type: 'dropdown', label: { en: 'Ref' }, options: [{ en: 'A' }, { en: 'B' }] });
    const source = makeSource({ options: [{ en: 'B' }, { en: 'A' }] });

    expect(computeFieldDrift(ref, source)).toBe(true);
  });

  it('captures listName in a snapshot and reports drift when it changes', () => {
    const snapshot = createFieldSnapshot(makeSource({ listName: 'countries' }));
    expect(snapshot.listName).toBe('countries');

    expect(computeFieldDrift(makeRef(snapshot), makeSource({ listName: 'regions' }))).toBe(true);
  });

  it('ignores listName on a snapshot taken before it was captured', () => {
    const ref = makeRef({ type: 'dropdown', label: { en: 'Ref' } }); // no listName key at all
    const source = makeSource({ listName: 'countries' });

    expect(computeFieldDrift(ref, source)).toBe(false);
  });
});
