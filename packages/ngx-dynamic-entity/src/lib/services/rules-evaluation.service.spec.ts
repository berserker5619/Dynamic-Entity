import { TestBed } from '@angular/core/testing';
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
import { RulesEvaluationService } from './rules-evaluation.service';

const config: EntityFormConfig = {
  entity: 'clients',
  tabs: [
    { id: 'main', label: { en: 'Main' }, fields: [{ id: 'status', type: 'text', label: { en: 'Status' } }] },
    { id: 'other', label: { en: 'Other' }, fields: [{ id: 'notes', type: 'text', label: { en: 'Notes' } }] },
  ],
};

const rule = (over: Partial<FormRule> = {}): FormRule => ({
  formConfigId: 'clients',
  fieldId: 'status',
  conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'archived' }],
  action: { type: 'visibility', value: false },
  targets: [{ id: 'notes', type: 'field' }],
  enabled: true,
  priority: 1,
  ...over,
});

describe('RulesEvaluationService', () => {
  let service: RulesEvaluationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RulesEvaluationService);
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('evaluate', () => {
    it('returns an empty result for missing rules', () => {
      for (const rules of [undefined, null, []]) {
        const result = service.evaluate(rules, {});
        expect(result.hiddenFields).toEqual([]);
        expect(result.hiddenTabs).toEqual([]);
        expect(result.infoBanners).toEqual({});
      }
    });

    it('hides a target field when the condition matches', () => {
      expect(service.evaluate([rule()], { status: 'archived' }).hiddenFields).toEqual(['notes']);
    });

    it('leaves the target visible when the condition does not match', () => {
      expect(service.evaluate([rule()], { status: 'active' }).hiddenFields).toEqual([]);
    });

    it('skips disabled rules', () => {
      expect(service.evaluate([rule({ enabled: false })], { status: 'archived' }).hiddenFields).toEqual([]);
    });

    it('hides a target tab', () => {
      const tabRule = rule({ targets: [{ id: 'other', type: 'tab' }] });
      expect(service.evaluate([tabRule], { status: 'archived' }).hiddenTabs).toEqual(['other']);
    });

    it('collects validation errors, warnings, and info banners separately', () => {
      const rules = [
        rule({ action: { type: 'validation', value: 'Bad', severity: 'error' } }),
        rule({ action: { type: 'validation', value: 'Careful', severity: 'warning' } }),
        rule({ action: { type: 'info', value: 'Heads up' } }),
      ];
      const result = service.evaluate(rules, { status: 'archived' });

      expect(result.validationErrors['notes']).toBe('Bad');
      expect(result.validationWarnings['notes']).toBe('Careful');
      expect(result.infoBanners['notes']).toBe('Heads up');
    });

    it('passes the baseline through for VALUE_CHANGED', () => {
      const changed = rule({
        conditions: [{ operator: 'VALUE_CHANGED', compareType: 'value' }],
      });

      expect(service.evaluate([changed], { status: 'b' }, { status: 'a' }).hiddenFields).toEqual(['notes']);
      expect(service.evaluate([changed], { status: 'a' }, { status: 'a' }).hiddenFields).toEqual([]);
    });
  });

  describe('filterForTab', () => {
    it('keeps rules triggered by a field on that tab', () => {
      expect(service.filterForTab([rule()], 'main', config).length).toBe(1);
    });

    it('keeps rules targeting a field on that tab', () => {
      expect(service.filterForTab([rule()], 'other', config).length).toBe(1);
    });

    it('drops rules unrelated to the tab', () => {
      const unrelated = rule({ fieldId: 'elsewhere', targets: [{ id: 'elsewhere', type: 'field' }] });
      expect(service.filterForTab([unrelated], 'main', config)).toEqual([]);
    });

    it('returns [] for an unknown tab or empty rules', () => {
      expect(service.filterForTab([rule()], 'nope', config)).toEqual([]);
      expect(service.filterForTab([], 'main', config)).toEqual([]);
      expect(service.filterForTab(undefined, 'main', config)).toEqual([]);
    });
  });
});
