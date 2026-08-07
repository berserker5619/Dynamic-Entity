import { evaluateCondition, evaluateFormRules } from './rules-engine';
import type { FormRule } from './form-model.types';

describe('rules-engine', () => {
  describe('evaluateCondition', () => {
    it('evaluates EQUAL and NOT_EQUAL', () => {
      expect(evaluateCondition({ operator: 'EQUAL', compareType: 'value', value: 'active' }, 'active', {})).toBe(true);
      expect(evaluateCondition({ operator: 'EQUAL', compareType: 'value', value: 'active' }, 'inactive', {})).toBe(false);
      expect(evaluateCondition({ operator: 'NOT_EQUAL', compareType: 'value', value: 'active' }, 'inactive', {})).toBe(true);
    });

    it('evaluates CONTAINS, STARTS_WITH, ENDS_WITH', () => {
      expect(evaluateCondition({ operator: 'CONTAINS', compareType: 'value', value: 'corp' }, 'acme corp', {})).toBe(true);
      expect(evaluateCondition({ operator: 'STARTS_WITH', compareType: 'value', value: 'acme' }, 'acme corp', {})).toBe(true);
      expect(evaluateCondition({ operator: 'ENDS_WITH', compareType: 'value', value: 'corp' }, 'acme corp', {})).toBe(true);
    });

    it('evaluates IS_EMPTY and IS_NOT_EMPTY', () => {
      expect(evaluateCondition({ operator: 'IS_EMPTY', compareType: 'value' }, '', {})).toBe(true);
      expect(evaluateCondition({ operator: 'IS_EMPTY', compareType: 'value' }, null, {})).toBe(true);
      expect(evaluateCondition({ operator: 'IS_NOT_EMPTY', compareType: 'value' }, 'hello', {})).toBe(true);
    });

    it('evaluates numeric comparisons (LESS_THAN, MORE_THAN)', () => {
      expect(evaluateCondition({ operator: 'MORE_THAN', compareType: 'value', value: 100 }, 150, {})).toBe(true);
      expect(evaluateCondition({ operator: 'LESS_THAN', compareType: 'value', value: 100 }, 50, {})).toBe(true);
    });

    it('evaluates field-to-field comparison', () => {
      const values = { salary: 120000, targetSalary: 100000 };
      expect(
        evaluateCondition(
          { operator: 'MORE_THAN', compareType: 'field', compareToField: 'targetSalary' },
          values.salary,
          values,
        ),
      ).toBe(true);
    });

    it('evaluates VALUE_CHANGED against originalValue baseline', () => {
      expect(
        evaluateCondition({ operator: 'VALUE_CHANGED', compareType: 'value' }, 'newValue', {}, 'oldValue'),
      ).toBe(true);
      expect(
        evaluateCondition({ operator: 'VALUE_CHANGED', compareType: 'value' }, 'oldValue', {}, 'oldValue'),
      ).toBe(false);
    });
  });

  describe('evaluateFormRules', () => {
    it('accumulates hidden fields and validation errors when conditions match', () => {
      const rules: FormRule[] = [
        {
          formConfigId: 'cfg-1',
          fieldId: 'isEmployed',
          enabled: true,
          priority: 1,
          conditions: [{ operator: 'EQUAL', compareType: 'value', value: false }],
          action: { type: 'visibility', value: false },
          targets: [{ id: 'companyName', type: 'field' }],
        },
        {
          formConfigId: 'cfg-1',
          fieldId: 'age',
          enabled: true,
          priority: 2,
          conditions: [{ operator: 'LESS_THAN', compareType: 'value', value: 18 }],
          action: { type: 'validation', value: 'Must be 18 or older', severity: 'error' },
          targets: [{ id: 'age', type: 'field' }],
        },
      ];

      const res = evaluateFormRules(rules, { isEmployed: false, age: 16 });
      expect(res.hiddenFields).toContain('companyName');
      expect(res.validationErrors['age']).toBe('Must be 18 or older');
    });
  });
});
