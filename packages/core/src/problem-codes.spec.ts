/**
 * The code lists themselves (`problem-codes.ts`). Which check emits which code, and that every
 * code is emitted by something, is `problem-codes.coverage.spec.ts`.
 */
import { CONFIG_PROBLEM_CODES, PLAN_PROBLEM_CODES } from './problem-codes';

describe('problem codes', () => {
  it.each([
    ['CONFIG', CONFIG_PROBLEM_CODES],
    ['PLAN', PLAN_PROBLEM_CODES],
  ] as const)('%s codes are unique, upper snake case, and in their own namespace', (prefix, codes) => {
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(new RegExp(`^${prefix}_[A-Z]+(?:_[A-Z]+)*$`));
  });

  it('never shares a code between the two namespaces', () => {
    const config = new Set<string>(CONFIG_PROBLEM_CODES);
    expect(PLAN_PROBLEM_CODES.filter(code => config.has(code))).toEqual([]);
  });
});
