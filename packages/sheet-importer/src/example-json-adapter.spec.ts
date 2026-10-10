/**
 * exampleJsonAdapter (`example-json-adapter.ts`), on its own and through the engine
 * (`applyMapping`, `suggestMapping`, `slotsFor`).
 */
import { applyMapping } from './apply-mapping';
import { exampleJsonAdapter } from './example-json-adapter';
import { slotsFor, suggestMapping } from './suggest';

/** The student example (spec, "Acceptance": two guardians and a split `clubs` list). */
const STUDENT = {
  studentId: 'S-001',
  name: 'Ada Lovelace',
  born: '2012-03-07',
  age: 12,
  boarder: false,
  address: { city: 'London', postcode: 'N1 9GU' },
  guardians: [
    { name: 'Anne', phone: '0123', relation: 'mother' },
    { name: 'Byron', phone: '0456' },
  ],
  clubs: ['chess', 'choir'],
};

const adapter = exampleJsonAdapter(STUDENT);
const at = (ref: string, slots: Record<string, number> = {}) => adapter.targets({ slots }).targets.find(t => t.ref === ref);

describe('exampleJsonAdapter — targets', () => {
  it('is example-json unless told otherwise, and takes its version from the options', () => {
    expect(adapter.id).toBe('example-json');
    expect(adapter.version).toBeUndefined();
    const named = exampleJsonAdapter(STUDENT, { id: 'students', version: 2 });
    expect([named.id, named.version]).toEqual(['students', 2]);
  });

  it('infers 2 guardian slots and a split clubs list from the student example', () => {
    const set = adapter.targets({ slots: {} });
    expect(set.arrays).toEqual([{ ref: 'guardians', label: 'guardians', itemKind: 'object', required: false, positional: true }]);
    expect(set.targets.filter(t => t.arrayRef === 'guardians').map(t => t.ref)).toEqual([
      'guardians.0.name',
      'guardians.0.phone',
      'guardians.0.relation',
      'guardians.1.name',
      'guardians.1.phone',
      'guardians.1.relation',
    ]);
    expect(at('clubs')?.value).toEqual({ kind: 'list', of: { kind: 'string' } });
  });

  it('infers each kind from its value', () => {
    expect(at('studentId')?.value).toEqual({ kind: 'string' });
    expect(at('born')).toMatchObject({ value: { kind: 'date' }, format: 'YYYY-MM-DD' });
    expect(at('age')?.value).toEqual({ kind: 'number' });
    expect(at('boarder')?.value).toEqual({ kind: 'boolean' });
    expect(at('address.city')).toMatchObject({ header: 'address / city', matchKeys: ['city'], meta: { sample: 'London' } });
    const times = exampleJsonAdapter({ at: '2024-03-07T09:30:00Z', opens: '09:30' }).targets({ slots: {} }).targets;
    expect(times.map(t => t.value)).toEqual([{ kind: 'datetime' }, { kind: 'time' }]);
    expect(times[1].format).toBe('HH:mm');
  });

  it('requires nothing', () => {
    expect(adapter.targets({ slots: { guardians: 2 } }).targets.every(t => !t.required)).toBe(true);
  });

  it('never offers fewer slots than the sample shows, and more when asked', () => {
    expect(at('guardians.1.name', { guardians: 1 })).toBeDefined();
    expect(at('guardians.3.name', { guardians: 4 })).toMatchObject({
      shapeRef: 'guardians.name',
      header: 'guardians / name 4',
      arrayRef: 'guardians',
      arrayLabel: 'guardians',
      arrayIndex: 3,
    });
  });

  it('merges several samples: every key, the longest array, and text where they disagree', () => {
    const merged = exampleJsonAdapter([
      { code: 7, note: null, kids: [{ name: 'a' }], tags: [1, 2] },
      { code: 'X7', note: 'hi', kids: [{ name: 'b', age: 3 }, { name: 'c' }, { name: 'd' }], tags: ['x'], extra: true },
    ]);
    const set = merged.targets({ slots: {} });
    const value = (ref: string) => set.targets.find(t => t.ref === ref)?.value;
    expect(value('code')).toEqual({ kind: 'string' });
    expect(value('note')).toEqual({ kind: 'string' });
    expect(value('tags')).toEqual({ kind: 'list', of: { kind: 'string' } });
    expect(value('extra')).toEqual({ kind: 'boolean' });
    expect(set.targets.filter(t => t.shapeRef === 'kids.name')).toHaveLength(3);
    expect(value('kids.0.age')).toEqual({ kind: 'number' });
    expect(set.unsupported).toEqual([]);
  });

  it('merges nested objects across samples', () => {
    const merged = exampleJsonAdapter([{ a: { x: 1 } }, { a: { y: true } }]);
    expect(merged.targets({ slots: {} }).targets.map(t => t.ref)).toEqual(['a.x', 'a.y']);
  });

  it('reports what a sample cannot answer, once per field, rather than guessing', () => {
    const odd = exampleJsonAdapter([
      {
        never: null,
        blank: {},
        none: [],
        nested: [[1]],
        mixed: [1, { a: 1 }],
        flips: { a: 1 },
        rows: [{ inner: [1], gone: null, empty: {} }, { inner: [2] }],
        nan: Number.NaN,
        sticky: {},
      },
      { flips: 'x', sticky: { a: 1 } },
    ]);
    const set = odd.targets({ slots: { rows: 2 } });
    const reasons = Object.fromEntries(set.unsupported.map(u => [u.ref, u.reason]));
    expect(set.unsupported.map(u => u.ref).sort()).toEqual(
      ['blank', 'flips', 'mixed', 'nan', 'nested', 'never', 'none', 'rows.empty', 'rows.gone', 'rows.inner', 'sticky'].sort(),
    );
    expect(reasons['never']).toMatch(/only ever null/);
    expect(reasons['blank']).toMatch(/empty object/);
    expect(reasons['none']).toMatch(/empty array/);
    expect(reasons['mixed']).toMatch(/mix objects/);
    expect(reasons['flips']).toMatch(/disagree/);
    expect(reasons['rows.inner']).toMatch(/list inside a list/);
    expect(reasons['nan']).toMatch(/cannot be held/);
    expect(set.arrays.map(a => a.ref)).toEqual(['rows']);
  });

  it('lets a later sample disagree with an unsupported one without hiding why', () => {
    const odd = exampleJsonAdapter([{ a: 1, b: {} }, { a: {}, b: 1 }]);
    const reasons = Object.fromEntries(odd.targets({ slots: {} }).unsupported.map(u => [u.ref, u.reason]));
    expect(reasons['a']).toMatch(/empty object/);
    expect(reasons['b']).toMatch(/empty object/);
  });

  it('refuses a sample that shows no fields', () => {
    for (const sample of [null, 'x', [], {}, [{ a: 1 }, 2], [{}]]) {
      expect(() => exampleJsonAdapter(sample)).toThrow(/at least one field/);
    }
  });

  it('is pure: the same slots give the same targets', () => {
    expect(adapter.targets({ slots: { guardians: 3 } })).toEqual(adapter.targets({ slots: { guardians: 3 } }));
  });
});

