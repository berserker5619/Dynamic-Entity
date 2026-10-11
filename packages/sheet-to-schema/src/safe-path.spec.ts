/** isUnsafePath (`safe-path.ts`): the rule readPlan applies to every ref (spec §4 rule 6). */
import { isUnsafePath } from './safe-path';

describe('isUnsafePath', () => {
  it.each(['__proto__', 'a.__proto__.b', 'constructor', 'x.prototype'])('refuses %s', path => {
    expect(isUnsafePath(path)).toBe(true);
  });

  it.each(['customer.phones.0.number', 'proto', '__proto', 'constructors', ''])('allows %p', path => {
    expect(isUnsafePath(path)).toBe(false);
  });

  // Plans are JSON, so a "path" may be anything; what is not a string names no path.
  it.each([undefined, null, 42, ['__proto__'], { __proto__: null }])('treats %p as no path at all', value => {
    expect(isUnsafePath(value)).toBe(false);
  });
});
