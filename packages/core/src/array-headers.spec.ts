import { arrayBoundFor, inferArrayBound, matchSlot, slotKey, slotPatterns } from './array-headers';
import { deriveImportColumns } from './import-columns';
import { suggestMapping } from './import-engine';
import type { EntityFormConfig, NestedFieldConfig } from './form-model.types';

const array = (id: string, label: string, children: NestedFieldConfig[]): NestedFieldConfig => ({
  id,
  type: 'array',
  label: { en: label },
  children,
});
const text = (id: string, label: string): NestedFieldConfig => ({ id, type: 'text', label: { en: label } });

const configOf = (...fields: NestedFieldConfig[]): EntityFormConfig => ({
  entity: 'people',
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields }],
});

const PHONES = configOf(
  text('name', 'Name'),
  array('phones', 'Phones', [text('number', 'Number'), text('kind', 'Type')]),
);

/** `header → ref` for every suggested entry, guesses included. */
const suggest = (config: EntityFormConfig, headers: string[], maxArrayRows = 3): Record<string, string> => {
  const { columns } = deriveImportColumns(config, { maxArrayRows });
  const plan = suggestMapping(headers, columns);
  return Object.fromEntries(plan.entries.map(entry => [entry.header, entry.ref]));
};

describe('slotPatterns', () => {
  it('spells a row of a repeating field every way a sheet does', () => {
    const patterns = slotPatterns({ arrayLabel: 'Phones', arrayId: 'phones', childLabel: 'Number', childId: 'number' });
    expect(patterns).toEqual(expect.arrayContaining(['phones#number', 'phone#number', 'phonenumber#', 'number#']));
    // `{array} n` only when the array has one child — otherwise `Phone 2` names nothing.
    expect(patterns).not.toContain('phone#');
    expect(slotPatterns({ arrayLabel: 'Phone', childLabel: 'Number', onlyChild: true })).toContain('phone#');
  });

  it('fills a slot in', () => {
    expect(slotKey('phone#number', 3)).toBe('phone3number');
  });
});

describe('matchSlot', () => {
  it('reads the slot out of any spelling that normalises to the pattern', () => {
    expect(matchSlot('Phone 12 Number', 'phone#number')).toBe(12);
    expect(matchSlot('phone_2_number', 'phone#number')).toBe(2);
    expect(matchSlot('Number (3)', 'number#')).toBe(3);
  });

  it('refuses a header that is not that pattern', () => {
    expect(matchSlot('Phone Number', 'phone#number')).toBeNull();
    expect(matchSlot('Phone 0 Number', 'phone#number')).toBeNull();
    expect(matchSlot('Phone 2 Number', 'phone#')).toBeNull();
    expect(matchSlot('Phone 2', 'phone')).toBeNull();
  });
});

