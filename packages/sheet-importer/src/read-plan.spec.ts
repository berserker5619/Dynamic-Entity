/**
 * readPlan against spec §4 (docs/import-phase1-spec.md). Codes, levels and paths only: the
 * spec forbids comparing message text.
 *
 * Covers `readPlan` (`read-plan.ts`) and, through it, `isUnsafePath` (`safe-path.ts`). The
 * checks that need an adapter (`PLAN_UNKNOWN_REF`, `PLAN_SPLIT_TARGET`, a `collect` that is not
 * an array, `PLAN_TARGET_MISMATCH`, `PLAN_LEGACY_REF`) are `validatePlan`'s and are not here.
 */
import { PLAN_PROBLEM_CODES } from './problem-codes';
import { readPlan } from './read-plan';
import type { PlanProblem } from './plan.types';

const problemsOf = (input: unknown, options = {}) =>
  readPlan(input, options).problems.map(({ level, code, path }: PlanProblem) => ({ level, code, path }));
const errorsOf = (input: unknown) => problemsOf(input).filter(problem => problem.level === 'error');

/** A plan as 2.3's mapper and `suggestMapping` stored it. */
const V1 = {
  entity: 'employees',
  configVersion: 3,
  sourceHeaders: ['First Name', 'Phone 1'],
  entries: [
    { ref: 'personal.firstName', column: 0, header: 'First Name', confidence: 'exact' },
    { ref: 'phones.0.number', column: 1, header: 'Phone 1', confidence: 'guess' },
    { ref: 'personal.status', constant: 'Active' },
  ],
};

/** A v2 plan with no target under either name. */
const UNTARGETED = { planVersion: 2, entries: [{ ref: 'orderId', column: 0 }] };

const v2 = (extra: Record<string, unknown> = {}) => ({
  planVersion: 2,
  target: 'orders',
  entries: [{ ref: 'orderId', column: 0 }],
  ...extra,
});

describe('readPlan — v1 plans', () => {
  it('reads a stored 2.3 plan without problems and normalises it to v2', () => {
    const { plan, problems } = readPlan(V1);
    expect(problems).toEqual([]);
    expect(plan).toEqual({
      planVersion: 2,
      target: 'employees',
      schemaVersion: 3,
      sourceHeaders: ['First Name', 'Phone 1'],
      entries: V1.entries,
    });
  });

  it('does not touch the plan it was given', () => {
    const input = structuredClone(V1);
    readPlan(input);
    expect(input).toEqual(V1);
  });

  it('keeps a v1 plan with its owner\'s own fields, warning once per key and dropping them', () => {
    const { plan, problems } = readPlan({ ...V1, id: 'p-1', name: 'Payroll', createdAt: '2026-01-01' });
    expect(problems).toEqual(
      ['id', 'name', 'createdAt'].map(path => expect.objectContaining({ level: 'warning', code: 'PLAN_UNKNOWN_KEY', path })),
    );
    expect(plan).not.toHaveProperty('id');
    expect(plan).not.toHaveProperty('name');
    expect(plan).not.toHaveProperty('createdAt');
  });

  it('still refuses an unknown key on a v1 entry', () => {
    const { plan, problems } = readPlan({ ...V1, entries: [{ ref: 'a', column: 0, colour: 'red' }] });
    expect(plan).toBeUndefined();
    expect(problems).toContainEqual(expect.objectContaining({ level: 'error', code: 'PLAN_UNKNOWN_KEY', path: 'entries[0].colour' }));
  });

  it.each([
    ['group', { group: { key: [0], collect: ['items'] } }, 'group'],
    ['lists', { lists: { items: { compact: false } } }, 'lists'],
    ['split', { entries: [{ ref: 'tags', column: 0, split: ';' }] }, 'entries[0].split'],
  ])('refuses a v2 field (%s) on a plan without planVersion, rather than ignoring it', (_name, extra, path) => {
    const { plan, problems } = readPlan({ ...V1, ...extra });
    expect(plan).toBeUndefined();
    expect(problems).toContainEqual(expect.objectContaining({ level: 'error', code: 'PLAN_VERSION', path }));
  });
});

