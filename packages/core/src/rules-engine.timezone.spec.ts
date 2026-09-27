import { evaluateCondition } from './rules-engine';
import type { RuleCondition } from './form-model.types';

/**
 * Run by `scripts/check-timezones.mjs` once per zone — `TZ` has to be set before the process
 * starts, so these assertions only mean something under that script.
 *
 * A date field stores `YYYY-MM-DD` and a datetime field `YYYY-MM-DDTHH:mm`. `new Date()`
 * reads the first as UTC midnight and the second as local time, so comparing the two gave a
 * different answer on either side of Greenwich.
 */
const when = (operator: RuleCondition['operator'], value: unknown): RuleCondition => ({
  operator,
  value,
  compareType: 'value',
});

describe(`date operators in ${process.env.TZ ?? 'the host zone'}`, () => {
  it('reads a bare date as local midnight against a local datetime', () => {
    expect(evaluateCondition(when('DATE_BEFORE', '2024-01-01T02:00'), '2024-01-01', {})).toBe(true);
    expect(evaluateCondition(when('DATE_AFTER', '2023-12-31T23:00'), '2024-01-01', {})).toBe(true);
  });

  it('treats the same calendar day as neither before nor after itself', () => {
    expect(evaluateCondition(when('DATE_BEFORE', '2024-01-01T00:00'), '2024-01-01', {})).toBe(false);
    expect(evaluateCondition(when('DATE_AFTER', '2024-01-01T00:00'), '2024-01-01', {})).toBe(false);
  });
});
