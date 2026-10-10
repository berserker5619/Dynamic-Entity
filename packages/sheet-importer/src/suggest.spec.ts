/**
 * suggestMapping, slotsFor and the header grammar (`suggest.ts`, `header-grammar.ts`).
 *
 * Ported case for case from Dynamic Entity 2.3's `core/src/array-headers.spec.ts`. The grammar
 * moved unchanged (spec §6), so it is held to the same expectations, here over a generic
 * adapter whose targets carry DE's labels as `matchKeys` and DE's generated headers.
 */
import type { ImportTarget, SchemaAdapter, TargetSet } from './adapter.types';
import { matchSlot, slotKey, slotPatterns } from './header-grammar';
import { DEFAULT_SLOTS, slotsFor, suggestMapping } from './suggest';

interface ArraySpec {
  id: string;
  label: string;
  children: [id: string, label: string][];
}

/** A flat schema: `fields` as `[id, label]`, and `arrays` unrolled to the slots asked for, DE-style. */
function people(fields: [id: string, label: string, header?: string][], arrays: ArraySpec[] = []): SchemaAdapter<null> {
  return {
    id: 'people',
    adapterVersion: '0.0.0',
    targets({ slots }): TargetSet<null> {
      const targets: ImportTarget<null>[] = fields.map(([id, label, header]) => ({
        ref: id,
        shapeRef: id,
        header: header ?? label,
        matchKeys: [label, id],
        required: false,
        value: { kind: 'string' },
        meta: null,
      }));
      for (const array of arrays) {
        for (const [childId, childLabel] of array.children) {
          for (let slot = 0; slot < (slots[array.id] ?? 0); slot++) {
            targets.push({
              ref: `${array.id}.${slot}.${childId}`,
              shapeRef: `${array.id}.${childId}`,
              header: `${array.label} / ${childLabel} ${slot + 1}`,
              matchKeys: [childLabel, childId],
              required: false,
              value: { kind: 'string' },
              arrayRef: array.id,
              arrayLabel: array.label,
              arrayIndex: slot,
              meta: null,
            });
          }
        }
      }
      return {
        targets,
        arrays: arrays.map(a => ({ ref: a.id, label: a.label, itemKind: 'object', required: false, positional: false })),
        unsupported: [],
      };
    },
  };
}

const PHONES = people([['name', 'Name']], [{ id: 'phones', label: 'Phones', children: [['number', 'Number'], ['kind', 'Type']] }]);
/** `header → ref` for every suggested entry. */
const suggest = (adapter: SchemaAdapter<null>, headers: string[]) =>
  Object.fromEntries(suggestMapping(headers, adapter).entries.map(entry => [entry.header, entry.ref]));

