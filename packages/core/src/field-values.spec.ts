import {
  isValidPhone,
  isValidUrl,
  normalizeHexColor,
  normalizeTags,
  ratingScale,
  sliderBounds,
} from './field-values';
import { coerceCell, validateImportedRecord } from './import-engine';
import { deriveImportColumns } from './import-columns';
import { formatDisplayValue } from './form-logic';
import { validateConfig } from './validate-config';
import { createFieldConfig, getFieldTypeMeta } from './field-catalog';
import type { EntityFormConfig, NestedFieldConfig } from './form-model.types';

const field = (type: NestedFieldConfig['type'], extra: Partial<NestedFieldConfig> = {}): NestedFieldConfig => ({
  id: 'f',
  type,
  label: { en: 'F' },
  ...extra,
});

const configWith = (f: NestedFieldConfig): EntityFormConfig => ({
  entity: 'x',
  tabs: [{ id: 'tab', label: { en: 'Tab' }, fields: [f] }],
});

describe('isValidUrl', () => {
  it.each(['https://example.com', 'http://localhost:4200/path?q=1#x', 'https://sub.example.co.uk/a'])(
    'accepts %s',
    url => expect(isValidUrl(url)).toBe(true),
  );

  it.each([
    ['no scheme', 'example.com'],
    ['a script link', 'javascript:alert(1)'],
    ['another scheme', 'ftp://example.com'],
    ['no host', 'http://'],
    ['whitespace', 'https://exa mple.com'],
    ['empty', ''],
  ])('refuses %s', (_why, url) => expect(isValidUrl(url)).toBe(false));
});

describe('isValidPhone', () => {
  it.each(['+1 (555) 555-0123', '020 7946 0958', '+44.20.7946.0958', '5550123'])('accepts %s', phone =>
    expect(isValidPhone(phone)).toBe(true),
  );

  it.each([
    ['too few digits', '12345'],
    ['more than E.164 allows', '+1234567890123456'],
    ['letters', '555-CALL-NOW'],
    ['a plus in the middle', '555+0123456'],
    ['empty', ''],
  ])('refuses %s', (_why, phone) => expect(isValidPhone(phone)).toBe(false));
});

describe('normalizeHexColor', () => {
  it('returns the form a colour input produces', () => {
    expect(normalizeHexColor('#336699')).toBe('#336699');
    expect(normalizeHexColor('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHexColor('abc')).toBe('#aabbcc');
    expect(normalizeHexColor('  #FfF ')).toBe('#ffffff');
  });

  it.each(['red', '#12345', '#1234567', '', 42, null])('refuses %p', value =>
    expect(normalizeHexColor(value)).toBeNull(),
  );
});

describe('normalizeTags', () => {
  it('trims, drops blanks and keeps the first of each duplicate', () => {
    expect(normalizeTags([' a ', '', 'b', 'a', 3])).toEqual(['a', 'b', '3']);
  });

  it('keeps a lone string as one tag, so a field retyped from text loses nothing', () => {
    expect(normalizeTags('legacy')).toEqual(['legacy']);
  });

  it('reads anything else as no tags', () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags({ en: 'x' })).toEqual([]);
    expect(normalizeTags([{ en: 'x' }])).toEqual([]);
  });
});

describe('ratingScale', () => {
  it('defaults to five stars', () => expect(ratingScale(field('rating'))).toBe(5));
  it('reads validators.max', () => expect(ratingScale(field('rating', { validators: { max: 3 } }))).toBe(3));
  it('clamps to 1..10', () => {
    expect(ratingScale(field('rating', { validators: { max: 50 } }))).toBe(10);
    expect(ratingScale(field('rating', { validators: { max: 0 } }))).toBe(1);
  });
});

describe('sliderBounds', () => {
  it('defaults to 0..100 in steps of 1', () => {
    expect(sliderBounds(field('slider'))).toEqual({ min: 0, max: 100, step: 1 });
  });

  it('reads min, max and step', () => {
    expect(sliderBounds(field('slider', { validators: { min: -5, max: 5 }, step: 0.5 }))).toEqual({
      min: -5,
      max: 5,
      step: 0.5,
    });
  });

  it('falls back when the range is inverted or the step is not positive', () => {
    expect(sliderBounds(field('slider', { validators: { min: 10, max: 1 }, step: 0 }))).toEqual({
      min: 0,
      max: 100,
      step: 1,
    });
  });
});

