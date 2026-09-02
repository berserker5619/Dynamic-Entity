import { DEFAULT_UI_TEXT, resolveUiText, type UiTextKey } from './ui-text.service';

/**
 * `resolveUiText` against input it was not written for.
 *
 * The key type makes most of this impossible in TypeScript, which is exactly why it is worth
 * testing: the values arrive from a translation catalogue, a JSON file, or a host written in
 * JavaScript, and none of those are type-checked at the boundary. The rule the whole feature
 * rests on is that a label always resolves to a string — a template renders whatever this
 * returns, so a function or an object reaches the screen.
 *
 * This is the same class of hardening core took in 1.8.1, applied to the other end.
 */
describe('resolveUiText survives input the type system rules out', () => {
  const defaults = DEFAULT_UI_TEXT as Readonly<Record<string, string>>;
  const resolve = (overrides: unknown, key: string, language = 'en', params?: unknown) =>
    resolveUiText(overrides as never, defaults, key as UiTextKey, language, params as never);

  describe('keys that are not keys', () => {
    // Every one of these answers on the prototype chain: `{}.toString` is a function,
    // `{}.__proto__` is an object. Both used to come straight back out.
    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      it(`returns a string for '${key}'`, () => {
        const value = resolve(undefined, key);
        expect(typeof value).toBe('string');
        expect(value).toBe('');
      });

      it(`does not read '${key}' off an override map either`, () => {
        expect(resolve({}, key)).toBe('');
      });
    }

    it('returns a string for a key nobody published', () => {
      expect(resolve(undefined, 'noSuchKey')).toBe('');
    });

    it('still honours an override for an unpublished key, since the host meant it', () => {
      expect(resolve({ noSuchKey: 'Something' }, 'noSuchKey')).toBe('Something');
    });
  });

  describe('override values that are not text', () => {
    const junk: [string, unknown][] = [
      ['a number', 42],
      ['null', null],
      ['an empty object', {}],
      ['a boolean', true],
      ['a nested map', { save: { deeper: 'no' } }],
    ];

    for (const [what, value] of junk) {
      it(`falls back to English when the value is ${what}`, () => {
        expect(resolve({ save: value }, 'save')).toBe('Save');
      });
    }

    it('resolves an array by the same rule a config label uses, not by rejecting it', () => {
      // `resolveLabel` answers with the first non-empty value it can find when neither the
      // language nor `en` is present, and an array's values are its elements. Special-casing
      // that here would make an override resolve by a different rule from the field label
      // beside it, which is the one property this whole design rests on.
      expect(resolve({ save: ['Speichern', 'x'] }, 'save', 'de')).toBe('Speichern');
    });

    it('takes a LocalizedText whose entry for the language is empty as absent', () => {
      expect(resolve({ save: { de: '' } }, 'save', 'de')).toBe('Save');
    });
  });

  describe('resolvers that misbehave', () => {
    it('falls back when a resolver throws, rather than failing the render', () => {
      // Thrown from a template expression this takes the whole form down, not one label.
      const boom = () => {
        throw new Error('catalogue not loaded');
      };
      expect(resolve(boom, 'save')).toBe('Save');
    });

    it('falls back when a resolver returns something that is not a string', () => {
      expect(resolve(() => 42 as unknown as string, 'save')).toBe('Save');
      expect(resolve(() => undefined as unknown as string, 'save')).toBe('Save');
      expect(resolve(() => null as unknown as string, 'save')).toBe('Save');
    });

    it('hands the resolver the English default, so a catalogue can use it as the source', () => {
      const seen: string[] = [];
      resolve((_k: string, defaultText: string) => {
        seen.push(defaultText);
        return defaultText;
      }, 'noRows');
      expect(seen).toEqual(['No rows yet.']);
    });

    it('gives a resolver an empty default for a key with no published English', () => {
      const seen: string[] = [];
      resolve((_k: string, defaultText: string) => {
        seen.push(defaultText);
        return 'x';
      }, 'toString');
      expect(seen).toEqual(['']);
    });
  });

  describe('parameters', () => {
    it('ignores an inherited name rather than substituting a function body', () => {
      const text = resolve({ save: 'Value: {toString}' }, 'save', 'en', {});
      expect(text).toBe('Value: {toString}');
    });

    it('substitutes a number', () => {
      expect(resolve({ save: 'Item #{n}' }, 'save', 'en', { n: 3 })).toBe('Item #3');
    });

    it('leaves a null or undefined param as the written placeholder', () => {
      expect(resolve({ save: '{a}/{b}' }, 'save', 'en', { a: null, b: undefined })).toBe('{a}/{b}');
    });

    it('fills a placeholder used more than once', () => {
      expect(resolve({ save: '{x} and {x}' }, 'save', 'en', { x: 'A' })).toBe('A and A');
    });

    it('does not interpolate what a param itself contains', () => {
      // Otherwise a translated value carrying braces becomes a second substitution pass, and
      // a value that names another param leaks it into a sentence it was not written for.
      expect(resolve({ save: '{a}' }, 'save', 'en', { a: '{b}', b: 'leaked' })).toBe('{b}');
    });

    it('leaves unbalanced braces alone', () => {
      expect(resolve({ save: '{ {a} }' }, 'save', 'en', { a: 'x' })).toBe('{ x }');
      expect(resolve({ save: '{unclosed' }, 'save', 'en', { unclosed: 'x' })).toBe('{unclosed');
    });
  });

  it('always returns a string, whatever the combination', () => {
    const overrides = [undefined, null, {}, { save: 42 }, () => '', () => undefined, 'nonsense'];
    const keys = ['save', 'toString', 'noSuchKey', '', '__proto__'];
    const languages = ['en', 'de', '', 'zz'];

    for (const o of overrides) {
      for (const k of keys) {
        for (const l of languages) {
          expect(typeof resolve(o, k, l, { n: 1 })).toBe('string');
        }
      }
    }
  });
});
