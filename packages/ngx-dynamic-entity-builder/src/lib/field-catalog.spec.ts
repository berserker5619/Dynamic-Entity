import {
  FIELD_TYPE_CATALOG,
  createFieldConfig,
  getFieldTypeMeta,
  humanizeId,
} from './field-catalog';

describe('field-catalog', () => {
  it('describes every built-in field type exactly once', () => {
    const types = FIELD_TYPE_CATALOG.map(m => m.type);
    expect(types).toEqual([
      'text',
      'textarea',
      'number',
      'checkbox',
      'date',
      'dropdown',
      'multiSelect',
      'entity-ref',
      'array',
    ]);
    // no duplicates
    expect(new Set(types).size).toBe(types.length);
  });

  it('flags option-backed and entity-ref types correctly', () => {
    expect(getFieldTypeMeta('dropdown')?.hasOptions).toBe(true);
    expect(getFieldTypeMeta('multiSelect')?.hasOptions).toBe(true);
    expect(getFieldTypeMeta('text')?.hasOptions).toBe(false);
    expect(getFieldTypeMeta('entity-ref')?.isEntityRef).toBe(true);
  });

  it('returns undefined metadata for unknown types', () => {
    expect(getFieldTypeMeta('nope')).toBeUndefined();
  });

  describe('humanizeId', () => {
    it('splits camelCase', () => {
      expect(humanizeId('firstName')).toBe('First Name');
    });
    it('splits snake and generated ids', () => {
      expect(humanizeId('text_1')).toBe('Text 1');
      expect(humanizeId('entityRef_2')).toBe('Entity Ref 2');
    });
    it('handles single words', () => {
      expect(humanizeId('email')).toBe('Email');
    });
  });

  describe('createFieldConfig', () => {
    it('produces sensible defaults', () => {
      const f = createFieldConfig('text', 'firstName');
      expect(f.id).toBe('firstName');
      expect(f.type).toBe('text');
      expect(f.label).toEqual({ en: 'First Name' });
      expect(f.visible).toBe(true);
      expect(f.tableColumn).toBe(true);
      expect(f.validators).toEqual([]);
    });

    it('honours the default language for the initial label', () => {
      const f = createFieldConfig('text', 'name', 'de');
      expect(f.label).toEqual({ de: 'Name' });
    });

    it('seeds an empty options array for option-backed types', () => {
      expect(createFieldConfig('dropdown', 'status').options).toEqual([]);
      expect(createFieldConfig('text', 'name').options).toBeUndefined();
    });

    it('defaults checkbox value to false and keeps textarea/array out of table columns', () => {
      expect(createFieldConfig('checkbox', 'active').defaultValue).toBe(false);
      expect(createFieldConfig('textarea', 'notes').tableColumn).toBe(false);
      expect(createFieldConfig('array', 'items').tableColumn).toBe(false);
    });
  });
});