describe('readPlan — versions', () => {
  it.each([3, 1, '2', 0, null])('refuses planVersion %p, returning no plan', version => {
    const { plan, problems } = readPlan(v2({ planVersion: version }));
    expect(plan).toBeUndefined();
    expect(problems.map(p => p.code)).toEqual(['PLAN_VERSION']);
  });

  it('refuses any unknown key on a v2 plan, top-level or in an entry', () => {
    expect(errorsOf(v2({ id: 'p-1' }))).toEqual([{ level: 'error', code: 'PLAN_UNKNOWN_KEY', path: 'id' }]);
    expect(errorsOf(v2({ entries: [{ ref: 'a', column: 0, colour: 'red' }] }))).toEqual([
      { level: 'error', code: 'PLAN_UNKNOWN_KEY', path: 'entries[0].colour' },
    ]);
    expect(readPlan(v2({ id: 'p-1' })).plan).toBeUndefined();
  });

  it('reads a v2 plan carrying headerRow as an unknown key: v2 has no header row', () => {
    expect(errorsOf(v2({ headerRow: 3 }))).toEqual([{ level: 'error', code: 'PLAN_UNKNOWN_KEY', path: 'headerRow' }]);
  });

  it('lets tooling read past unknown keys, as warnings, and drops them', () => {
    const { plan, problems } = readPlan(v2({ id: 'p-1', entries: [{ ref: 'a', column: 0, colour: 'red' }] }), {
      allowUnknownKeys: true,
    });
    expect(problems.map(({ level, code, path }) => ({ level, code, path }))).toEqual([
      { level: 'warning', code: 'PLAN_UNKNOWN_KEY', path: 'id' },
      { level: 'warning', code: 'PLAN_UNKNOWN_KEY', path: 'entries[0].colour' },
    ]);
    expect(plan?.entries).toEqual([{ ref: 'a', column: 0 }]);
  });
});

describe('readPlan — aliases', () => {
  it('refuses entity and target that disagree', () => {
    expect(errorsOf({ ...v2(), entity: 'customers' })).toEqual([
      { level: 'error', code: 'PLAN_ALIAS_CONFLICT', path: 'entity' },
    ]);
  });

  it('warns when entity and target agree, asking for the old name to go', () => {
    const { plan, problems } = readPlan({ ...v2(), entity: 'orders' });
    expect(problems.map(({ level, code, path }) => ({ level, code, path }))).toEqual([
      { level: 'warning', code: 'PLAN_ALIAS_USED', path: 'entity' },
    ]);
    expect(plan?.target).toBe('orders');
    expect(plan).not.toHaveProperty('entity');
  });

  it('treats configVersion and schemaVersion the same way', () => {
    expect(errorsOf({ ...v2({ schemaVersion: 2 }), configVersion: 1 })).toEqual([
      { level: 'error', code: 'PLAN_ALIAS_CONFLICT', path: 'configVersion' },
    ]);
    expect(problemsOf({ ...v2({ schemaVersion: 2 }), configVersion: 2 })).toEqual([
      { level: 'warning', code: 'PLAN_ALIAS_USED', path: 'configVersion' },
    ]);
  });

  it('reads the old name alone on v1 without comment, and with a warning on v2', () => {
    expect(problemsOf(V1)).toEqual([]);
    const { plan, problems } = readPlan({ ...UNTARGETED, entity: 'orders' });
    expect(plan?.target).toBe('orders');
    expect(problems.map(p => p.code)).toEqual(['PLAN_ALIAS_USED']);
  });

  it('refuses a plan that names no target under either name (Decision 11)', () => {
    expect(errorsOf(UNTARGETED)).toEqual([{ level: 'error', code: 'PLAN_SHAPE', path: 'target' }]);
  });

  it('reports a malformed target once, not also as a missing one', () => {
    expect(errorsOf(v2({ target: 42 }))).toEqual([{ level: 'error', code: 'PLAN_SHAPE', path: 'target' }]);
    expect(errorsOf(v2({ target: '' }))).toEqual([{ level: 'error', code: 'PLAN_SHAPE', path: 'target' }]);
  });
});

