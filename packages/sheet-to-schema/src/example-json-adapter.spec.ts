/**
 * exampleJsonAdapter (`example-json-adapter.ts`), on its own and through the engine
 * (`applyMapping`, `suggestMapping`, `slotsFor`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyMapping } from './apply-mapping';
import { exampleJsonAdapter } from './example-json-adapter';
import { slotsFor, suggestMapping } from './suggest';

/**
 * The prototype's own student sample (`test/fixtures/student`, and its README): one example
 * record, the sheet used with it, and the records the prototype built.
 */
const FIXTURE = join(__dirname, '..', 'test', 'fixtures', 'student');
const fixture = (name: string): string => readFileSync(join(FIXTURE, name), 'utf8');
const STUDENT = JSON.parse(fixture('example.json')) as Record<string, unknown>;
const [HEADERS, ...ROWS] = fixture('sample.csv').trim().split(/\r?\n/).map(line => line.split(','));
const EXPECTED = JSON.parse(fixture('expected-output.json')) as Record<string, unknown>[];

const adapter = exampleJsonAdapter(STUDENT);
const at = (ref: string, slots: Record<string, number> = {}) => adapter.targets({ slots }).targets.find(t => t.ref === ref);

describe('exampleJsonAdapter — targets', () => {
  it('is example-json unless told otherwise, and takes its version from the options', () => {
    expect(adapter.id).toBe('example-json');
    expect(adapter.version).toBeUndefined();
    const named = exampleJsonAdapter(STUDENT, { id: 'students', version: 2 });
    expect([named.id, named.version]).toEqual(['students', 2]);
  });

  it('infers the arrays of objects and a split clubs list from the student example', () => {
    const set = adapter.targets({ slots: {} });
    expect(set.arrays).toEqual([
      { ref: 'guardians', label: 'guardians', itemKind: 'object', required: false, positional: true },
      { ref: 'subjects', label: 'subjects', itemKind: 'object', required: false, positional: true },
    ]);
    // The example has one guardian, so one slot is the least offered.
    expect(set.targets.filter(t => t.arrayRef === 'guardians').map(t => t.ref)).toEqual([
      'guardians.0.name',
      'guardians.0.relation',
      'guardians.0.phone',
    ]);
    expect(at('clubs')?.value).toEqual({ kind: 'list', of: { kind: 'string' } });
    expect(set.unsupported).toEqual([]);
  });

  it('infers each kind from its value', () => {
    expect(at('studentId')?.value).toEqual({ kind: 'string' });
    expect(at('enrolledOn')).toMatchObject({ value: { kind: 'date' }, format: 'YYYY-MM-DD' });
    // A number, never an integer: one example is not a bound (the prototype read an integer).
    expect(at('subjects.0.marks')?.value).toEqual({ kind: 'number' });
    expect(at('subjects.0.passed')?.value).toEqual({ kind: 'boolean' });
    expect(at('name.first')).toMatchObject({ header: 'name / first', matchKeys: ['first'], meta: { sample: 'Kavya' } });
    const times = exampleJsonAdapter({ at: '2024-03-07T09:30:00Z', opens: '09:30' }).targets({ slots: {} }).targets;
    expect(times.map(t => t.value)).toEqual([{ kind: 'datetime' }, { kind: 'time' }]);
    expect(times[1].format).toBe('HH:mm');
  });

  it('requires nothing', () => {
    expect(adapter.targets({ slots: { guardians: 2 } }).targets.every(t => !t.required)).toBe(true);
  });

  it('never offers fewer slots than the sample shows, and more when asked', () => {
    expect(at('guardians.0.name', { guardians: 0 })).toBeDefined();
    expect(at('guardians.1.name')).toBeUndefined();
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

describe("exampleJsonAdapter — through the engine, on the prototype's sheet", () => {
  const ctx = undefined;

  it("fills 2 guardian slots from the sheet's numbered headers", () => {
    expect(slotsFor(HEADERS, adapter)).toEqual({ guardians: 3, subjects: 3 });
    const plan = suggestMapping(HEADERS, adapter);
    expect(plan.target).toBe('example-json');
    const guardians = Object.fromEntries(plan.entries.filter(e => e.ref.startsWith('guardians.')).map(e => [e.header, e.ref]));
    expect(guardians).toEqual({
      'Guardian 1 Name': 'guardians.0.name',
      'Guardian 1 Relation': 'guardians.0.relation',
      'Guardian 1 Phone': 'guardians.0.phone',
      'Guardian 2 Name': 'guardians.1.name',
      'Guardian 2 Relation': 'guardians.1.relation',
      'Guardian 2 Phone': 'guardians.1.phone',
    });
    expect(plan.entries.find(e => e.header === 'Clubs')?.ref).toBe('clubs');
  });

  it('imports the guardians and clubs the prototype built', () => {
    const plan = suggestMapping(HEADERS, adapter);
    const kept = { ...plan, entries: plan.entries.filter(e => e.ref.startsWith('guardians.') || e.ref === 'clubs') };
    const result = applyMapping([ROWS[0], ROWS[2]], kept, adapter, ctx);
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual(EXPECTED.map(({ guardians, clubs }) => ({ guardians, clubs })));
  });

  it('reports a cell the inferred kind cannot read', () => {
    const plan = { planVersion: 2, target: 'example-json', entries: [{ ref: 'studentId', column: 0 }, { ref: 'subjects.0.marks', column: 11 }] };
    const result = applyMapping(ROWS, plan, adapter, ctx);
    expect(result.errors.map(e => ({ row: e.row, ref: e.ref, code: e.code, raw: e.raw }))).toEqual([{ row: 5, ref: 'subjects.0.marks', code: 'CELL_FORMAT', raw: 'sixty' }]);
    expect(result.records).toHaveLength(3);
  });

  it("uses a caller's validator in place of the generic checks", () => {
    const strict = exampleJsonAdapter(STUDENT, { validator: record => (record['enrolledOn'] ? [] : [{ ref: 'enrolledOn', code: 'RECORD_REQUIRED', message: 'missing' }]) });
    const plan = { planVersion: 2, target: 'example-json', entries: [{ ref: 'studentId', column: 0 }, { ref: 'enrolledOn', column: 3 }] };
    const result = applyMapping([['S-1', '', '', '']], plan, strict, ctx);
    expect(result.errors.map(e => e.code)).toEqual(['RECORD_REQUIRED']);
  });
});
