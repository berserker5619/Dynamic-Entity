import type { EntityReferenceConfig, NestedFieldConfig } from './form-model.types';
import {
  applyCascadeFilter,
  buildReferenceLabel,
  findCascadeChildren,
  getByPath,
  normalizeReferenceOptions,
} from './entity-reference.types';

describe('getByPath', () => {
  const record = { a: { b: { c: 42 } }, top: 'x' };

  it('reads a nested path', () => {
    expect(getByPath(record, 'a.b.c')).toBe(42);
  });

  it('reads a top-level key', () => {
    expect(getByPath(record, 'top')).toBe('x');
  });

  it('returns undefined for a missing segment', () => {
    expect(getByPath(record, 'a.z.c')).toBeUndefined();
  });

  it('returns undefined for an empty path or non-object source', () => {
    expect(getByPath(record, '')).toBeUndefined();
    expect(getByPath(null, 'a')).toBeUndefined();
  });
});

describe('buildReferenceLabel', () => {
  it('joins the configured display fields', () => {
    expect(buildReferenceLabel({ first: 'Ada', last: 'Lovelace' }, ['first', 'last'])).toBe(
      'Ada Lovelace',
    );
  });

  it('skips empty display field values', () => {
    expect(buildReferenceLabel({ first: 'Ada', last: '' }, ['first', 'last'])).toBe('Ada');
  });

  it('resolves a localized display field for the active language', () => {
    expect(buildReferenceLabel({ name: { en: 'Red', de: 'Rot' } }, ['name'], 'de')).toBe('Rot');
  });

  it('falls back to label/name/title when no display fields are configured', () => {
    expect(buildReferenceLabel({ name: 'Acme' }, undefined)).toBe('Acme');
    expect(buildReferenceLabel({ title: 'Boss' }, [])).toBe('Boss');
  });

  it('falls back to an id when nothing else is present', () => {
    expect(buildReferenceLabel({ _id: 'abc' }, [])).toBe('abc');
  });
});

describe('normalizeReferenceOptions', () => {
  it('returns [] for non-array input', () => {
    expect(normalizeReferenceOptions(undefined)).toEqual([]);
    expect(normalizeReferenceOptions(null)).toEqual([]);
  });

  it('wraps primitives', () => {
    expect(normalizeReferenceOptions(['a', 2])).toEqual([
      { value: 'a', label: 'a' },
      { value: 2, label: '2' },
    ]);
  });

  it('passes through { value, label } options and keeps the record', () => {
    const [opt] = normalizeReferenceOptions([{ value: 1, label: 'One', record: { x: 1 } }]);
    expect(opt.value).toBe(1);
    expect(opt.label).toBe('One');
    expect(opt.record).toEqual({ x: 1 });
  });

  it('resolves a localized option label', () => {
    const [opt] = normalizeReferenceOptions([{ value: 1, label: { en: 'One', de: 'Eins' } }], undefined, 'de');
    expect(opt.label).toBe('Eins');
  });

  it('labels bare records via displayFields and keeps them as the record', () => {
    const cfg: EntityReferenceConfig = { enabled: true, displayFields: ['first', 'last'] };
    const [opt] = normalizeReferenceOptions([{ id: 7, first: 'Ada', last: 'L' }], cfg);

    expect(opt.value).toBe(7);
    expect(opt.label).toBe('Ada L');
    expect(opt.record).toEqual({ id: 7, first: 'Ada', last: 'L' });
  });
});

describe('applyCascadeFilter', () => {
  const options = [
    { value: 'ber', label: 'Berlin', record: { country: 'de' } },
    { value: 'par', label: 'Paris', record: { country: 'fr' } },
  ];

  it('returns options untouched with no parentField', () => {
    expect(applyCascadeFilter(options, undefined, { enabled: true })).toBe(options);
  });

  it('returns nothing when a cascade child has no parent value', () => {
    const cfg: EntityReferenceConfig = { enabled: true, parentField: 'country', lookupFilter: 'country' };
    expect(applyCascadeFilter(options, '', cfg)).toEqual([]);
    expect(applyCascadeFilter(options, undefined, cfg)).toEqual([]);
    expect(applyCascadeFilter(options, null, cfg)).toEqual([]);
  });

  it('filters by lookupFilter path', () => {
    const cfg: EntityReferenceConfig = { enabled: true, parentField: 'country', lookupFilter: 'country' };
    expect(applyCascadeFilter(options, 'de', cfg).map(o => o.label)).toEqual(['Berlin']);
  });

  it('coerces types when matching the parent value', () => {
    const numeric = [{ value: 'a', label: 'A', record: { pid: 1 } }];
    const cfg: EntityReferenceConfig = { enabled: true, parentField: 'p', lookupFilter: 'pid' };
    expect(applyCascadeFilter(numeric, '1', cfg).length).toBe(1);
  });

  it('takes nested options from the parent record via lookupPath', () => {
    const parents = [
      {
        value: 'de',
        label: 'Germany',
        record: { cities: [{ value: 'ber', label: 'Berlin' }] },
      },
    ];
    const cfg: EntityReferenceConfig = { enabled: true, parentField: 'country', lookupPath: 'cities' };

    expect(applyCascadeFilter(parents, 'de', cfg)).toEqual([
      { value: 'ber', label: 'Berlin', record: { value: 'ber', label: 'Berlin' } },
    ]);
  });

  it('returns everything when a parent value is set but no lookup rule is configured', () => {
    const cfg: EntityReferenceConfig = { enabled: true, parentField: 'country' };
    expect(applyCascadeFilter(options, 'de', cfg)).toBe(options);
  });
});

describe('findCascadeChildren', () => {
  const fields: NestedFieldConfig[] = [
    { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
    {
      id: 'city',
      type: 'entity-ref',
      label: { en: 'City' },
      entityReference: { enabled: true, parentField: 'country' },
    },
    {
      id: 'group',
      type: 'group',
      label: { en: 'G' },
      children: [
        {
          id: 'district',
          type: 'entity-ref',
          label: { en: 'District' },
          entityReference: { enabled: true, parentField: 'country' },
        },
      ],
    },
  ];

  it('finds children at any depth', () => {
    expect(findCascadeChildren(fields, 'country').map(f => f.id)).toEqual(['city', 'district']);
  });

  it('returns [] when nothing cascades off the field', () => {
    expect(findCascadeChildren(fields, 'city')).toEqual([]);
    expect(findCascadeChildren(undefined, 'country')).toEqual([]);
  });
});
