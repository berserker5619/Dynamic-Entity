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
import { validatePlan } from './validate-plan';

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

  it('matches a ref with no slot in it in any case, as exact', () => {
    // `dob` is labelled "Date of Birth", so "DOB" can only be the ref, read normalised.
    expect(suggestMapping(['DOB'], people([['dob', 'Date of Birth']])).entries).toEqual([
      expect.objectContaining({ ref: 'dob', column: 0, confidence: 'exact' }),
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

describe('suggestMapping — date order, from sample rows', () => {
  const dated: SchemaAdapter<null> = {
    id: 'events',
    adapterVersion: '0.0.0',
    targets: (): TargetSet<null> => ({
      targets: ['name', 'starts', 'ends', 'signed', 'days'].map(ref => ({
        ref,
        shapeRef: ref,
        header: ref,
        required: false,
        value: ref === 'name' ? { kind: 'string' } : ref === 'days' ? { kind: 'list', of: { kind: 'date' } } : ref === 'signed' ? { kind: 'datetime' } : { kind: 'date' },
        meta: null,
      })),
      arrays: [],
      unsupported: [],
    }),
  };
  const HEADERS = ['name', 'starts', 'ends', 'signed', 'days'];
  const orders = (sample?: unknown[][]) =>
    Object.fromEntries(suggestMapping(HEADERS, dated, { sample }).entries.map(entry => [entry.ref, entry.dateOrder]));

  it('reads day first from a first part over 12, month first from a second, year first from four digits', () => {
    expect(orders([['a', '05/09/2026', '09/05/2026', '2026/09/05 10:00', '01/02/2026'], ['b', '31/08/2026', '08/31/2026', '', '']])).toEqual({
      name: undefined,
      starts: 'DMY',
      ends: 'MDY',
      signed: 'YMD',
      days: undefined,
    });
  });

  it('reads the order from any item of a split list', () => {
    expect(orders([['a', '', '', '', '01/02/2026; 25/02/2026']])['days']).toBe('DMY');
  });

  it('sets no order when the sample shows none, or shows two', () => {
    expect(orders([['a', '05/09/2026', '13/01/2026', '', ''], ['b', '06/09/2026', '01/13/2026', '', '']])).toMatchObject({ starts: undefined, ends: undefined });
  });

  it('takes no evidence from a typed date cell, text that is not a date, or a name', () => {
    expect(orders([['31/08/2026', new Date(Date.UTC(2026, 7, 31)), 'soon', 7, null]])).toEqual({
      name: undefined,
      starts: undefined,
      ends: undefined,
      signed: undefined,
      days: undefined,
    });
  });

  it('sets none without a sample', () => {
    expect(Object.values(orders())).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(suggestMapping(HEADERS, dated).entries.every(entry => !('dateOrder' in entry))).toBe(true);
  });
});

describe('suggestMapping — one item per row, from sample rows', () => {
  const ORDERS = people(
    [['orderId', 'Order ID'], ['email', 'Email'], ['shipTo', 'shipTo']],
    [
      { id: 'items', label: 'Items', children: [['sku', 'SKU'], ['qty', 'Qty'], ['productName', 'productName']] },
      { id: 'phones', label: 'Phones', children: [['number', 'Number']] },
    ],
  );
  const HEADERS = ['Order ID', 'Email', 'Phone 1', 'Phone 2', 'SKU', 'Qty', 'Product'];
  const SAMPLE = [
    ['A1', 'a@example.com', '111', '222', 'S1', '1', 'Kurti'],
    ['A1', 'a@example.com', '111', '222', 'S2', '2', 'Dupatta'],
    ['A2', 'b@example.com', '333', '', 'S3', '1', 'Shirt'],
  ];
  const byHeader = (plan: { entries: { header?: string; ref: string }[] }) => Object.fromEntries(plan.entries.map(entry => [entry.header, entry.ref]));

  it('maps an array no header numbers to item refs, and collects it under an id column that repeats', () => {
    const plan = suggestMapping(HEADERS, ORDERS, { sample: SAMPLE });
    expect(byHeader(plan)).toEqual({
      'Order ID': 'orderId',
      Email: 'email',
      'Phone 1': 'phones.0.number',
      'Phone 2': 'phones.1.number',
      SKU: 'items.sku',
      Qty: 'items.qty',
      Product: 'items.productName',
    });
    expect(plan.group).toEqual({ key: [0], collect: ['items'], contiguous: true });
    // Read from the sheet's shape, not from a header that says so: every one is a guess.
    expect(plan.entries.filter(entry => entry.ref.startsWith('items.')).map(entry => entry.confidence)).toEqual(['guess', 'guess', 'guess']);
    expect(validatePlan(plan, ORDERS)).toEqual([]);
  });

  it('suggests exactly what it did before when given no sample: no item refs, no group', () => {
    const plan = suggestMapping(HEADERS, ORDERS);
    expect(byHeader(plan)).toEqual({ 'Order ID': 'orderId', Email: 'email', 'Phone 1': 'phones.0.number', 'Phone 2': 'phones.1.number' });
    expect(plan).not.toHaveProperty('group');
  });

  it('proposes no group when no id-like column repeats, and gives each row one item in slot 0', () => {
    const plan = suggestMapping(HEADERS, ORDERS, { sample: [SAMPLE[0], SAMPLE[2]] });
    expect(plan).not.toHaveProperty('group');
    expect(byHeader(plan)).toMatchObject({ SKU: 'items.0.sku', Qty: 'items.0.qty', Product: 'items.0.productName' });
    expect(validatePlan(plan, ORDERS)).toEqual([]);
  });

  it('takes the key only from a column outside any array, with an id-like name, whose values repeat', () => {
    // Email repeats but is not id-like; "Phone Number" is id-like and repeats but is inside an array.
    const headers = ['Email', 'Phone Number 1', 'Order ID', 'SKU'];
    const sample = [['a@example.com', '111', 'A1', 'S1'], ['a@example.com', '111', 'A1', 'S2']];
    expect(suggestMapping(headers, ORDERS, { sample }).group).toEqual({ key: [2], collect: ['items'], contiguous: true });
    expect(suggestMapping(['Email', 'Phone Number 1', 'SKU'], ORDERS, { sample: sample.map(row => [row[0], row[1], row[3]]) })).not.toHaveProperty('group');
  });

  it.each(['id', 'no', 'number', 'code', 'key', 'ref'])('reads "Order %s" as id-like', word => {
    const adapter = people([['orderId', `Order ${word}`]], [{ id: 'items', label: 'Items', children: [['sku', 'SKU']] }]);
    expect(suggestMapping([`Order ${word}`, 'SKU'], adapter, { sample: [['A1', 'S1'], ['A1', 'S2']] }).group?.key).toEqual([0]);
  });

  it('does not count blank key cells as a repeat', () => {
    const sample = [['', 'a@example.com', '', '', 'S1', '1', 'Kurti'], ['', 'b@example.com', '', '', 'S2', '2', 'Shirt'], ['A3', '', '', '', 'S3', '1', 'Tee']];
    expect(suggestMapping(HEADERS, ORDERS, { sample })).not.toHaveProperty('group');
  });

  it('leaves an array out of the group when the sheet has no column for it', () => {
    const plan = suggestMapping(['Order ID', 'Email'], ORDERS, { sample: [['A1', 'a@example.com'], ['A1', 'a@example.com']] });
    expect(plan).not.toHaveProperty('group');
    expect(byHeader(plan)).toEqual({ 'Order ID': 'orderId', Email: 'email' });
  });

  it('reads the generated heading, the item ref, and the array name before a child', () => {
    const headers = ['Order ID', 'Items / SKU', 'items.qty', 'Item Product Name'];
    const plan = suggestMapping(headers, ORDERS, { sample: [['A1', 'S1', '1', 'Kurti'], ['A1', 'S2', '2', 'Shirt']] });
    expect(byHeader(plan)).toEqual({ 'Order ID': 'orderId', 'Items / SKU': 'items.sku', 'items.qty': 'items.qty', 'Item Product Name': 'items.productName' });
    expect(plan.group?.collect).toEqual(['items']);
  });

  it('matches a leftover header by its words, only when one target and one header fit each other', () => {
    // "To Ship" has the words of shipTo, in another order. "Product" has one of productName's two.
    const one = suggestMapping(['Order ID', 'To Ship', 'Product'], ORDERS, { sample: [['A1', 'Home', 'Kurti'], ['A1', 'Home', 'Shirt']] });
    expect(byHeader(one)).toEqual({ 'Order ID': 'orderId', 'To Ship': 'shipTo', Product: 'items.productName' });
    expect(one.entries.find(entry => entry.header === 'To Ship')?.confidence).toBe('guess');
    // Two headers that both fit productName: neither is taken.
    const two = suggestMapping(['Order ID', 'Product', 'Name'], ORDERS, { sample: [['A1', 'Kurti', 'x'], ['A1', 'Shirt', 'y']] });
    expect(byHeader(two)).toEqual({ 'Order ID': 'orderId' });
  });

  it('never matches a numbered slot by words: a slot needs its number', () => {
    const adapter = people([['orderId', 'Order ID']], [{ id: 'phones', label: 'Phones', children: [['mobileNumber', 'mobileNumber']] }]);
    // "Phones 1 …" numbers the array, so it stays numbered columns; "Mobile" names no slot.
    const plan = suggestMapping(['Order ID', 'Phones 1 Mobile Number', 'Mobile'], adapter, { sample: [['A1', '111', '222'], ['A1', '111', '222']] });
    expect(byHeader(plan)).toEqual({ 'Order ID': 'orderId', 'Phones 1 Mobile Number': 'phones.0.mobileNumber' });
    expect(plan).not.toHaveProperty('group');
  });

  it('infers the date order of an item column too', () => {
    const adapter: SchemaAdapter<null> = {
      ...ORDERS,
      targets: options => {
        const set = ORDERS.targets(options);
        return { ...set, targets: set.targets.map(t => (t.shapeRef === 'items.qty' ? { ...t, value: { kind: 'date' } } : t)) };
      },
    };
    const plan = suggestMapping(['Order ID', 'Qty'], adapter, { sample: [['A1', '31/08/2026'], ['A1', '01/09/2026']] });
    expect(plan.entries.find(entry => entry.ref === 'items.qty')).toMatchObject({ dateOrder: 'DMY', confidence: 'guess' });
  });
});