describe('coerceCell for the newer field types', () => {
  it('reads a slider value on its track, from text or a number cell', () => {
    const slider = field('slider', { validators: { min: 0, max: 10 } });
    expect(coerceCell(slider, '7.5')).toEqual({ value: 7.5 });
    expect(coerceCell(slider, 4)).toEqual({ value: 4 });
    expect(coerceCell(slider, '11')).toEqual({ error: '"11" is outside 0 to 10' });
    expect(coerceCell(slider, 'lots')).toEqual({ error: '"lots" is not a number' });
  });

  it('reads a rating as a whole number of stars on its scale', () => {
    const rating = field('rating');
    expect(coerceCell(rating, '4')).toEqual({ value: 4 });
    expect(coerceCell(rating, 5)).toEqual({ value: 5 });
    expect(coerceCell(rating, '6')).toEqual({ error: '"6" is not a whole number from 1 to 5' });
    expect(coerceCell(rating, '2.5')).toEqual({ error: '"2.5" is not a whole number from 1 to 5' });
    expect(coerceCell(rating, '0')).toEqual({ error: '"0" is not a whole number from 1 to 5' });
  });

  it('normalises a colour, and names the format when it cannot', () => {
    expect(coerceCell(field('color'), 'ABC')).toEqual({ value: '#aabbcc' });
    expect(coerceCell(field('color'), 'teal')).toEqual({ error: '"teal" is not a colour (#RRGGBB)' });
  });

  it('splits tags on semicolons, the same separator a multiSelect uses', () => {
    expect(coerceCell(field('tags'), 'red; blue ;red;;')).toEqual({ value: ['red', 'blue'] });
    expect(coerceCell(field('tags'), ' ; ')).toEqual({ value: undefined });
  });

  it('keeps url and phone as text; their format is a validator, as on the form', () => {
    expect(coerceCell(field('url'), ' https://example.com ')).toEqual({ value: 'https://example.com' });
    // An xlsx holds a phone number typed without a plus as a number cell.
    expect(coerceCell(field('phone'), 15555550123)).toEqual({ value: '15555550123' });
  });
});

describe('validateImportedRecord applies the new flag validators the form applies', () => {
  const messages = (f: NestedFieldConfig, value: unknown) =>
    validateImportedRecord({ tab: { f: value } }, configWith(f)).map(p => p.message);

  it('refuses a malformed url only when the flag is on', () => {
    expect(messages(field('url', { validators: { url: true } }), 'example.com')).toEqual([
      'F is not a valid web address',
    ]);
    expect(messages(field('url', { validators: { url: true } }), 'https://example.com')).toEqual([]);
    expect(messages(field('url'), 'example.com')).toEqual([]);
  });

  it('refuses a malformed phone number only when the flag is on', () => {
    expect(messages(field('phone', { validators: { phone: true } }), '12')).toEqual([
      'F is not a valid phone number',
    ]);
    expect(messages(field('phone', { validators: { phone: true } }), '+1 555 555 0123')).toEqual([]);
  });

  it('counts tags against minLength and maxLength, as Angular counts an array', () => {
    const tags = field('tags', { validators: { minLength: 2, maxLength: 3 } });
    expect(messages(tags, ['a'])).toEqual(['F must have at least 2 items']);
    expect(messages(tags, ['a', 'b', 'c', 'd'])).toEqual(['F must have at most 3 items']);
    expect(messages(tags, ['a', 'b'])).toEqual([]);
  });

  it('treats an empty tag list as absent for required', () => {
    expect(messages(field('tags', { validators: { required: true } }), [])).toEqual(['F is required']);
  });
});

describe('import template hints for the newer types', () => {
  it('tells a person how to write each one', () => {
    const hints = Object.fromEntries(
      (['url', 'slider', 'rating', 'color', 'tags'] as const).map(type => {
        const [column] = deriveImportColumns(configWith(field(type))).columns;
        return [type, column.format];
      }),
    );
    expect(hints).toEqual({
      url: 'https://…',
      slider: 'a number',
      rating: 'a number',
      color: '#RRGGBB',
      tags: 'values separated by ;',
    });
  });
});

