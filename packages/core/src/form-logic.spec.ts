import type { DropdownOption, EntityFormConfig, FormRule } from './form-model.types';
import {
  applyAutoPatch,
  applyPatchOnTrue,
  evaluateFieldVisibility,
  formatDisplayValue,
  getLocaleLang,
  getTabData,
  labelToId,
  normalizeArrayStructures,
  normalizeConfig,
  normalizeField,
  normalizeLocalizedText,
  normalizeConfigOptions,
  valuesMatch,
  normalizeOption,
  normalizeTab,
  resolveEffectiveMask,
  resolveLabel,
  setTabData,
  shouldMaskField,
  uniqueId,
} from './form-logic';

const CONFIG: EntityFormConfig = {
  entity: 'employees',
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal' },
      fields: [
        { id: 'firstName', type: 'text', label: { en: 'First name' } },
        {
          id: 'contact',
          type: 'group',
          label: { en: 'Contact' },
          children: [{ id: 'email', type: 'email', label: { en: 'Email' } }],
        },
        { id: 'addresses', type: 'array', label: { en: 'Addresses' }, children: [{ id: 'city', type: 'text', label: { en: 'City' } }] },
      ],
    },
    { id: 'employment', label: { en: 'Employment' }, flatData: true, fields: [{ id: 'salary', type: 'number', label: { en: 'Salary' } }] },
  ],
};

describe('resolveLabel', () => {
  it('falls back lang → en → first', () => {
    expect(resolveLabel({ en: 'Hi', de: 'Hallo' }, 'de')).toBe('Hallo');
    expect(resolveLabel({ en: 'Hi' }, 'de')).toBe('Hi');
    expect(resolveLabel({ fr: 'Salut' }, 'de')).toBe('Salut');
    expect(resolveLabel(undefined)).toBe('');
  });
});

describe('formatDisplayValue', () => {
  // Canonical option shape: the displayed text is the stored value.
  const opts: DropdownOption[] = [{ en: 'Active' }, { en: 'Inactive' }];
  it('handles empties, boolean, password, dropdown, multiSelect, date', () => {
    expect(formatDisplayValue('text', undefined, '')).toBe('—');
    expect(formatDisplayValue('boolean', undefined, true)).toBe('Yes');
    expect(formatDisplayValue('boolean', undefined, false)).toBe('No');
    expect(formatDisplayValue('password', undefined, 'secret')).toBe('••••••••');
    expect(formatDisplayValue('dropdown', opts, { en: 'Active' })).toBe('Active');
    expect(formatDisplayValue('multiSelect', opts, [{ en: 'Active' }, { en: 'Inactive' }])).toBe(
      'Active, Inactive',
    );
    expect(formatDisplayValue('date', undefined, '2020-01-15')).toBe(new Date('2020-01-15').toLocaleDateString());
  });

  it('matches a stored value against the option text, whatever case it was saved in', () => {
    expect(formatDisplayValue('dropdown', opts, 'Active')).toBe('Active');
  });

  it('falls back to the raw text for a legacy value with no matching option', () => {
    // Records saved under the old scalar `value` ("active") no longer match the option
    // text ("Active"), so the stored text is shown as-is rather than an em dash.
    expect(formatDisplayValue('dropdown', opts, 'active')).toBe('active');
  });
});

