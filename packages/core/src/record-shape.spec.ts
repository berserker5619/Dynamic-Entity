import type { EntityFormConfig } from './form-model.types';
import {
  getTabData,
  getTabPath,
  getValueByPath,
  normalizeArrayStructures,
  setTabData,
  setValueByPath,
} from './form-logic';

/**
 * Record-shape helpers (Parity Plan phase 1). These decide where a tab's values live in the
 * stored record — `doc.tabId.fieldId`, or `doc.fieldId` when the tab sets `flatData` — which
 * is the contract with already-stored data. The doc's four-row `flatData` table is covered
 * explicitly, including the 3-level nesting called out as defect #18.
 */
const CONFIG: EntityFormConfig = {
  entity: 'employees',
  tabs: [
    { id: 'personal', label: { en: 'Personal' }, fields: [{ id: 'firstName', type: 'text', label: { en: 'First' } }] },
    { id: 'payroll', label: { en: 'Payroll' }, flatData: true, fields: [{ id: 'salary', type: 'number', label: { en: 'Salary' } }] },
    {
      id: 'work',
      label: { en: 'Work' },
      fields: [],
      children: [
        {
          id: 'contract',
          label: { en: 'Contract' },
          fields: [{ id: 'startDate', type: 'date', label: { en: 'Start' } }],
          children: [
            { id: 'terms', label: { en: 'Terms' }, fields: [{ id: 'noticePeriod', type: 'text', label: { en: 'Notice' } }] },
          ],
        },
        { id: 'flatChild', label: { en: 'Flat child' }, flatData: true, fields: [] },
      ],
    },
  ],
};

describe('getValueByPath', () => {
  const obj = { a: { b: { c: 42 } }, list: [{ x: 1 }] };

  it('reads a nested path', () => {
    expect(getValueByPath(obj, 'a.b.c')).toBe(42);
  });

  it('reads through an array index', () => {
    expect(getValueByPath(obj, 'list.0.x')).toBe(1);
  });

  it('returns undefined for a missing segment, empty path, or null source', () => {
    expect(getValueByPath(obj, 'a.z.c')).toBeUndefined();
    expect(getValueByPath(obj, '')).toBeUndefined();
    expect(getValueByPath(null, 'a')).toBeUndefined();
  });
});

describe('setValueByPath', () => {
  it('writes a top-level key', () => {
    const o: any = {};
    setValueByPath(o, 'a', 1);
    expect(o).toEqual({ a: 1 });
  });

  it('creates intermediate objects that do not exist', () => {
    const o: any = {};
    setValueByPath(o, 'a.b.c', 'deep');
    expect(o).toEqual({ a: { b: { c: 'deep' } } });
  });

  it('replaces a non-object sitting in the way', () => {
    const o: any = { a: 'scalar' };
    setValueByPath(o, 'a.b', 1);
    expect(o).toEqual({ a: { b: 1 } });
  });

  it('overwrites an existing leaf without clobbering siblings', () => {
    const o: any = { a: { b: 1, keep: 2 } };
    setValueByPath(o, 'a.b', 9);
    expect(o).toEqual({ a: { b: 9, keep: 2 } });
  });

  it('ignores an empty path or missing target', () => {
    const o: any = { a: 1 };
    setValueByPath(o, '', 2);
    setValueByPath(null, 'a', 2);
    expect(o).toEqual({ a: 1 });
  });
});

describe('getTabPath', () => {
  it('returns a single segment for a top-level tab', () => {
    expect(getTabPath(CONFIG.tabs, 'personal')).toEqual(['personal']);
  });

  it('returns an empty path for a flatData tab — its fields live at the root', () => {
    expect(getTabPath(CONFIG.tabs, 'payroll')).toEqual([]);
  });

  it('walks nested tabs', () => {
    expect(getTabPath(CONFIG.tabs, 'contract')).toEqual(['work', 'contract']);
  });

  it('resolves a third-level tab', () => {
    expect(getTabPath(CONFIG.tabs, 'terms')).toEqual(['work', 'contract', 'terms']);
  });

  it('drops only the flat segment when a child is flat under a nested parent', () => {
    expect(getTabPath(CONFIG.tabs, 'flatChild')).toEqual(['work']);
  });

  it('returns null for an unknown tab', () => {
    expect(getTabPath(CONFIG.tabs, 'nope')).toBeNull();
    expect(getTabPath(undefined, 'personal')).toBeNull();
  });
});

describe('getTabData', () => {
  const record = {
    personal: { firstName: 'Ada' },
    salary: 5000,
    work: { contract: { startDate: '2024-01-01', terms: { noticePeriod: '1m' } } },
  };

  it('reads a nested tab sub-object', () => {
    expect(getTabData('personal', record, CONFIG)).toEqual({ firstName: 'Ada' });
  });

  it('reads the record root for a flatData tab', () => {
    expect(getTabData('payroll', record, CONFIG)).toBe(record);
  });

  it('reads a third-level tab (defect #18)', () => {
    expect(getTabData('terms', record, CONFIG)).toEqual({ noticePeriod: '1m' });
  });

  it('returns null/undefined for an unknown tab', () => {
    expect(getTabData('nope', record, CONFIG) ?? null).toBeNull();
  });
});

describe('setTabData', () => {
  it('writes a nested tab under its id', () => {
    const record: any = {};
    setTabData(record, CONFIG.tabs[0], { firstName: 'Ada' }, CONFIG);
    expect(record).toEqual({ personal: { firstName: 'Ada' } });
  });

  it('writes a flatData tab at the record root', () => {
    const record: any = {};
    setTabData(record, CONFIG.tabs[1], { salary: 5000 }, CONFIG);
    expect(record).toEqual({ salary: 5000 });
  });

  it('merges rather than replacing an existing tab sub-object', () => {
    const record: any = { personal: { keep: true } };
    setTabData(record, CONFIG.tabs[0], { firstName: 'Ada' }, CONFIG);
    expect(record.personal).toEqual({ keep: true, firstName: 'Ada' });
  });

  it('round-trips through getTabData', () => {
    const record: any = {};
    setTabData(record, CONFIG.tabs[0], { firstName: 'Ada' }, CONFIG);
    expect(getTabData('personal', record, CONFIG)).toEqual({ firstName: 'Ada' });
  });
});

describe('normalizeArrayStructures', () => {
  const arrayConfig: EntityFormConfig = {
    entity: 'x',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          { id: 'rows', type: 'array', label: { en: 'Rows' }, children: [{ id: 'a', type: 'text', label: { en: 'A' } }] },
          {
            id: 'grp',
            type: 'group',
            label: { en: 'Group' },
            children: [{ id: 'inner', type: 'array', label: { en: 'Inner' }, children: [] }],
          },
        ],
      },
    ],
  };

  it('coerces a missing array field to []', () => {
    const rec: any = { main: {} };
    normalizeArrayStructures(rec, arrayConfig);
    expect(rec.main.rows).toEqual([]);
  });

  it('wraps a single object into an array', () => {
    const rec: any = { main: { rows: { a: 1 } } };
    normalizeArrayStructures(rec, arrayConfig);
    expect(rec.main.rows).toEqual([{ a: 1 }]);
  });

  it('leaves a well-formed array alone', () => {
    const rec: any = { main: { rows: [{ a: 1 }, { a: 2 }] } };
    normalizeArrayStructures(rec, arrayConfig);
    expect(rec.main.rows).toHaveLength(2);
  });

  it('recurses into group children', () => {
    const rec: any = { main: { grp: {} } };
    normalizeArrayStructures(rec, arrayConfig);
    expect(rec.main.grp.inner).toEqual([]);
  });
});
