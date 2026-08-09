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
  const opts: DropdownOption[] = [
    { value: 'active', label: { en: 'Active' } },
    { value: 'inactive', label: { en: 'Inactive' } },
  ];
  it('handles empties, boolean, password, dropdown, multiSelect, date', () => {
    expect(formatDisplayValue('text', undefined, '')).toBe('—');
    expect(formatDisplayValue('boolean', undefined, true)).toBe('Yes');
    expect(formatDisplayValue('boolean', undefined, false)).toBe('No');
    expect(formatDisplayValue('password', undefined, 'secret')).toBe('••••••••');
    expect(formatDisplayValue('dropdown', opts, 'active')).toBe('Active');
    expect(formatDisplayValue('multiSelect', opts, ['active', 'inactive'])).toBe('Active, Inactive');
    expect(formatDisplayValue('date', undefined, '2020-01-15')).toBe(new Date('2020-01-15').toLocaleDateString());
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

  it('normalizes string options to DropdownOption', () => {
    const raw = { id: 'status', type: 'dropdown', label: { en: 'Status' }, options: ['Active', 'Inactive'] };
    const result = normalizeField(raw);
    expect(result.options).toHaveLength(2);
    expect(result.options![0]).toEqual({ value: 'Active', label: { en: 'Active' } });
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