describe('normalizeConfigOptions', () => {
  const legacy = (): EntityFormConfig => ({
    entity: 'x',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          {
            id: 'status',
            type: 'dropdown',
            label: { en: 'Status' },
            options: [{ value: 'a', label: { en: 'Active' } } as never, 'Bare' as never, null as never],
          },
          {
            id: 'grp',
            type: 'group',
            label: { en: 'G' },
            children: [
              { id: 'inner', type: 'radio', label: { en: 'I' }, options: [7 as never] },
            ],
          },
        ],
        children: [
          {
            id: 'sub',
            label: { en: 'Sub' },
            fields: [{ id: 'deep', type: 'dropdown', label: { en: 'D' }, options: ['X' as never] }],
          },
        ],
      },
    ],
  });

  it('upcasts options on fields, group children, and nested tabs', () => {
    const out = normalizeConfigOptions(legacy());

    expect(out.tabs[0].fields![0].options).toEqual([{ en: 'Active' }, { en: 'Bare' }]);
    expect(out.tabs[0].fields![1].children![0].options).toEqual([{ en: '7' }]);
    expect(out.tabs[0].children![0].fields![0].options).toEqual([{ en: 'X' }]);
  });

  it('drops nullish options rather than inventing a blank choice', () => {
    expect(normalizeConfigOptions(legacy()).tabs[0].fields![0].options).toHaveLength(2);
  });

  it('does not mutate the config it was given', () => {
    const input = legacy();
    normalizeConfigOptions(input);
    expect(input.tabs[0].fields![0].options).toHaveLength(3);
  });

  it('returns the same object when every option is already canonical', () => {
    const canonical: EntityFormConfig = {
      entity: 'x',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [{ id: 's', type: 'dropdown', label: { en: 'S' }, options: [{ en: 'Active' }] }],
        },
      ],
    };

    // Identity, so a well-formed config costs nothing and callers can skip redundant work.
    expect(normalizeConfigOptions(canonical)).toBe(canonical);
  });

  it('is idempotent', () => {
    const once = normalizeConfigOptions(legacy());
    expect(normalizeConfigOptions(once)).toBe(once);
  });

  it('tolerates a config with no tabs or no options', () => {
    const bare: EntityFormConfig = { entity: 'x', tabs: [] };
    expect(normalizeConfigOptions(bare)).toBe(bare);
  });
});

describe('valuesMatch', () => {
  it('matches identical scalars and objects', () => {
    expect(valuesMatch('a', 'a')).toBe(true);
    expect(valuesMatch({ en: 'Active' }, { en: 'Active' })).toBe(true);
  });

  it('ignores key order — the same option from two serialisers must compare equal', () => {
    expect(valuesMatch({ en: 'A', de: 'B' }, { de: 'B', en: 'A' })).toBe(true);
  });

  it('matches an object against the scalar text it resolves to', () => {
    expect(valuesMatch({ en: 'Active' }, 'Active')).toBe(true);
  });

  it('does not match different options', () => {
    expect(valuesMatch({ en: 'Active' }, { en: 'Inactive' })).toBe(false);
  });

  it('treats null and undefined as equal, and neither as equal to a value', () => {
    expect(valuesMatch(null, undefined)).toBe(true);
    expect(valuesMatch(null, 'a')).toBe(false);
  });
});

describe('normalizeOption', () => {
  it('passes a canonical LocalizedText through', () => {
    expect(normalizeOption({ en: 'Active', de: 'Aktiv' })).toEqual({ en: 'Active', de: 'Aktiv' });
  });

  it('keeps the label from a legacy { value, label } wrapper', () => {
    expect(normalizeOption({ value: 'active', label: { en: 'Active' } })).toEqual({ en: 'Active' });
  });

  it('coerces a legacy string-labelled wrapper', () => {
    expect(normalizeOption({ value: 1, label: 'One' })).toEqual({ en: 'One' });
  });

  it('wraps bare primitives', () => {
    expect(normalizeOption('Active')).toEqual({ en: 'Active' });
    expect(normalizeOption(42)).toEqual({ en: '42' });
  });

  it('falls back to the value when a wrapper has no label', () => {
    expect(normalizeOption({ value: 'Active' })).toEqual({ en: 'Active' });
  });

  it('yields an empty option for null/undefined', () => {
    expect(normalizeOption(null)).toEqual({ en: '' });
    expect(normalizeOption(undefined)).toEqual({ en: '' });
  });
});

describe('nested record access', () => {
  const rec: any = {
    personal: { firstName: 'John', contact: { email: 'j@x.com' }, addresses: [{ city: 'Berlin' }, { city: 'Munich' }] },
    salary: 5000, // flatData tab
  };
  it('getTabData honors flatData', () => {
    expect(getTabData('personal', rec, CONFIG)).toBe(rec.personal);
    expect(getTabData('employment', rec, CONFIG)).toBe(rec); // flat → record root
  });
});