describe('readPlan — shape', () => {
  it.each([null, undefined, 'plan', 42, [], new Date()])('refuses %p as not a plan', input => {
    expect(readPlan(input)).toEqual({ problems: [expect.objectContaining({ level: 'error', code: 'PLAN_SHAPE', path: '' })] });
  });

  it('refuses entries that are not a list', () => {
    expect(errorsOf(v2({ entries: 'nope' }))).toEqual([{ level: 'error', code: 'PLAN_SHAPE', path: 'entries' }]);
  });

  it('refuses an entry that is not an object, and one with no ref', () => {
    expect(errorsOf(v2({ entries: [null, { column: 0 }, { ref: '', column: 1 }] }))).toEqual([
      { level: 'error', code: 'PLAN_SHAPE', path: 'entries[0]' },
      { level: 'error', code: 'PLAN_SHAPE', path: 'entries[1].ref' },
      { level: 'error', code: 'PLAN_SHAPE', path: 'entries[2].ref' },
    ]);
  });

  it('refuses wrongly typed fields with PLAN_SHAPE (Decision 12)', () => {
    expect(
      errorsOf(
        v2({
          schemaVersion: 'three',
          sourceHeaders: ['a', 1],
          entries: [{ ref: 'a', column: 0, header: 7, confidence: 'sure', split: ' long separator ' }],
        }),
      ),
    ).toEqual([
      { level: 'error', code: 'PLAN_SHAPE', path: 'schemaVersion' },
      { level: 'error', code: 'PLAN_SHAPE', path: 'sourceHeaders' },
      { level: 'error', code: 'PLAN_SHAPE', path: 'entries[0].header' },
      { level: 'error', code: 'PLAN_SHAPE', path: 'entries[0].confidence' },
      { level: 'error', code: 'PLAN_SHAPE', path: 'entries[0].split' },
    ]);
  });

  it('accepts a split of up to eight characters, and refuses an empty one', () => {
    expect(errorsOf(v2({ entries: [{ ref: 'tags', column: 0, split: ' || ' }] }))).toEqual([]);
    expect(errorsOf(v2({ entries: [{ ref: 'tags', column: 0, split: '12345678' }] }))).toEqual([]);
    expect(errorsOf(v2({ entries: [{ ref: 'tags', column: 0, split: '' }] }))).toEqual([
      { level: 'error', code: 'PLAN_SHAPE', path: 'entries[0].split' },
    ]);
  });
});

describe('readPlan — sources and duplicates', () => {
  it('refuses an entry with both a column and a constant, or neither', () => {
    expect(errorsOf(v2({ entries: [{ ref: 'a', column: 0, constant: 'x' }, { ref: 'b' }] }))).toEqual([
      { level: 'error', code: 'PLAN_SOURCE', path: 'entries[0]' },
      { level: 'error', code: 'PLAN_SOURCE', path: 'entries[1]' },
    ]);
  });

  it.each([-1, 1.5, '0', NaN])('refuses column %p', column => {
    expect(errorsOf(v2({ entries: [{ ref: 'a', column }] }))).toEqual([
      { level: 'error', code: 'PLAN_SOURCE', path: 'entries[0].column' },
    ]);
  });

  it('accepts a constant of any type, including a falsy one', () => {
    for (const constant of [0, false, '', null, { en: 'Active' }]) {
      expect(errorsOf(v2({ entries: [{ ref: 'a', constant }] }))).toEqual([]);
    }
  });

  it('refuses one ref mapped twice, at the second entry', () => {
    expect(errorsOf(v2({ entries: [{ ref: 'a', column: 0 }, { ref: 'a', column: 1 }] }))).toEqual([
      { level: 'error', code: 'PLAN_DUPLICATE_REF', path: 'entries[1].ref' },
    ]);
  });
});

