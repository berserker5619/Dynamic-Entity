import type { NestedFieldConfig } from './form-model.types';
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
