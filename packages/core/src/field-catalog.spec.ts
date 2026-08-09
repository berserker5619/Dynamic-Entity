import type { RichFieldType } from './form-model.types';
import {
  FIELD_TYPE_CATALOG,
  createFieldConfig,
  getFieldTypeMeta,
  humanizeId,
} from './field-catalog';

/**
 * The catalog is the contract both the renderer and the builder read. These tests guard its
 * shape here, in the package that publishes it — the renderer has its own parity test that
 * checks its component registry matches these keys.
 */
describe('FIELD_TYPE_CATALOG', () => {
  const ALL_TYPES: RichFieldType[] = [
    'text', 'textarea', 'number', 'currency', 'email', 'password', 'date', 'datetime',
    'monthYear', 'dropdown', 'radio', 'checkbox', 'boolean', 'multiSelect', 'entity-ref',
    'group', 'array', 'image', 'file',
  ];

  it('declares an entry for every RichFieldType', () => {
    expect(FIELD_TYPE_CATALOG.map(m => m.type).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('has no duplicate types', () => {
    const types = FIELD_TYPE_CATALOG.map(m => m.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('gives every entry the display metadata the builder palette needs', () => {
    for (const meta of FIELD_TYPE_CATALOG) {
      expect(meta.label).toBeTruthy();
      expect(meta.icon).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.idPrefix).toBeTruthy();
    }
  });

  it('marks exactly the option-bearing types', () => {
    const withOptions = FIELD_TYPE_CATALOG.filter(m => m.hasOptions).map(m => m.type).sort();
    expect(withOptions).toEqual(['dropdown', 'multiSelect', 'radio']);
  });

  it('marks exactly the entity-ref type', () => {
    const refs = FIELD_TYPE_CATALOG.filter(m => m.isEntityRef).map(m => m.type);
    expect(refs).toEqual(['entity-ref']);
  });

  it('only declares validators the FieldValidators model supports', () => {
    for (const meta of FIELD_TYPE_CATALOG) {
      for (const flag of meta.flagValidators) expect(['required', 'email']).toContain(flag);
      for (const param of meta.paramValidators) {
        expect(['min', 'max', 'minLength', 'maxLength']).toContain(param);
      }
    }
  });
});

describe('getFieldTypeMeta', () => {
  it('finds an entry by type', () => {
    expect(getFieldTypeMeta('text')?.label).toBeTruthy();
  });

  it('returns undefined for an unknown type', () => {
    expect(getFieldTypeMeta('nope')).toBeUndefined();
  });
});

describe('humanizeId', () => {
  it.each([
    ['firstName', 'First Name'],
    ['first_name', 'First Name'],
    ['first-name', 'First Name'],
    ['name', 'Name'],
    ['', ''],
  ])('turns %p into %p', (input, expected) => {
    expect(humanizeId(input)).toBe(expected);
  });

  it('collapses repeated separators', () => {
    expect(humanizeId('first__name')).toBe('First Name');
  });

  /**
   * Known limitations of the generated default label. Both produce an editable starting
   * point rather than a wrong one, so they are pinned here rather than "fixed": changing
   * them would silently alter labels in every config the builder has already produced.
   */
  it('does not split a letter→digit boundary', () => {
    expect(humanizeId('addressLine1')).toBe('Address Line1');
  });

  it('leaves consecutive capitals as one word', () => {
    expect(humanizeId('HTTPStatus')).toBe('HTTPStatus');
  });
});

describe('createFieldConfig', () => {
  it('builds a visible field with a humanized label in the default language', () => {
    const field = createFieldConfig('text', 'firstName');

    expect(field).toMatchObject({
      id: 'firstName',
      type: 'text',
      label: { en: 'First Name' },
      visibility: true,
    });
  });

  it('honours the requested default language', () => {
    expect(createFieldConfig('text', 'firstName', 'de').label).toEqual({ de: 'First Name' });
  });

  it('seeds an empty options array only for option-bearing types', () => {
    expect(createFieldConfig('dropdown', 'x').options).toEqual([]);
    expect(createFieldConfig('text', 'x').options).toBeUndefined();
  });

  it('seeds an entityReference block for entity-ref', () => {
    expect(createFieldConfig('entity-ref', 'x').entityReference).toEqual({
      enabled: true,
      linkedEntityKey: '',
    });
  });

  it('defaults boolean-ish types to false', () => {
    expect(createFieldConfig('checkbox', 'x').defaultValue).toBe(false);
    expect(createFieldConfig('boolean', 'x').defaultValue).toBe(false);
    expect(createFieldConfig('text', 'x').defaultValue).toBeUndefined();
  });

  it('seeds a children array for container types', () => {
    expect(createFieldConfig('group', 'x').children).toEqual([]);
    expect(createFieldConfig('array', 'x').children).toEqual([]);
    expect(createFieldConfig('text', 'x').children).toBeUndefined();
  });

  it('keeps container and long-text types out of the table by default', () => {
    for (const type of ['textarea', 'array', 'group'] as RichFieldType[]) {
      expect(createFieldConfig(type, 'x').table?.visible).toBe(false);
    }
    expect(createFieldConfig('text', 'x').table?.visible).toBe(true);
  });

  it('produces a config for every catalog type without throwing', () => {
    for (const meta of FIELD_TYPE_CATALOG) {
      expect(createFieldConfig(meta.type, `${meta.idPrefix}_1`).type).toBe(meta.type);
    }
  });
});
