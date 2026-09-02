import { fieldDomId, nextFieldInstanceId } from './field-dom-id';

/**
 * The id scheme itself, apart from any component that uses it.
 *
 * The sweep in `dom-ids-are-unique.spec.ts` proves the components apply it. This pins what
 * they are applying: an id that names its field, never repeats, and survives being asked for
 * before the renderer has assigned anything.
 */
describe('field DOM ids', () => {
  it('never hands out the same instance token twice', () => {
    const tokens = Array.from({ length: 500 }, () => nextFieldInstanceId());
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('names the field first, so the id still reads as what it belongs to', () => {
    expect(fieldDomId({ id: 'email' }, 'de7')).toBe('email-de7');
  });

  it('appends a suffix for the second id a component needs', () => {
    expect(fieldDomId({ id: 'email' }, 'de7', '-error')).toBe('email-de7-error');
  });

  it('answers before the renderer has assigned the field', () => {
    // A template can be checked once before `setInput` lands, and an `undefined` id in an
    // attribute renders the string "undefined" — which is a valid id that two fields share.
    expect(fieldDomId(undefined, 'de7')).toBe('field-de7');
    expect(fieldDomId({}, 'de7', '-month')).toBe('field-de7-month');
  });

  it('keeps two instances of the same field apart', () => {
    const first = fieldDomId({ id: 'name' }, nextFieldInstanceId());
    const second = fieldDomId({ id: 'name' }, nextFieldInstanceId());
    expect(first).not.toBe(second);
  });
});
