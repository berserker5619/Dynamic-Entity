/**
 * `valuesEqual` — the comparator rule operators use, and the line between it and
 * `valuesMatch`.
 *
 * The two are asked different questions. Every case below that differs between them is
 * asserted against both, so the split cannot quietly collapse back into one function.
 */
import { OPTION_KEY, languageEntries, optionKeyOf, valuesEqual, valuesMatch } from './form-logic';

describe('scalars never coerce', () => {
  // Pairs `valuesMatch` equates because it ends in `String(a) === String(b)`. Each of these
  // is a rule that used to fire on a value the author did not write.
  const stringifyAlike: [unknown, unknown, string][] = [
    [0, '0', 'zero and its text'],
    [5, '5', 'a number and its text'],
    [false, 'false', 'a boolean and its text'],
    [true, 'true', 'true and its text'],
  ];

  for (const [a, b, why] of stringifyAlike) {
    it(`does not equate ${why}`, () => {
      expect(valuesEqual(a, b)).toBe(false);
      expect(valuesEqual(b, a)).toBe(false);
      // The lenient comparator does, which is the whole reason for the split.
      expect(valuesMatch(a, b)).toBe(true);
    });
  }

  const alsoUnequal: [unknown, unknown, string][] = [
    [true, 1, 'true and one'],
    [0, false, 'zero and false'],
    ['', 0, 'empty text and zero'],
  ];

  for (const [a, b, why] of alsoUnequal) {
    it(`does not equate ${why}`, () => {
      expect(valuesEqual(a, b)).toBe(false);
      expect(valuesEqual(b, a)).toBe(false);
    });
  }

  it('still equates identical scalars', () => {
    expect(valuesEqual('active', 'active')).toBe(true);
    expect(valuesEqual(5, 5)).toBe(true);
    expect(valuesEqual(false, false)).toBe(true);
  });
});

describe('absence', () => {
  it('treats null and undefined as the same absence', () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual(undefined, null)).toBe(true);
  });

  it('does not treat absence as an empty value', () => {
    expect(valuesEqual(null, '')).toBe(false);
    expect(valuesEqual(undefined, 0)).toBe(false);
    expect(valuesEqual(null, {})).toBe(false);
  });
});

describe('options', () => {
  it('matches an option against the text that names it, in any language', () => {
    const option = { en: 'Active', de: 'Aktiv' };
    expect(valuesEqual(option, 'Active')).toBe(true);
    expect(valuesEqual('Aktiv', option)).toBe(true);
    expect(valuesEqual(option, 'Inactive')).toBe(false);
  });

  it('does not match an option against a non-string scalar', () => {
    expect(valuesEqual({ en: '1' }, 1)).toBe(false);
    expect(valuesEqual({ en: 'true' }, true)).toBe(false);
  });

  it('matches two options that agree on a language', () => {
    // A record saved before German was added is still the same option.
    expect(valuesEqual({ en: 'Active' }, { en: 'Active', de: 'Aktiv' })).toBe(true);
  });

  it('does not match two options spelled alike in different languages', () => {
    // `valuesMatch` does, because `resolveLabel` falls back to the first language present.
    expect(valuesEqual({ en: 'A' }, { de: 'A' })).toBe(false);
    expect(valuesMatch({ en: 'A' }, { de: 'A' })).toBe(true);
  });

  it('needs only one language to agree — the accepted cost of keyless matching', () => {
    // Two different options that happen to share their German text compare equal. This is
    // what a `$key` removes; without one there is nothing else to go on.
    expect(valuesEqual({ en: 'Active', de: 'Aktiv' }, { en: 'Inactive', de: 'Aktiv' })).toBe(true);
    expect(valuesEqual({ en: 'Active' }, { en: 'Inactive' })).toBe(false);
  });
});

describe('option keys', () => {
  it('compares on the key alone when both sides carry one', () => {
    const stored = { [OPTION_KEY]: 'active', en: 'Active' };
    const renamed = { [OPTION_KEY]: 'active', en: 'Enabled', de: 'Aktiviert' };
    expect(valuesEqual(stored, renamed)).toBe(true);
  });

  it('separates two options whose text happens to agree but whose keys do not', () => {
    const a = { [OPTION_KEY]: 'open-ticket', en: 'Open' };
    const b = { [OPTION_KEY]: 'open-account', en: 'Open' };
    expect(valuesEqual(a, b)).toBe(false);
  });

  it('falls back to text when either side lacks a key', () => {
    const keyed = { [OPTION_KEY]: 'active', en: 'Active' };
    expect(valuesEqual(keyed, { en: 'Active' })).toBe(true);
    expect(valuesEqual(keyed, 'Active')).toBe(true);
  });

  it('ignores a blank or non-string key', () => {
    expect(optionKeyOf({ [OPTION_KEY]: '', en: 'Active' })).toBeUndefined();
    expect(optionKeyOf({ [OPTION_KEY]: 7, en: 'Active' })).toBeUndefined();
    expect(optionKeyOf('Active')).toBeUndefined();
    expect(optionKeyOf(null)).toBeUndefined();
    expect(optionKeyOf([{ [OPTION_KEY]: 'x' }])).toBeUndefined();
  });

  it('keeps the key out of the languages', () => {
    expect(languageEntries({ [OPTION_KEY]: 'active', en: 'Active', de: 'Aktiv' })).toEqual([
      ['en', 'Active'],
      ['de', 'Aktiv'],
    ]);
    expect(languageEntries(null)).toEqual([]);
    expect(languageEntries('Active')).toEqual([]);
    expect(languageEntries(['Active'])).toEqual([]);
  });

  it('does not match an option against its own key as text', () => {
    expect(valuesEqual({ [OPTION_KEY]: 'active', en: 'Active' }, 'active')).toBe(false);
  });
});

describe('structures', () => {
  it('compares arrays element-wise and in order', () => {
    expect(valuesEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(valuesEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(valuesEqual(['a'], ['a', 'b'])).toBe(false);
    expect(valuesEqual(['a'], 'a')).toBe(false);
  });

  it('is indifferent to key order but not to key presence', () => {
    expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('does not coerce inside an object', () => {
    // `canonicalizeValue` projects both of these to `n:1`, which is why the comparator is
    // not built on it.
    expect(valuesEqual({ n: 1 }, { n: '1' })).toBe(false);
  });

  it('compares dates by instant', () => {
    expect(valuesEqual(new Date('2026-01-01'), new Date('2026-01-01'))).toBe(true);
    expect(valuesEqual(new Date('2026-01-01'), new Date('2026-01-02'))).toBe(false);
    expect(valuesEqual(new Date('2026-01-01'), {})).toBe(false);
  });
});