describe('exampleJsonAdapter — through the engine', () => {
  const ctx = undefined;
  const HEADERS = ['studentId', 'name', 'born', 'age', 'Guardians 1 Name', 'Guardians 1 Phone', 'Guardians 2 Name', 'Guardians 2 Phone', 'clubs'];

  it('suggests a mapping from a sheet shaped like the sample', () => {
    expect(slotsFor(HEADERS, adapter)).toEqual({ guardians: 3 });
    const plan = suggestMapping(HEADERS, adapter);
    expect(plan.target).toBe('example-json');
    expect(plan.entries.map(e => e.ref)).toEqual([
      'studentId',
      'name',
      'born',
      'age',
      'clubs',
      'guardians.0.name',
      'guardians.0.phone',
      'guardians.1.name',
      'guardians.1.phone',
    ]);
  });

  it('imports rows into records shaped like the sample', () => {
    const plan = suggestMapping(HEADERS, adapter);
    const result = applyMapping(
      [
        ['S-002', 'Mary', '2013-01-02', '11', 'Jo', '0789', '', '', 'chess; art'],
        ['S-003', 'Tom', '', 'eleven', '', '', 'Sam', '0111', ''],
      ],
      plan,
      adapter,
      ctx,
    );
    expect(result.records[0]).toEqual({
      studentId: 'S-002',
      name: 'Mary',
      born: '2013-01-02',
      age: 11,
      guardians: [{ name: 'Jo', phone: '0789' }],
      clubs: ['chess', 'art'],
    });
    expect(result.errors.map(e => ({ ref: e.ref, code: e.code }))).toEqual([{ ref: 'age', code: 'CELL_FORMAT' }]);
  });

  it("uses a caller's validator in place of the generic checks", () => {
    const strict = exampleJsonAdapter(STUDENT, { validator: record => (record['name'] ? [] : [{ ref: 'name', code: 'RECORD_REQUIRED', message: 'missing' }]) });
    const plan = { planVersion: 2, target: 'example-json', entries: [{ ref: 'studentId', column: 0 }, { ref: 'name', column: 1 }] };
    const result = applyMapping([['S-1', '']], plan, strict, ctx);
    expect(result.errors.map(e => e.code)).toEqual(['RECORD_REQUIRED']);
  });
});