describe('setTabData', () => {
  it('nests under tab id, or flat when flatData', () => {
    const r1 = setTabData({}, CONFIG.tabs[0], { firstName: 'Jane' });
    expect(r1).toEqual({ personal: { firstName: 'Jane' } });
    const r2 = setTabData({}, CONFIG.tabs[1], { salary: 9000 });
    expect(r2).toEqual({ salary: 9000 });
  });
});

describe('normalizeArrayStructures', () => {
  it('coerces array fields to arrays', () => {
    const rec: any = { personal: { addresses: null }, salary: 1 };
    normalizeArrayStructures(rec, CONFIG);
    expect(rec.personal.addresses).toEqual([]);
  });

  it('normalizes single non-array values to an array list', () => {
    const rec: any = { personal: { addresses: { city: 'Berlin' } } };
    normalizeArrayStructures(rec, CONFIG);
    expect(rec.personal.addresses).toEqual([{ city: 'Berlin' }]);
  });
});

describe('masking', () => {
  it('resolveEffectiveMask ORs the 3 levels', () => {
    expect(resolveEffectiveMask(false, false, true)).toBe(true);
    expect(resolveEffectiveMask(true, false, false)).toBe(true);
    expect(resolveEffectiveMask(false, true, false)).toBe(true);
    expect(resolveEffectiveMask(false, false, false)).toBe(false);
  });

  it('shouldMaskField requires a masked role and an effective mask', () => {
    const field = { id: 'salary', type: 'number' as const, label: { en: 'Salary' }, maskData: true };
    expect(shouldMaskField(field, undefined, CONFIG, ['IT_SUPPORT'], ['IT_SUPPORT'])).toBe(true);
    expect(shouldMaskField(field, undefined, CONFIG, ['viewer', 'IT_SUPPORT'], ['IT_SUPPORT', 'GUEST'])).toBe(true);
    expect(shouldMaskField(field, undefined, CONFIG, ['admin'], ['IT_SUPPORT'])).toBe(false);
  });
});

describe('evaluateFieldVisibility', () => {
  it('honors visibility:false and showWhen', () => {
    const hidden = { id: 'x', type: 'text' as const, label: { en: 'X' }, visibility: false };
    expect(evaluateFieldVisibility(hidden, {})).toBe(false);
    const cond = { id: 'y', type: 'text' as const, label: { en: 'Y' }, showWhen: { isEmployee: true, status: 'active' } };
    expect(evaluateFieldVisibility(cond, { isEmployee: true, status: 'active' })).toBe(true);
    expect(evaluateFieldVisibility(cond, { isEmployee: true, status: 'inactive' })).toBe(false);
    expect(evaluateFieldVisibility(cond, { isEmployee: false, status: 'active' })).toBe(false);
  });
});

// ─── Phase 0 additions ────────────────────────────────────────────────────────

describe('labelToId', () => {
  it('converts labels to camelCase IDs', () => {
    expect(labelToId('Employee Count')).toBe('employeeCount');
    expect(labelToId('first name')).toBe('firstName');
    expect(labelToId('FIRST_NAME')).toBe('firstName');
    expect(labelToId('  Multiple   Spaces  ')).toBe('multipleSpaces');
    expect(labelToId('')).toBe('');
    expect(labelToId('Single')).toBe('single');
  });
});

describe('uniqueId', () => {
  it('returns a unique string each call', () => {
    const a = uniqueId('f');
    const b = uniqueId('f');
    expect(a).not.toBe(b);
    expect(a.startsWith('f_')).toBe(true);
  });

  it('defaults prefix to "field"', () => {
    expect(uniqueId().startsWith('field_')).toBe(true);
  });
});

describe('getLocaleLang', () => {
  it('maps BCP-47 locale to 2-char code', () => {
    expect(getLocaleLang('de-DE')).toBe('de');
    expect(getLocaleLang('en-US')).toBe('en');
    expect(getLocaleLang('fr-FR')).toBe('fr');
    expect(getLocaleLang('xx-XX')).toBe('en'); // unknown → fallback
    expect(getLocaleLang('')).toBe('en');
  });
});

