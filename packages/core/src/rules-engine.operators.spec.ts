import type { RuleCondition, RuleOperator } from './form-model.types';
import { evaluateCondition } from './rules-engine';

/**
 * Exhaustive operator table. Every `RuleOperator` must appear here — the completeness test
 * at the bottom fails if a new operator is added to the model without cases landing here.
 */
type Case = {
  /** Condition value (the right-hand side), omitted for unary operators. */
  compare?: unknown;
  /** Actual field value (the left-hand side). */
  actual: unknown;
  expected: boolean;
  why: string;
};

const CASES: Record<RuleOperator, Case[]> = {
  EQUAL: [
    { compare: 'active', actual: 'active', expected: true, why: 'identical strings' },
    { compare: 'active', actual: 'inactive', expected: false, why: 'different strings' },
    { compare: '5', actual: 5, expected: true, why: 'coerces across types' },
    { compare: null, actual: undefined, expected: true, why: 'both nullish stringify equal' },
  ],
  NOT_EQUAL: [
    { compare: 'active', actual: 'inactive', expected: true, why: 'different strings' },
    { compare: 'active', actual: 'active', expected: false, why: 'identical strings' },
    { compare: '5', actual: 5, expected: false, why: 'coerced equal is not "not equal"' },
  ],
  CONTAINS: [
    { compare: 'corp', actual: 'acme corp', expected: true, why: 'substring' },
    { compare: 'xyz', actual: 'acme corp', expected: false, why: 'absent substring' },
    { compare: 'b', actual: ['a', 'b'], expected: true, why: 'array membership' },
    { compare: 'z', actual: ['a', 'b'], expected: false, why: 'absent array member' },
    { compare: 'a', actual: 42, expected: false, why: 'non string/array actual' },
  ],
  NOT_CONTAINS: [
    { compare: 'xyz', actual: 'acme corp', expected: true, why: 'absent substring' },
    { compare: 'corp', actual: 'acme corp', expected: false, why: 'present substring' },
    { compare: 'z', actual: ['a'], expected: true, why: 'absent array member' },
    { compare: 'a', actual: 42, expected: true, why: 'non string/array actual is vacuously true' },
  ],
  STARTS_WITH: [
    { compare: 'acme', actual: 'acme corp', expected: true, why: 'prefix' },
    { compare: 'corp', actual: 'acme corp', expected: false, why: 'not a prefix' },
    { compare: 'a', actual: 42, expected: false, why: 'non-string actual' },
  ],
  ENDS_WITH: [
    { compare: 'corp', actual: 'acme corp', expected: true, why: 'suffix' },
    { compare: 'acme', actual: 'acme corp', expected: false, why: 'not a suffix' },
    { compare: 'a', actual: null, expected: false, why: 'null actual' },
  ],
  IS_EMPTY: [
    { actual: '', expected: true, why: 'empty string' },
    { actual: null, expected: true, why: 'null' },
    { actual: undefined, expected: true, why: 'undefined' },
    { actual: [], expected: true, why: 'empty array' },
    { actual: 'x', expected: false, why: 'non-empty string' },
    { actual: 0, expected: false, why: 'zero is a value, not emptiness' },
    { actual: false, expected: false, why: 'false is a value, not emptiness' },
  ],
  IS_NOT_EMPTY: [
    { actual: 'x', expected: true, why: 'non-empty string' },
    { actual: [1], expected: true, why: 'non-empty array' },
    { actual: 0, expected: true, why: 'zero is a value' },
    { actual: '', expected: false, why: 'empty string' },
    { actual: null, expected: false, why: 'null' },
    { actual: [], expected: false, why: 'empty array' },
  ],
  LESS_THAN: [
    { compare: 10, actual: 5, expected: true, why: 'below bound' },
    { compare: 10, actual: 10, expected: false, why: 'equal is not less' },
    { compare: 10, actual: 15, expected: false, why: 'above bound' },
    { compare: '10', actual: '5', expected: true, why: 'numeric strings compare numerically' },
  ],
  MORE_THAN: [
    { compare: 10, actual: 15, expected: true, why: 'above bound' },
    { compare: 10, actual: 10, expected: false, why: 'equal is not more' },
    { compare: 10, actual: 5, expected: false, why: 'below bound' },
  ],
  LESS_THAN_EQUAL: [
    { compare: 10, actual: 10, expected: true, why: 'equal is inclusive' },
    { compare: 10, actual: 9, expected: true, why: 'below bound' },
    { compare: 10, actual: 11, expected: false, why: 'above bound' },
  ],
  MORE_THAN_EQUAL: [
    { compare: 10, actual: 10, expected: true, why: 'equal is inclusive' },
    { compare: 10, actual: 11, expected: true, why: 'above bound' },
    { compare: 10, actual: 9, expected: false, why: 'below bound' },
  ],
  DATE_BEFORE: [
    { compare: '2024-06-01', actual: '2024-01-01', expected: true, why: 'earlier date' },
    { compare: '2024-01-01', actual: '2024-06-01', expected: false, why: 'later date' },
    { compare: '2024-01-01', actual: '2024-01-01', expected: false, why: 'same date is not before' },
    { compare: '2024-01-01', actual: 'not-a-date', expected: false, why: 'unparseable actual' },
  ],
  DATE_AFTER: [
    { compare: '2024-01-01', actual: '2024-06-01', expected: true, why: 'later date' },
    { compare: '2024-06-01', actual: '2024-01-01', expected: false, why: 'earlier date' },
    { compare: 'nope', actual: '2024-01-01', expected: false, why: 'unparseable compare' },
  ],
  IN: [
    { compare: ['a', 'b'], actual: 'a', expected: true, why: 'member of list' },
    { compare: ['a', 'b'], actual: 'z', expected: false, why: 'not a member' },
    { compare: 'not-an-array', actual: 'a', expected: false, why: 'compare must be an array' },
  ],
  NOT_IN: [
    { compare: ['a', 'b'], actual: 'z', expected: true, why: 'not a member' },
    { compare: ['a', 'b'], actual: 'a', expected: false, why: 'member of list' },
    { compare: 'not-an-array', actual: 'a', expected: false, why: 'compare must be an array' },
  ],
  HAS_ITEMS: [
    { actual: [1], expected: true, why: 'non-empty array' },
    { actual: [], expected: false, why: 'empty array' },
    { actual: 'abc', expected: false, why: 'a string is not an array' },
    { actual: null, expected: false, why: 'null' },
  ],
  VALUE_CHANGED: [], // baseline-dependent — covered separately below
};