describe('formatDisplayValue for tags', () => {
  it('lists every tag rather than reading the array as a language map', () => {
    expect(formatDisplayValue('tags', undefined, ['red', 'blue'])).toBe('red, blue');
  });

  it('shows the empty mark for an empty list', () => {
    expect(formatDisplayValue('tags', undefined, [])).toBe('—');
  });
});

describe('the catalogue entries for the newer types', () => {
  it('offers each type its own format flag', () => {
    expect(getFieldTypeMeta('url')?.flagValidators).toContain('url');
    expect(getFieldTypeMeta('phone')?.flagValidators).toContain('phone');
  });

  it('bounds a slider and a rating with min and max', () => {
    expect(getFieldTypeMeta('slider')?.paramValidators).toEqual(['min', 'max']);
    expect(getFieldTypeMeta('rating')?.paramValidators).toEqual(['min', 'max']);
  });

  it('creates a plain field for each, with nothing type-specific to fill in', () => {
    for (const type of ['url', 'phone', 'slider', 'rating', 'color', 'tags'] as const) {
      const created = createFieldConfig(type, `${type}_1`);
      expect(created.type).toBe(type);
      expect(created.options).toBeUndefined();
    }
  });
});

describe('validateConfig for the newer types', () => {
  const errorsFor = (f: NestedFieldConfig) =>
    validateConfig(configWith(f))
      .filter(issue => issue.level === 'error')
      .map(issue => issue.path);
  const codesFor = (f: NestedFieldConfig) =>
    validateConfig(configWith(f))
      .filter(issue => issue.level === 'error')
      .map(issue => issue.code);

  it('accepts every newer type as known', () => {
    for (const type of ['url', 'phone', 'slider', 'rating', 'color', 'tags'] as const) {
      expect(errorsFor(field(type))).toEqual([]);
    }
  });

  it('requires a numeric default on a slider and a rating', () => {
    expect(errorsFor(field('slider', { defaultValue: '5' }))).toContain('tabs[0].fields[0].defaultValue');
    expect(codesFor(field('slider', { defaultValue: '5' }))).toContain('CONFIG_DEFAULT_TYPE_MISMATCH');
    expect(errorsFor(field('rating', { defaultValue: 3 }))).toEqual([]);
  });

  it('requires a colour default in the form the picker stores', () => {
    expect(errorsFor(field('color', { defaultValue: 'red' }))).toContain('tabs[0].fields[0].defaultValue');
    expect(codesFor(field('color', { defaultValue: 'red' }))).toContain('CONFIG_DEFAULT_TYPE_MISMATCH');
    expect(errorsFor(field('color', { defaultValue: '#FF0000' }))).toContain('tabs[0].fields[0].defaultValue');
    expect(errorsFor(field('color', { defaultValue: '#ff0000' }))).toEqual([]);
  });

  it('requires a tags default to be a list of strings', () => {
    expect(errorsFor(field('tags', { defaultValue: 'a' }))).toContain('tabs[0].fields[0].defaultValue');
    expect(codesFor(field('tags', { defaultValue: 'a' }))).toContain('CONFIG_DEFAULT_TYPE_MISMATCH');
    expect(errorsFor(field('tags', { defaultValue: ['a', 'b'] }))).toEqual([]);
  });

  it('refuses a step that is not a positive number', () => {
    expect(errorsFor(field('slider', { step: 0 }))).toContain('tabs[0].fields[0].step');
    expect(codesFor(field('slider', { step: 0 }))).toContain('CONFIG_INVALID_STEP');
    expect(errorsFor(field('slider', { step: 0.25 }))).toEqual([]);
  });

  it('refuses a slider whose max is not above its min', () => {
    expect(errorsFor(field('slider', { validators: { min: 10, max: 10 } }))).toContain(
      'tabs[0].fields[0].validators',
    );
    expect(codesFor(field('slider', { validators: { min: 10, max: 10 } }))).toEqual(['CONFIG_SLIDER_RANGE_EMPTY']);
  });

  it('accepts url and phone as built-in validator names', () => {
    const f = field('text', { validators: { custom: ['url', 'phone'] } });
    const issues = validateConfig(configWith(f), { knownValidators: [] }).filter(i => i.level === 'error');
    expect(issues).toEqual([]);
  });
});
