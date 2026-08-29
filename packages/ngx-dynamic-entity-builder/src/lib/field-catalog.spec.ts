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
      'currency',
      'email',
      'password',
      'checkbox',
      'boolean',
      'date',
      'datetime',
      'time',
      'monthYear',
      'dropdown',
      'radio',
      'multiSelect',
      'entity-ref',
      'group',
      'array',
      'image',
      'file',
    ]);
    expect(new Set(types).size).toBe(types.length);
  });

  it('flags option-backed types correctly', () => {
    expect(getFieldTypeMeta('dropdown')?.hasOptions).toBe(true);
    expect(getFieldTypeMeta('multiSelect')?.hasOptions).toBe(true);
    expect(getFieldTypeMeta('text')?.hasOptions).toBe(false);
  });

  it('returns undefined metadata for unknown types', () => {
    expect(getFieldTypeMeta('nope' as any)).toBeUndefined();
  });

  describe('humanizeId', () => {
    it('splits camelCase', () => {
      expect(humanizeId('firstName')).toBe('First Name');
    });
    it('splits snake and generated ids', () => {
      expect(humanizeId('text_1')).toBe('Text 1');
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
      expect(f.visibility).toBe(true);
      expect(f.table?.visible).toBe(true);
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
      expect(createFieldConfig('textarea', 'notes').table?.visible).toBe(false);
      expect(createFieldConfig('array', 'items').table?.visible).toBe(false);
    });
  });
});