describe('evaluateCondition — operator table', () => {
  for (const [operator, cases] of Object.entries(CASES) as [RuleOperator, Case[]][]) {
    if (cases.length === 0) continue;

    describe(operator, () => {
      for (const { compare, actual, expected, why } of cases) {
        it(`${expected ? 'matches' : 'does not match'}: ${why}`, () => {
          const condition: RuleCondition = { operator, compareType: 'value', value: compare };
          expect(evaluateCondition(condition, actual, {})).toBe(expected);
        });
      }
    });
  }

  describe('VALUE_CHANGED', () => {
    const condition: RuleCondition = { operator: 'VALUE_CHANGED', compareType: 'value' };

    it('matches when the value differs from the baseline', () => {
      expect(evaluateCondition(condition, 'new', {}, 'old')).toBe(true);
    });

    it('does not match when the value equals the baseline', () => {
      expect(evaluateCondition(condition, 'same', {}, 'same')).toBe(false);
    });

    it('does not match when there is no baseline to compare against', () => {
      expect(evaluateCondition(condition, 'anything', {})).toBe(false);
    });

    it('treats a null baseline as a real baseline', () => {
      expect(evaluateCondition(condition, 'x', {}, null)).toBe(true);
    });
  });

  describe('field-to-field comparison', () => {
    it('reads the right-hand side from another field', () => {
      const condition: RuleCondition = {
        operator: 'EQUAL',
        compareType: 'field',
        compareToField: 'confirmEmail',
      };
      expect(evaluateCondition(condition, 'a@b.com', { confirmEmail: 'a@b.com' })).toBe(true);
      expect(evaluateCondition(condition, 'a@b.com', { confirmEmail: 'other@b.com' })).toBe(false);
    });

    it('falls back to the literal value when compareToField is missing', () => {
      const condition: RuleCondition = { operator: 'EQUAL', compareType: 'field', value: 'lit' };
      expect(evaluateCondition(condition, 'lit', {})).toBe(true);
    });
  });

  it('returns false for an unrecognised operator', () => {
    const condition = { operator: 'NOPE', compareType: 'value' } as unknown as RuleCondition;
    expect(evaluateCondition(condition, 'x', {})).toBe(false);
  });

  it('covers every operator declared by the model', () => {
    // Mirrors RuleOperator. Update both together — that is the point of this test.
    const declared: RuleOperator[] = [
      'EQUAL', 'NOT_EQUAL', 'CONTAINS', 'NOT_CONTAINS', 'STARTS_WITH', 'ENDS_WITH',
      'IS_EMPTY', 'IS_NOT_EMPTY', 'LESS_THAN', 'MORE_THAN', 'LESS_THAN_EQUAL',
      'MORE_THAN_EQUAL', 'DATE_BEFORE', 'DATE_AFTER', 'IN', 'NOT_IN', 'HAS_ITEMS',
      'VALUE_CHANGED',
    ];

    expect(Object.keys(CASES).sort()).toEqual([...declared].sort());
  });
});
