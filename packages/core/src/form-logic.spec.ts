import type { DropdownOption, EntityFormConfig, FormRule } from './form-model.types';
import {
  applyAutoPatch,
  applyPatchOnTrue,
  evaluateFieldVisibility,
  evaluateRules,
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

describe('evaluateRules', () => {
  const mkRule = (partial: Partial<FormRule>): FormRule => ({
    id: 'r1',
    formConfigId: 'cfg',
    fieldId: 'status',
    conditions: [],
    action: { type: 'visibility', value: false },
    targets: [{ id: 'salary', type: 'field' }],
    enabled: true,
    priority: 1,
    ...partial,
  });

  it('EQUAL — hides field when trigger matches', () => {
    const rule = mkRule({ conditions: [{ operator: 'EQUAL', value: 'inactive', compareType: 'value' }] });
    const r = evaluateRules([rule], { status: 'inactive' });
    expect(r.hiddenFields).toContain('salary');
  });

  it('NOT_EQUAL — hides when trigger does not match', () => {
    const rule = mkRule({ conditions: [{ operator: 'NOT_EQUAL', value: 'active', compareType: 'value' }] });
    const r = evaluateRules([rule], { status: 'inactive' });
    expect(r.hiddenFields).toContain('salary');
    const r2 = evaluateRules([rule], { status: 'active' });
    expect(r2.hiddenFields).toHaveLength(0);
  });

  it('IS_EMPTY / IS_NOT_EMPTY', () => {
    const emptyRule = mkRule({ conditions: [{ operator: 'IS_EMPTY', value: undefined, compareType: 'value' }] });
    expect(evaluateRules([emptyRule], { status: '' }).hiddenFields).toContain('salary');
    expect(evaluateRules([emptyRule], { status: 'x' }).hiddenFields).toHaveLength(0);

    const notEmptyRule = mkRule({ conditions: [{ operator: 'IS_NOT_EMPTY', value: undefined, compareType: 'value' }] });
    expect(evaluateRules([notEmptyRule], { status: 'x' }).hiddenFields).toContain('salary');
  });

  it('CONTAINS / NOT_CONTAINS / STARTS_WITH / ENDS_WITH', () => {
    const c = mkRule({ conditions: [{ operator: 'CONTAINS', value: 'act', compareType: 'value' }] });
    expect(evaluateRules([c], { status: 'inactive' }).hiddenFields).toContain('salary');

    const nc = mkRule({ conditions: [{ operator: 'NOT_CONTAINS', value: 'xxx', compareType: 'value' }] });
    expect(evaluateRules([nc], { status: 'inactive' }).hiddenFields).toContain('salary');

    const sw = mkRule({ conditions: [{ operator: 'STARTS_WITH', value: 'in', compareType: 'value' }] });
    expect(evaluateRules([sw], { status: 'inactive' }).hiddenFields).toContain('salary');

    const ew = mkRule({ conditions: [{ operator: 'ENDS_WITH', value: 'tive', compareType: 'value' }] });
    expect(evaluateRules([ew], { status: 'inactive' }).hiddenFields).toContain('salary');
  });

  it('numeric operators: LESS_THAN, MORE_THAN, LESS_THAN_EQUAL, MORE_THAN_EQUAL', () => {
    const lt = mkRule({ fieldId: 'age', conditions: [{ operator: 'LESS_THAN', value: 18, compareType: 'value' }] });
    expect(evaluateRules([lt], { age: 16 }).hiddenFields).toContain('salary');
    expect(evaluateRules([lt], { age: 20 }).hiddenFields).toHaveLength(0);

    const gt = mkRule({ fieldId: 'age', conditions: [{ operator: 'MORE_THAN', value: 18, compareType: 'value' }] });
    expect(evaluateRules([gt], { age: 20 }).hiddenFields).toContain('salary');

    const lte = mkRule({ fieldId: 'age', conditions: [{ operator: 'LESS_THAN_EQUAL', value: 18, compareType: 'value' }] });
    expect(evaluateRules([lte], { age: 18 }).hiddenFields).toContain('salary');

    const gte = mkRule({ fieldId: 'age', conditions: [{ operator: 'MORE_THAN_EQUAL', value: 18, compareType: 'value' }] });
    expect(evaluateRules([gte], { age: 18 }).hiddenFields).toContain('salary');
  });

  it('IN / NOT_IN', () => {
    const inRule = mkRule({ conditions: [{ operator: 'IN', value: ['a', 'b'], compareType: 'value' }] });
    expect(evaluateRules([inRule], { status: 'a' }).hiddenFields).toContain('salary');
    expect(evaluateRules([inRule], { status: 'c' }).hiddenFields).toHaveLength(0);

    const notIn = mkRule({ conditions: [{ operator: 'NOT_IN', value: ['a', 'b'], compareType: 'value' }] });
    expect(evaluateRules([notIn], { status: 'c' }).hiddenFields).toContain('salary');
  });

  it('HAS_ITEMS', () => {
    const r = mkRule({ fieldId: 'tags', conditions: [{ operator: 'HAS_ITEMS', value: undefined, compareType: 'value' }] });
    expect(evaluateRules([r], { tags: ['x'] }).hiddenFields).toContain('salary');
    expect(evaluateRules([r], { tags: [] }).hiddenFields).toHaveLength(0);
  });

  it('VALUE_CHANGED requires baseline', () => {
    const r = mkRule({ conditions: [{ operator: 'VALUE_CHANGED', value: undefined, compareType: 'value' }] });
    expect(evaluateRules([r], { status: 'new' }, { status: 'old' }).hiddenFields).toContain('salary');
    expect(evaluateRules([r], { status: 'old' }, { status: 'old' }).hiddenFields).toHaveLength(0);
    // Without baseline — VALUE_CHANGED should not fire
    expect(evaluateRules([r], { status: 'new' }).hiddenFields).toHaveLength(0);
  });

  it('disabled rules are ignored', () => {
    const r = mkRule({ enabled: false, conditions: [{ operator: 'EQUAL', value: 'inactive', compareType: 'value' }] });
    expect(evaluateRules([r], { status: 'inactive' }).hiddenFields).toHaveLength(0);
  });

  it('validation action produces error/warning', () => {
    const errRule = mkRule({
      conditions: [{ operator: 'IS_EMPTY', value: undefined, compareType: 'value' }],
      action: { type: 'validation', value: 'Required field', severity: 'error' },
    });
    const r = evaluateRules([errRule], { status: '' });
    expect(r.validationErrors['salary']).toBe('Required field');

    const warnRule = mkRule({
      conditions: [{ operator: 'IS_EMPTY', value: undefined, compareType: 'value' }],
      action: { type: 'validation', value: 'Consider filling', severity: 'warning' },
    });
    const r2 = evaluateRules([warnRule], { status: '' });
    expect(r2.validationWarnings['salary']).toBe('Consider filling');
  });

  it('info action produces banner', () => {
    const infoRule = mkRule({
      conditions: [{ operator: 'EQUAL', value: 'pending', compareType: 'value' }],
      action: { type: 'info', value: 'Record is pending review' },
    });
    const r = evaluateRules([infoRule], { status: 'pending' });
    expect(r.infoBanners['salary']).toBe('Record is pending review');
  });

  it('hides a tab when target.type is "tab"', () => {
    const r = mkRule({
      conditions: [{ operator: 'EQUAL', value: 'inactive', compareType: 'value' }],
      targets: [{ id: 'employment', type: 'tab' }],
    });
    expect(evaluateRules([r], { status: 'inactive' }).hiddenTabs).toContain('employment');
  });

  it('multi-condition AND — all must pass', () => {
    const r = mkRule({
      conditions: [
        { operator: 'EQUAL', value: 'inactive', compareType: 'value' },
        { operator: 'EQUAL', value: 'inactive', compareType: 'value' }, // same field, both pass
      ],
    });
    expect(evaluateRules([r], { status: 'inactive' }).hiddenFields).toContain('salary');
    // If one fails, the rule does not fire:
    const r2 = mkRule({
      fieldId: 'status',
      conditions: [
        { operator: 'EQUAL', value: 'inactive', compareType: 'value' },
        { operator: 'EQUAL', value: 'active', compareType: 'value' }, // contradicts
      ],
    });
    expect(evaluateRules([r2], { status: 'inactive' }).hiddenFields).toHaveLength(0);
  });

  it('DATE_BEFORE / DATE_AFTER', () => {
    const before = mkRule({
      fieldId: 'startDate',
      conditions: [{ operator: 'DATE_BEFORE', value: '2024-06-01', compareType: 'value' }],
    });
    expect(evaluateRules([before], { startDate: '2024-01-01' }).hiddenFields).toContain('salary');
    expect(evaluateRules([before], { startDate: '2024-12-01' }).hiddenFields).toHaveLength(0);

    const after = mkRule({
      fieldId: 'startDate',
      conditions: [{ operator: 'DATE_AFTER', value: '2024-06-01', compareType: 'value' }],
    });
    expect(evaluateRules([after], { startDate: '2024-12-01' }).hiddenFields).toContain('salary');
  });

  it('field-to-field compareType', () => {
    const r = mkRule({
      fieldId: 'min',
      conditions: [{ operator: 'LESS_THAN', compareType: 'field', compareToField: 'max' }],
    });
    expect(evaluateRules([r], { min: 5, max: 10 }).hiddenFields).toContain('salary');
    expect(evaluateRules([r], { min: 15, max: 10 }).hiddenFields).toHaveLength(0);
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