describe('suggestMapping with numbered headers', () => {
  it('maps "Phone 1 Number" spellings to their slot, as guesses', () => {
    const { columns } = deriveImportColumns(PHONES);
    const plan = suggestMapping(['Phone 1 Number', 'Phone 2 Number'], columns);
    expect(plan.entries).toEqual([
      expect.objectContaining({ ref: 'phones.0.number', column: 0, confidence: 'guess' }),
      expect.objectContaining({ ref: 'phones.1.number', column: 1, confidence: 'guess' }),
    ]);
  });

  it('reads underscores, run-together words and a bracketed number', () => {
    expect(suggest(PHONES, ['phone_3_number'])).toEqual({ phone_3_number: 'phones.2.number' });
    expect(suggest(PHONES, ['PhoneNumber3'])).toEqual({ PhoneNumber3: 'phones.2.number' });
    expect(suggest(PHONES, ['Number (3)'])).toEqual({ 'Number (3)': 'phones.2.number' });
  });

  /**
   * Normalised, the ref `phones.1.number` is `phones1number`, which is also how the header
   * "Phones 1 Number" reads — and that header names the first row. When the array's label
   * equals its id, comparing refs normalised claimed every numbered header, as exact, for the
   * row after the one it names. A ref with a row in it is now matched only as written.
   */
  it('reads "Phones 1 Number" as row 0 when the array label is its id, not as the ref phones.1.number', () => {
    const { columns } = deriveImportColumns(PHONES);
    expect(suggestMapping(['Phones 1 Number', 'Phones 2 Number'], columns).entries).toEqual([
      expect.objectContaining({ ref: 'phones.0.number', column: 0, confidence: 'guess' }),
      expect.objectContaining({ ref: 'phones.1.number', column: 1, confidence: 'guess' }),
    ]);
  });

  it('still matches a header that is a ref, and a ref with no row in it in any case', () => {
    // `dob` is labelled "Date of Birth", so "DOB" can only be the ref, read normalised.
    const { columns } = deriveImportColumns(configOf(text('dob', 'Date of Birth'), PHONES.tabs[0].fields![1]));
    expect(suggestMapping(['phones.1.kind', 'DOB'], columns).entries).toEqual([
      expect.objectContaining({ ref: 'dob', column: 1, confidence: 'exact' }),
      expect.objectContaining({ ref: 'phones.1.kind', column: 0, confidence: 'exact' }),
    ]);
  });

  it('tells two children of one row apart', () => {
    expect(suggest(PHONES, ['Phone 1 Type', 'Phone 1 Number'])).toEqual({
      'Phone 1 Type': 'phones.0.kind',
      'Phone 1 Number': 'phones.0.number',
    });
  });

  it('lets an exact heading win over a guess for the same field', () => {
    const { columns } = deriveImportColumns(PHONES);
    const plan = suggestMapping(['Phone 1 Number', 'Phones / Number 1'], columns);
    expect(plan.entries).toContainEqual(
      expect.objectContaining({ ref: 'phones.0.number', column: 1, confidence: 'exact' }),
    );
  });

  it('matches neither array for a spelling both answer to', () => {
    const config = configOf(
      array('phones', 'Phone', [text('number', 'Number')]),
      array('faxes', 'Fax', [text('number', 'Number')]),
    );
    expect(suggest(config, ['Number 1', 'Fax 1 Number'])).toEqual({ 'Fax 1 Number': 'faxes.0.number' });
  });

  it('reads a bare "Phone 2" as the only child of a one-child array', () => {
    const config = configOf(array('phones', 'Phone', [text('number', 'Number')]));
    expect(suggest(config, ['Phone 2'])).toEqual({ 'Phone 2': 'phones.1.number' });
  });

  it('carries the array label and address on every unrolled column', () => {
    const column = deriveImportColumns(PHONES).columns.find(c => c.ref === 'phones.1.kind');
    expect(column).toMatchObject({ arrayRef: 'phones', arrayLabel: 'Phones', arrayIndex: 1 });
  });
});

describe('inferArrayBound', () => {
  const sixPhones = ['Name', ...[1, 2, 3, 4, 5, 6].map(n => `Phone ${n} Number`)];

  it('finds the highest row any header names, by any spelling suggestion reads', () => {
    expect(inferArrayBound(sixPhones, PHONES)).toBe(6);
    expect(inferArrayBound(['Name', 'phone_4_type', 'x', 'y'], PHONES)).toBe(4);
    expect(inferArrayBound(['Phones / Number 5', 'a', 'b', 'c', 'd'], PHONES)).toBe(5);
  });

  it('reads a ref-spelled header as its 0-based row', () => {
    expect(inferArrayBound(['phones.4.number', 'a', 'b', 'c', 'd'], PHONES)).toBe(5);
  });

  it('is 1 for a sheet that names no rows, and ignores numbers no sheet could reach', () => {
    expect(inferArrayBound(['Name'], PHONES)).toBe(1);
    expect(inferArrayBound(['Number 2024', 'Name'], PHONES)).toBe(1);
    expect(inferArrayBound(['phones.999.number'], PHONES)).toBe(1);
  });

  it('never offers fewer than the default, and always reaches what a plan maps', () => {
    expect(arrayBoundFor(['Name'], PHONES)).toBe(3);
    expect(arrayBoundFor(sixPhones, PHONES)).toBe(6);
    const plan = { entity: 'people', entries: [{ ref: 'phones.7.number', column: 0 }] };
    expect(arrayBoundFor(['Name'], PHONES, plan)).toBe(8);
  });

  it('sizes the suggestion, so every named slot is filled', () => {
    const { columns } = deriveImportColumns(PHONES, { maxArrayRows: arrayBoundFor(sixPhones, PHONES) });
    const plan = suggestMapping(sixPhones, columns);
    expect(plan.entries.map(entry => entry.ref)).toEqual([
      'name',
      ...[0, 1, 2, 3, 4, 5].map(n => `phones.${n}.number`),
    ]);
  });
});