describe('readPlan — unsafe paths (rule 6)', () => {
  it.each(['__proto__.polluted', 'customer.constructor', 'a.prototype.b', 'prototype'])(
    'refuses %s in an entry ref, a lists key and a collect entry',
    ref => {
      expect(errorsOf(v2({ entries: [{ ref, column: 0 }] }))).toEqual([
        { level: 'error', code: 'PLAN_UNSAFE_PATH', path: 'entries[0].ref' },
      ]);
      expect(errorsOf(v2({ lists: { [ref]: {} } }))).toEqual([
        { level: 'error', code: 'PLAN_UNSAFE_PATH', path: `lists[${JSON.stringify(ref)}]` },
      ]);
      expect(errorsOf(v2({ group: { key: [0], collect: [ref] } }))).toEqual([
        { level: 'error', code: 'PLAN_UNSAFE_PATH', path: 'group.collect[0]' },
      ]);
    },
  );

  it('refuses a JSON-parsed __proto__ key at the top level as unknown, without walking it', () => {
    const hostile = JSON.parse('{"planVersion":2,"target":"orders","entries":[],"__proto__":{"polluted":true}}');
    expect(errorsOf(hostile)).toEqual([{ level: 'error', code: 'PLAN_UNKNOWN_KEY', path: '__proto__' }]);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
});

describe('readPlan — group', () => {
  const grouped = (group: unknown) => v2({ group });

  it('fills in contiguous: true, once, so nothing downstream re-applies it (rule 7)', () => {
    expect(readPlan(grouped({ key: [0, 2], collect: ['items'] })).plan?.group).toEqual({
      key: [0, 2],
      collect: ['items'],
      contiguous: true,
    });
    expect(readPlan(grouped({ key: [0], collect: ['items'], contiguous: false })).plan?.group?.contiguous).toBe(false);
  });

  it.each([
    ['not an object', 'by-order', 'group'],
    ['an empty key', { key: [], collect: ['items'] }, 'group.key'],
    ['a key that is not a list', { key: 0, collect: ['items'] }, 'group.key'],
    ['a key column that is not an index', { key: [0, -1], collect: ['items'] }, 'group.key[1]'],
    ['an empty collect', { key: [0], collect: [] }, 'group.collect'],
    ['a collect entry that is not a ref', { key: [0], collect: ['items', ''] }, 'group.collect[1]'],
    ['a contiguous that is not a boolean', { key: [0], collect: ['items'], contiguous: 'yes' }, 'group.contiguous'],
  ])('refuses %s with PLAN_GROUP', (_name, group, path) => {
    expect(errorsOf(grouped(group))).toEqual([{ level: 'error', code: 'PLAN_GROUP', path }]);
  });

  it('refuses an unknown key inside group', () => {
    expect(errorsOf(grouped({ key: [0], collect: ['items'], by: 'order' }))).toEqual([
      { level: 'error', code: 'PLAN_UNKNOWN_KEY', path: 'group.by' },
    ]);
  });
});

describe('readPlan — lists', () => {
  it('reads list options keyed by array ref, and keeps a key with no options', () => {
    expect(readPlan(v2({ lists: { phones: { compact: false }, 'contact.faxes': {} } })).plan?.lists).toEqual({
      phones: { compact: false },
      'contact.faxes': {},
    });
  });

  it.each([
    ['lists that are not an object', ['phones'], 'lists'],
    ['an empty key', { '': {} }, 'lists[""]'],
    ['options that are not an object', { phones: true }, 'lists["phones"]'],
    ['a compact that is not a boolean', { phones: { compact: 'no' } }, 'lists["phones"].compact'],
  ])('refuses %s with PLAN_LIST_OPTION', (_name, lists, path) => {
    expect(errorsOf(v2({ lists }))).toEqual([{ level: 'error', code: 'PLAN_LIST_OPTION', path }]);
  });

  it('refuses compact on an array the group collects (§6)', () => {
    expect(
      errorsOf(v2({ group: { key: [0], collect: ['items'] }, lists: { items: { compact: false } } })),
    ).toEqual([{ level: 'error', code: 'PLAN_LIST_OPTION', path: 'lists["items"].compact' }]);
  });

  it('refuses an unknown list option', () => {
    expect(errorsOf(v2({ lists: { phones: { positional: true } } }))).toEqual([
      { level: 'error', code: 'PLAN_UNKNOWN_KEY', path: 'lists["phones"].positional' },
    ]);
  });
});

describe('readPlan — results', () => {
  it('returns no plan while any problem is an error, and a plan alongside warnings', () => {
    expect(readPlan(v2({ entries: [{ ref: 'a' }] })).plan).toBeUndefined();
    expect(readPlan({ ...v2(), entity: 'orders' }).plan).toBeDefined();
  });

  it('reports every problem in one pass, not just the first', () => {
    const codes = readPlan(
      v2({ id: 1, entries: [{ ref: 'a' }, { ref: 'a', column: 0 }, { ref: '__proto__', column: -1 }] }),
    ).problems.map(p => p.code);
    expect(codes).toEqual(['PLAN_UNKNOWN_KEY', 'PLAN_SOURCE', 'PLAN_DUPLICATE_REF', 'PLAN_UNSAFE_PATH', 'PLAN_SOURCE']);
  });

  it('only ever emits codes from PLAN_PROBLEM_CODES', () => {
    const known = new Set<string>(PLAN_PROBLEM_CODES);
    const inputs: unknown[] = [
      null,
      v2({ planVersion: 9 }),
      { ...V1, group: {} },
      { ...v2(), entity: 'x', configVersion: 'y', schemaVersion: 1 },
      v2({ lists: { items: 1 }, group: { key: [], collect: [7] }, entries: [{}, { ref: 'a', column: 'b' }] }),
    ];
    for (const input of inputs) {
      for (const problem of readPlan(input).problems) expect(known.has(problem.code)).toBe(true);
    }
  });
});
