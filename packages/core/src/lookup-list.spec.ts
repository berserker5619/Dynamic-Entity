import { valuesMatch } from './form-logic';
import type { EntityFormConfig } from './form-model.types';
import {
  findUnmatchedValues,
  lookupValuesToOptions,
  normalizeLookupValues,
  type LookupListValue,
} from './lookup-list';

describe('normalizeLookupValues', () => {
  it('orders by sortOrder', () => {
    const values = normalizeLookupValues([
      { name: { en: 'Third' }, sortOrder: 3 },
      { name: { en: 'First' }, sortOrder: 1 },
      { name: { en: 'Second' }, sortOrder: 2 },
    ]);
    expect(values.map(v => v.name['en'])).toEqual(['First', 'Second', 'Third']);
  });

  it('keeps incoming order when no value carries a sortOrder', () => {
    const values = normalizeLookupValues([{ name: { en: 'B' } }, { name: { en: 'A' } }]);
    expect(values.map(v => v.name['en'])).toEqual(['B', 'A']);
  });

  it('sorts unordered values after ordered ones, preserving their order', () => {
    const values = normalizeLookupValues([
      { name: { en: 'Unordered A' } },
      { name: { en: 'Ordered' }, sortOrder: 5 },
      { name: { en: 'Unordered B' } },
    ]);
    expect(values.map(v => v.name['en'])).toEqual(['Ordered', 'Unordered A', 'Unordered B']);
  });

  it('tolerates bare strings and numbers', () => {
    const values = normalizeLookupValues(['Draft', 7]);
    expect(values).toEqual([{ name: { en: 'Draft' } }, { name: { en: '7' } }]);
  });

  it('tolerates a bare LocalizedText', () => {
    expect(normalizeLookupValues([{ en: 'Active', de: 'Aktiv' }])).toEqual([
      { name: { en: 'Active', de: 'Aktiv' } },
    ]);
  });

  it('preserves _id, code, isSystemDefined and from', () => {
    const [value] = normalizeLookupValues([
      {
        _id: 'abc123',
        code: 'ACT',
        name: { en: 'Active' },
        sortOrder: 1,
        isSystemDefined: true,
        from: 'seed',
      },
    ]);
    expect(value).toEqual({
      _id: 'abc123',
      code: 'ACT',
      name: { en: 'Active' },
      sortOrder: 1,
      isSystemDefined: true,
      from: 'seed',
    });
  });

  it('drops null and undefined entries, and tolerates a missing list', () => {
    expect(normalizeLookupValues([null, 'A', undefined] as never)).toEqual([
      { name: { en: 'A' } },
    ]);
    expect(normalizeLookupValues(null)).toEqual([]);
    expect(normalizeLookupValues(undefined)).toEqual([]);
  });
});

describe('lookupValuesToOptions', () => {
  it('projects each value onto its name — the name is the option', () => {
    const values: LookupListValue[] = [
      { _id: '1', code: 'A', name: { en: 'Active', de: 'Aktiv' } },
      { _id: '2', code: 'I', name: { en: 'Inactive' } },
    ];
    expect(lookupValuesToOptions(values)).toEqual([
      { en: 'Active', de: 'Aktiv' },
      { en: 'Inactive' },
    ]);
  });

  it('drops no language — the whole LocalizedText survives (unlike the reference mapper)', () => {
    const [option] = lookupValuesToOptions(normalizeLookupValues([{ en: 'Active', de: 'Aktiv' }]));
    expect(option).toEqual({ en: 'Active', de: 'Aktiv' });
  });
});

describe('valuesMatch — cross-language matching (§6.4)', () => {
  it('matches when a shared language still agrees, after another was renamed', () => {
    const stored = { en: 'Active', de: 'Aktiv' };
    const renamed = { en: 'Active', de: 'Aktiviert' };
    expect(valuesMatch(stored, renamed, 'de')).toBe(true);
  });

  it('matches a legacy single-language record against a multilingual option', () => {
    expect(valuesMatch({ en: 'Active', de: 'Aktiv' }, 'Aktiv', 'en')).toBe(true);
    expect(valuesMatch('Aktiv', { en: 'Active', de: 'Aktiv' }, 'en')).toBe(true);
  });

  it('matches on a shared language even when the active one disagrees', () => {
    expect(valuesMatch({ en: 'Active', de: 'Aktiv' }, { en: 'Enabled', de: 'Aktiv' }, 'en')).toBe(
      true,
    );
  });

  it('still rejects a genuinely different value', () => {
    expect(valuesMatch({ en: 'Active', de: 'Aktiv' }, { en: 'Inactive', de: 'Inaktiv' })).toBe(
      false,
    );
  });

  it('ignores empty strings, so two options with a blank language do not match', () => {
    expect(valuesMatch({ en: 'Active', de: '' }, { en: 'Inactive', de: '' })).toBe(false);
  });
});