describe('normalizeLocalizedText', () => {
  it('handles strings, objects, null', () => {
    expect(normalizeLocalizedText('Hello')).toEqual({ en: 'Hello' });
    expect(normalizeLocalizedText({ en: 'Hi', de: 'Hallo' })).toEqual({ en: 'Hi', de: 'Hallo' });
    expect(normalizeLocalizedText(null)).toEqual({ en: '' });
    expect(normalizeLocalizedText(undefined)).toEqual({ en: '' });
    expect(normalizeLocalizedText(42)).toEqual({ en: '42' });
  });
});

describe('normalizeField', () => {
  it('does NOT inject options on non-option field types', () => {
    const raw = { id: 'name', type: 'text', label: { en: 'Name' } };
    const result = normalizeField(raw);
    expect(result.options).toBeUndefined();
  });

  it('normalizes id from _id and label from string', () => {

    const raw = { _id: 'abc', type: 'text', label: 'My Field', options: [] };
    const result = normalizeField(raw);
    expect(result.id).toBe('abc');
    expect(result.label).toEqual({ en: 'My Field' });
  });

  it('normalizes every legacy option shape to a LocalizedText', () => {
    const raw = {
      id: 'status',
      type: 'dropdown',
      label: { en: 'Status' },
      options: ['Active', { value: 'x', label: { en: 'Inactive' } }, 7, { en: 'Pending', de: 'Offen' }],
    };
    const result = normalizeField(raw);

    expect(result.options).toEqual([
      { en: 'Active' },
      { en: 'Inactive' },
      { en: '7' },
      { en: 'Pending', de: 'Offen' },
    ]);
  });

  it('normalizes object-keyed children map', () => {
    const raw = {
      id: 'address', type: 'group', label: { en: 'Address' },
      children: { street: { type: 'text', label: { en: 'Street' } } },
    };
    const result = normalizeField(raw);
    expect(result.children).toHaveLength(1);
    expect(result.children![0].id).toBe('street');
  });
});

describe('normalizeTab', () => {
  it('normalizes tab with object-keyed fields', () => {
    const raw = {
      _id: 'personalTab',
      label: 'Personal',
      fields: { name: { type: 'text', label: { en: 'Name' } } },
    };
    const result = normalizeTab(raw);
    expect(result.id).toBe('personalTab');
    expect(result.label).toEqual({ en: 'Personal' });
    expect(result.fields).toHaveLength(1);
    expect(result.fields![0].id).toBe('name');
  });
});

describe('normalizeConfig', () => {
  it('normalizes full config from storage', () => {
    const raw = {
      _id: 'cfg1',
      entity: 'contacts',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text', label: 'Full Name' }] }],
    };
    const result = normalizeConfig(raw);
    expect(result.entity).toBe('contacts');
    expect(result.tabs[0].fields![0].label).toEqual({ en: 'Full Name' });
  });
});

describe('applyAutoPatch', () => {
  it('copies mapped fields from selected record', () => {
    const config = { targetTab: 'employment', mappings: [{ source: 'name', target: 'employeeName' }, { source: 'dept', target: 'department' }] };
    const selected = { name: 'Alice', dept: 'Engineering', _id: 'u1' };
    const patch = applyAutoPatch(config, selected);
    expect(patch).toEqual({ employeeName: 'Alice', department: 'Engineering' });
  });

  it('skips missing source fields', () => {
    const config = { targetTab: 'tab1', mappings: [{ source: 'missing', target: 'target' }] };
    const patch = applyAutoPatch(config, { name: 'Bob' });
    expect(patch).toEqual({});
  });
});

describe('applyPatchOnTrue', () => {
  it('copies from→to when boolean flips to true', () => {
    const mappings = [{ from: 'startDate', to: 'joinDate' }];
    const record = { startDate: '2024-01-01', isEmployee: true };
    const patch = applyPatchOnTrue(mappings, record);
    expect(patch).toEqual({ joinDate: '2024-01-01' });
  });

  it('skips when source field does not exist', () => {
    const patch = applyPatchOnTrue([{ from: 'missing', to: 'target' }], { other: 'val' });
    expect(patch).toEqual({});
  });
});
