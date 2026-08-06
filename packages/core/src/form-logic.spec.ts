import type { DropdownOption, EntityFormConfig } from './form-model.types';
import {
  evaluateFieldVisibility,
  formatDisplayValue,
  getTabData,
  normalizeArrayStructures,
  resolveEffectiveMask,
  resolveLabel,
  setTabData,
  shouldMaskField,
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