describe('findUnmatchedValues', () => {
  const config: EntityFormConfig = {
    entity: 'employee',
    tabs: [
      {
        id: 'personal',
        label: { en: 'Personal' },
        fields: [
          { id: 'firstName', type: 'text', label: { en: 'First name' } },
          {
            id: 'status',
            type: 'dropdown',
            label: { en: 'Status' },
            listName: 'employeeStatus',
          },
          {
            id: 'grade',
            type: 'radio',
            label: { en: 'Grade' },
            options: [{ en: 'Senior' }, { en: 'Junior' }],
          },
        ],
      },
    ],
  };

  const lists = { employeeStatus: [{ en: 'Active' }, { en: 'On Leave' }] };

  it('reports a stored value with no matching list option', () => {
    const record = { personal: { status: { en: 'Retired' } } };
    expect(findUnmatchedValues(record, config, lists)).toEqual([
      {
        path: 'personal.status',
        tabId: 'personal',
        fieldId: 'status',
        listName: 'employeeStatus',
        value: { en: 'Retired' },
      },
    ]);
  });

  it('reports nothing when the value still matches', () => {
    const record = { personal: { status: { en: 'Active' } } };
    expect(findUnmatchedValues(record, config, lists)).toEqual([]);
  });

  it('matches through the cross-language rule rather than reporting an orphan', () => {
    const record = { personal: { status: { en: 'Active', de: 'Aktiv' } } };
    const renamed = { employeeStatus: [{ en: 'Active', de: 'Aktiviert' }] };
    expect(findUnmatchedValues(record, config, renamed, 'de')).toEqual([]);
  });

  it('covers inline options too, not only named lists', () => {
    const record = { personal: { grade: { en: 'Principal' } } };
    const [finding] = findUnmatchedValues(record, config, lists);
    expect(finding).toEqual({
      path: 'personal.grade',
      tabId: 'personal',
      fieldId: 'grade',
      value: { en: 'Principal' },
    });
    expect(finding.listName).toBeUndefined();
  });

  it('skips a field whose list was not supplied — unknown is not unmatched', () => {
    const record = { personal: { status: { en: 'Retired' } } };
    expect(findUnmatchedValues(record, config, {})).toEqual([]);
  });

  it('ignores empty, null and undefined values', () => {
    const record = { personal: { status: '', grade: null } };
    expect(findUnmatchedValues(record, config, lists)).toEqual([]);
    expect(findUnmatchedValues({ personal: {} }, config, lists)).toEqual([]);
  });

  it('accepts the lists as a Map', () => {
    const record = { personal: { status: { en: 'Retired' } } };
    const asMap = new Map([['employeeStatus', [{ en: 'Active' }]]]);
    expect(findUnmatchedValues(record, config, asMap)).toHaveLength(1);
  });

  it('indexes each unmatched entry of a multiSelect', () => {
    const multiConfig: EntityFormConfig = {
      entity: 'employee',
      tabs: [
        {
          id: 'personal',
          label: { en: 'Personal' },
          fields: [
            { id: 'skills', type: 'multiSelect', label: { en: 'Skills' }, listName: 'skills' },
          ],
        },
      ],
    };
    const record = { personal: { skills: [{ en: 'Angular' }, { en: 'COBOL' }] } };
    const findings = findUnmatchedValues(record, multiConfig, { skills: [{ en: 'Angular' }] });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('personal.skills[1]');
  });

  it('walks a flatData tab at the record root', () => {
    const flat: EntityFormConfig = {
      entity: 'employee',
      tabs: [
        {
          id: 'personal',
          label: { en: 'Personal' },
          flatData: true,
          fields: [{ id: 'status', type: 'dropdown', label: { en: 'Status' }, listName: 'l' }],
        },
      ],
    };
    const findings = findUnmatchedValues({ status: { en: 'Retired' } }, flat, {
      l: [{ en: 'Active' }],
    });
    expect(findings.map(f => f.path)).toEqual(['status']);
  });

  it('descends into nested tabs, groups and array rows', () => {
    const nested: EntityFormConfig = {
      entity: 'employee',
      tabs: [
        {
          id: 'work',
          label: { en: 'Work' },
          children: [
            {
              id: 'history',
              label: { en: 'History' },
              fields: [
                {
                  id: 'address',
                  type: 'group',
                  label: { en: 'Address' },
                  children: [
                    { id: 'country', type: 'dropdown', label: { en: 'Country' }, listName: 'c' },
                  ],
                },
                {
                  id: 'roles',
                  type: 'array',
                  label: { en: 'Roles' },
                  children: [
                    { id: 'title', type: 'dropdown', label: { en: 'Title' }, listName: 't' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const record = {
      work: {
        history: {
          address: { country: { en: 'Atlantis' } },
          roles: [{ title: { en: 'Developer' } }, { title: { en: 'Scribe' } }],
        },
      },
    };
    const findings = findUnmatchedValues(record, nested, {
      c: [{ en: 'Germany' }],
      t: [{ en: 'Developer' }],
    });
    expect(findings.map(f => f.path)).toEqual([
      'work.history.address.country',
      'work.history.roles[1].title',
    ]);
    expect(findings.every(f => f.tabId === 'history')).toBe(true);
  });

  it('prefers inline options over a named list when a field carries both', () => {
    const both: EntityFormConfig = {
      entity: 'e',
      tabs: [
        {
          id: 't',
          label: { en: 'T' },
          fields: [
            {
              id: 'f',
              type: 'dropdown',
              label: { en: 'F' },
              listName: 'ignored',
              options: [{ en: 'Inline' }],
            },
          ],
        },
      ],
    };
    expect(findUnmatchedValues({ t: { f: { en: 'Inline' } } }, both, { ignored: [] })).toEqual([]);
  });

  it('returns nothing for a missing record or config', () => {
    expect(findUnmatchedValues(null, config, lists)).toEqual([]);
    expect(findUnmatchedValues({}, null, lists)).toEqual([]);
  });
});
