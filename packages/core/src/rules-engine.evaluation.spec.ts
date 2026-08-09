import type { EntityFormConfig, FormRule } from './form-model.types';
import { evaluateFormRules, filterRulesForTab } from './rules-engine';

const config: EntityFormConfig = {
  entity: 'clients',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      fields: [
        { id: 'status', type: 'text', label: { en: 'Status' } },
        { id: 'name', type: 'text', label: { en: 'Name' } },
      ],
    },
    {
      id: 'billing',
      label: { en: 'Billing' },
      fields: [{ id: 'iban', type: 'text', label: { en: 'IBAN' } }],
      children: [
        {
          id: 'nested',
          label: { en: 'Nested' },
          fields: [{ id: 'deep', type: 'text', label: { en: 'Deep' } }],
        },
      ],
    },
  ],
};

const rule = (over: Partial<FormRule> = {}): FormRule => ({
  formConfigId: 'clients',
  fieldId: 'status',
  conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'archived' }],
  action: { type: 'visibility', value: false },
  targets: [{ id: 'iban', type: 'field' }],
  enabled: true,
  priority: 1,
  ...over,
});

describe('evaluateFormRules', () => {
  const empty = { hiddenFields: [], hiddenTabs: [], validationErrors: {}, validationWarnings: {}, infoBanners: {} };

  it('returns an empty result for missing or empty rules', () => {
    expect(evaluateFormRules(undefined, {})).toEqual(empty);
    expect(evaluateFormRules(null, {})).toEqual(empty);
    expect(evaluateFormRules([], {})).toEqual(empty);
  });

  it('requires every condition to hold (AND semantics)', () => {
    const twoConditions = rule({
      conditions: [
        { operator: 'EQUAL', compareType: 'value', value: 'archived' },
        { operator: 'IS_NOT_EMPTY', compareType: 'value' },
      ],
    });

    expect(evaluateFormRules([twoConditions], { status: 'archived' }).hiddenFields).toEqual(['iban']);
    expect(evaluateFormRules([twoConditions], { status: 'active' }).hiddenFields).toEqual([]);
  });

  it('skips disabled rules', () => {
    expect(evaluateFormRules([rule({ enabled: false })], { status: 'archived' })).toEqual(empty);
  });

  it('applies to every target of a rule', () => {
    const multi = rule({
      targets: [
        { id: 'iban', type: 'field' },
        { id: 'name', type: 'field' },
        { id: 'billing', type: 'tab' },
      ],
    });
    const result = evaluateFormRules([multi], { status: 'archived' });

    expect(result.hiddenFields).toEqual(['iban', 'name']);
    expect(result.hiddenTabs).toEqual(['billing']);
  });

  it('treats the string "false" as hide, and true as no-op', () => {
    expect(evaluateFormRules([rule({ action: { type: 'visibility', value: 'false' } })], { status: 'archived' })
      .hiddenFields).toEqual(['iban']);

    expect(evaluateFormRules([rule({ action: { type: 'visibility', value: true } })], { status: 'archived' })
      .hiddenFields).toEqual([]);
  });

  it('routes validation severity to errors or warnings', () => {
    const asError = rule({ action: { type: 'validation', value: 'Bad' } });
    const asWarning = rule({ action: { type: 'validation', value: 'Careful', severity: 'warning' } });

    expect(evaluateFormRules([asError], { status: 'archived' }).validationErrors).toEqual({ iban: 'Bad' });
    expect(evaluateFormRules([asWarning], { status: 'archived' }).validationWarnings).toEqual({ iban: 'Careful' });
  });

  it('defaults a validation message when none is supplied', () => {
    const noMessage = rule({ action: { type: 'validation' } as FormRule['action'] });
    expect(evaluateFormRules([noMessage], { status: 'archived' }).validationErrors['iban']).toBe('Validation error');
  });

  it('collects info banners', () => {
    const info = rule({ action: { type: 'info', value: 'Heads up' } });
    expect(evaluateFormRules([info], { status: 'archived' }).infoBanners).toEqual({ iban: 'Heads up' });
  });

  it('applies rules in ascending priority so the last write wins', () => {
    const low = rule({ priority: 1, action: { type: 'info', value: 'first' } });
    const high = rule({ priority: 2, action: { type: 'info', value: 'second' } });

    expect(evaluateFormRules([high, low], { status: 'archived' }).infoBanners['iban']).toBe('second');
  });

  it('treats a missing priority as 0', () => {
    const noPriority = rule({ priority: undefined as unknown as number, action: { type: 'info', value: 'first' } });
    const explicit = rule({ priority: 1, action: { type: 'info', value: 'second' } });

    expect(evaluateFormRules([explicit, noPriority], { status: 'archived' }).infoBanners['iban']).toBe('second');
  });

  it('passes the per-field baseline to VALUE_CHANGED conditions', () => {
    const changed = rule({ conditions: [{ operator: 'VALUE_CHANGED', compareType: 'value' }] });

    expect(evaluateFormRules([changed], { status: 'b' }, { status: 'a' }).hiddenFields).toEqual(['iban']);
    expect(evaluateFormRules([changed], { status: 'a' }, { status: 'a' }).hiddenFields).toEqual([]);
  });
});

describe('filterRulesForTab', () => {
  it('returns [] for missing rules or an unknown tab', () => {
    expect(filterRulesForTab(undefined, 'main', config)).toEqual([]);
    expect(filterRulesForTab([], 'main', config)).toEqual([]);
    expect(filterRulesForTab([rule()], 'nope', config)).toEqual([]);
  });

  it('keeps a rule whose trigger field lives on the tab', () => {
    expect(filterRulesForTab([rule()], 'main', config).length).toBe(1);
  });

  it('keeps a rule targeting a field on the tab', () => {
    expect(filterRulesForTab([rule()], 'billing', config).length).toBe(1);
  });

  it('keeps a rule targeting the tab itself', () => {
    const tabRule = rule({ fieldId: 'elsewhere', targets: [{ id: 'billing', type: 'tab' }] });
    expect(filterRulesForTab([tabRule], 'billing', config).length).toBe(1);
  });

  it('drops a rule unrelated to the tab', () => {
    const unrelated = rule({ fieldId: 'ghost', targets: [{ id: 'ghost', type: 'field' }] });
    expect(filterRulesForTab([unrelated], 'main', config)).toEqual([]);
  });

  it('resolves nested tabs by id', () => {
    const nested = rule({ fieldId: 'deep', targets: [{ id: 'deep', type: 'field' }] });
    expect(filterRulesForTab([nested], 'nested', config).length).toBe(1);
  });
});