describe('slotPatterns', () => {
  it('spells a slot of a repeating field every way a sheet does', () => {
    const patterns = slotPatterns({ arrayLabel: 'Phones', arrayId: 'phones', childNames: ['Number', 'number'] });
    expect(patterns).toEqual(expect.arrayContaining(['phones#number', 'phone#number', 'phonenumber#', 'number#']));
    // `{array} n` only when the array has one child — otherwise `Phone 2` names nothing.
    expect(patterns).not.toContain('phone#');
    expect(slotPatterns({ arrayLabel: 'Phone', childNames: ['Number'], onlyChild: true })).toContain('phone#');
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

describe('suggestMapping', () => {
  it('returns a v2 plan for the adapter, with the headers it was made from (§4, "Writing")', () => {
    const plan = suggestMapping(['Name'], { ...PHONES, version: 4 });
    expect(plan).toEqual({
      planVersion: 2,
      target: 'people',
      schemaVersion: 4,
      sourceHeaders: ['Name'],
      entries: [{ ref: 'name', column: 0, header: 'Name', confidence: 'exact' }],
    });
    expect(suggestMapping(['Name'], PHONES)).not.toHaveProperty('schemaVersion');
  });

  it('maps "Phone 1 Number" spellings to their slot, as guesses', () => {
    expect(suggestMapping(['Phone 1 Number', 'Phone 2 Number'], PHONES).entries).toEqual([
      expect.objectContaining({ ref: 'phones.0.number', column: 0, confidence: 'guess' }),
      expect.objectContaining({ ref: 'phones.1.number', column: 1, confidence: 'guess' }),
    ]);
  });

  it('suggests slots 0–2 for Phone 1 Number, Phone 2 Number and phone_3_number (spec acceptance)', () => {
    expect(suggest(PHONES, ['Phone 1 Number', 'Phone 2 Number', 'phone_3_number'])).toEqual({
      'Phone 1 Number': 'phones.0.number',
      'Phone 2 Number': 'phones.1.number',
      phone_3_number: 'phones.2.number',
    });
  });

  it('reads underscores, run-together words and a bracketed number', () => {
    expect(suggest(PHONES, ['phone_3_number'])).toEqual({ phone_3_number: 'phones.2.number' });
    expect(suggest(PHONES, ['PhoneNumber3'])).toEqual({ PhoneNumber3: 'phones.2.number' });
    expect(suggest(PHONES, ['Number (3)'])).toEqual({ 'Number (3)': 'phones.2.number' });
  });

  it('tells two children of one slot apart', () => {
    expect(suggest(PHONES, ['Phone 1 Type', 'Phone 1 Number'])).toEqual({
      'Phone 1 Type': 'phones.0.kind',
      'Phone 1 Number': 'phones.0.number',
    });
  });

  it('lets an exact heading win over a guess for the same target', () => {
    expect(suggestMapping(['Phone 1 Number', 'Phones / Number 1'], PHONES).entries).toContainEqual(
      expect.objectContaining({ ref: 'phones.0.number', column: 1, confidence: 'exact' }),
    );
  });

  it('reads "Phones 1 Number" as slot 0 when the array label is its id, not as the ref phones.1.number', () => {
    // DE 2.4.0 compares refs after normalising, so this header was claimed, as exact, for phones.1.
    expect(suggestMapping(['Phones 1 Number', 'Phones 2 Number'], PHONES).entries).toEqual([
      expect.objectContaining({ ref: 'phones.0.number', column: 0, confidence: 'guess' }),
      expect.objectContaining({ ref: 'phones.1.number', column: 1, confidence: 'guess' }),
    ]);
  });

  it('matches a header that is a ref, exactly', () => {
    expect(suggestMapping(['phones.1.kind'], PHONES).entries).toEqual([
      expect.objectContaining({ ref: 'phones.1.kind', column: 0, confidence: 'exact' }),
    ]);
  });

  it('matches neither array for a spelling both answer to', () => {
    const adapter = people([], [
      { id: 'phones', label: 'Phone', children: [['number', 'Number']] },
      { id: 'faxes', label: 'Fax', children: [['number', 'Number']] },
    ]);
    expect(suggest(adapter, ['Number 1', 'Fax 1 Number'])).toEqual({ 'Fax 1 Number': 'faxes.0.number' });
  });

  it('matches neither target for a label two targets share', () => {
    // Generated headers are qualified, as DE's are; the shared label is the loose key.
    const adapter = people([['home', 'Address', 'Home / Address'], ['work', 'Address', 'Work / Address']]);
    expect(suggest(adapter, ['Address'])).toEqual({});
  });

  it('reads a bare "Phone 2" as the only child of a one-child array', () => {
    const adapter = people([], [{ id: 'phones', label: 'Phone', children: [['number', 'Number']] }]);
    expect(suggest(adapter, ['Phone 2'])).toEqual({ 'Phone 2': 'phones.1.number' });
  });

  it('gives each header to at most one target, and each target at most one header', () => {
    expect(suggest(people([['notes', 'Notes']]), ['Notes', 'Notes'])).toEqual({ Notes: 'notes' });
    expect(suggestMapping(['Notes', 'Notes'], people([['notes', 'Notes']])).entries).toHaveLength(1);
  });

  it('sizes its targets from the headers, so every named slot is filled', () => {
    const six = ['Name', ...[1, 2, 3, 4, 5, 6].map(n => `Phone ${n} Number`)];
    expect(suggestMapping(six, PHONES).entries.map(entry => entry.ref)).toEqual([
      'name',
      ...[0, 1, 2, 3, 4, 5].map(n => `phones.${n}.number`),
    ]);
  });
});

describe('slotsFor', () => {
  const sixPhones = ['Name', ...[1, 2, 3, 4, 5, 6].map(n => `Phone ${n} Number`)];

  it('finds the highest slot any header names, by any spelling suggestion reads', () => {
    expect(slotsFor(sixPhones, PHONES)).toEqual({ phones: 6 });
    expect(slotsFor(['Name', 'phone_4_type', 'x', 'y'], PHONES)).toEqual({ phones: 4 });
    expect(slotsFor(['Phones / Number 5', 'a', 'b', 'c', 'd'], PHONES)).toEqual({ phones: 5 });
  });

  it('reads a ref-spelled header as its 0-based slot', () => {
    expect(slotsFor(['phones.4.number', 'a', 'b', 'c', 'd'], PHONES)).toEqual({ phones: 5 });
  });

  it('offers the default for a sheet that names no slots, and ignores numbers no sheet could reach', () => {
    expect(slotsFor(['Name'], PHONES)).toEqual({ phones: DEFAULT_SLOTS });
    expect(slotsFor(['Number 2024', 'Name'], PHONES)).toEqual({ phones: DEFAULT_SLOTS });
    expect(slotsFor(['phones.999.number'], PHONES)).toEqual({ phones: DEFAULT_SLOTS });
  });

  it('always reaches what a plan maps', () => {
    expect(slotsFor(['Name'], PHONES, { entries: [{ ref: 'phones.7.number', column: 0 }] })).toEqual({ phones: 8 });
  });

  it('bounds each array on its own: Phone 6 and Guardian 2 give { phones: 6, guardians: 3 } (spec acceptance)', () => {
    const adapter = people(
      [['name', 'Name']],
      [
        { id: 'phones', label: 'Phone', children: [['number', 'Number']] },
        { id: 'guardians', label: 'Guardian', children: [['name', 'Name'], ['relation', 'Relation']] },
      ],
    );
    expect(slotsFor(['Name', 'Phone 6', 'Guardian 2 Name'], adapter)).toEqual({ phones: 6, guardians: 3 });
  });
});
