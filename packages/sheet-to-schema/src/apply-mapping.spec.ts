/**
 * applyMapping and preparePlan (`apply-mapping.ts`), with the generic checks of
 * `validate-record.ts`, against the test adapter in `adapter.fixtures.ts`. Codes, levels,
 * refs and rows only; never message text (spec §4).
 */
import { ordersAdapter, planFor } from './adapter.fixtures';
import type { RecordProblem } from './adapter.types';
import { applyMapping, preparePlan } from './apply-mapping';
import type { ImportResult } from './result.types';

const ctx = { calls: [] as string[] };
const run = (rows: unknown[][], plan: unknown, adapter = ordersAdapter(), options = {}) =>
  applyMapping(rows, plan, adapter, ctx, options);
const errorsOf = (result: ImportResult) => result.errors.map(({ row, ref, code }) => ({ row, ref, code }));

/** rowsInImported + skipped + failed === rowsRead (§5, §9), on every result here. */
function reconciles(result: ImportResult): boolean {
  return (result.rowsInImported ?? 0) + result.skipped + (result.failed ?? 0) === result.rowsRead;
}

describe('applyMapping — records', () => {
  it('maps each row to a record, reading every cell by its kind', () => {
    const plan = planFor(['orderId', 'quantity', 'placed', 'paid', 'status', 'tags']);
    const result = run([['A-1', '3', '2024-03-07', 'yes', 'closed', 'gift; fragile']], plan);
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { orderId: 'A-1', quantity: 3, placed: '2024-03-07', paid: true, status: 'closed', tags: ['gift', 'fragile'] },
    ]);
    expect(result).toMatchObject({ rowsRead: 1, imported: 1, rowsInImported: 1, skipped: 0, failed: 0, warnings: [] });
  });

  it('reads typed cells as their type', () => {
    const result = run([['A-1', 4, new Date(Date.UTC(2024, 0, 1)), false]], planFor(['orderId', 'quantity', 'placed', 'paid']));
    expect(result.records).toEqual([{ orderId: 'A-1', quantity: 4, placed: '2024-01-01', paid: false }]);
  });

  it('writes nested refs as nested objects', () => {
    const result = run([['A-1', 'Ada', 'ada@example.com']], planFor(['orderId', 'customer.name', 'customer.email']));
    expect(result.records[0]).toEqual({ orderId: 'A-1', customer: { name: 'Ada', email: 'ada@example.com' } });
  });

  it('applies a constant to every row: a typed one as it is, a text one through the coercer', () => {
    const plan = {
      planVersion: 2,
      target: 'orders',
      entries: [
        { ref: 'orderId', column: 0 },
        { ref: 'quantity', constant: '2' },
        { ref: 'tags', constant: ['bulk'] },
      ],
    };
    expect(run([['A-1'], ['A-2']], plan).records).toEqual([
      { orderId: 'A-1', quantity: 2, tags: ['bulk'] },
      { orderId: 'A-2', quantity: 2, tags: ['bulk'] },
    ]);
  });

  it('skips a blank row, and a row holding only constants, without calling either an error', () => {
    const plan = { planVersion: 2, target: 'orders', entries: [{ ref: 'orderId', column: 0 }, { ref: 'paid', constant: true }] };
    const result = run([['A-1'], ['', '  '], [], ['A-2']], plan);
    expect(result.records.map(r => r['orderId'])).toEqual(['A-1', 'A-2']);
    expect(result).toMatchObject({ skipped: 2, imported: 2, failed: 0, rowsRead: 4 });
    expect(reconciles(result)).toBe(true);
  });

  it('honours the split an entry carries', () => {
    const plan = { planVersion: 2, target: 'orders', entries: [{ ref: 'orderId', column: 0 }, { ref: 'tags', column: 1, split: '|' }] };
    expect(run([['A-1', 'a|b; c']], plan).records[0]['tags']).toEqual(['a', 'b; c']);
  });

  it('reads a decimal comma only when asked (§8), the same as the server', () => {
    const plan = planFor(['orderId', 'quantity']);
    expect(run([['A-1', '1,5']], plan, ordersAdapter({ targets: decimalTargets }), { decimal: ',' }).records[0]).toEqual({
      orderId: 'A-1',
      quantity: 1.5,
    });
    expect(run([['A-1', '1.5']], plan, ordersAdapter({ targets: decimalTargets }), { decimal: '.' }).records[0]).toEqual({
      orderId: 'A-1',
      quantity: 1.5,
    });
  });

  it('does not touch the rows or the plan it was given', () => {
    const rows = [['A-1', '3']];
    const plan = planFor(['orderId', 'quantity']);
    const before = JSON.stringify({ rows, plan });
    run(rows, plan);
    expect(JSON.stringify({ rows, plan })).toBe(before);
  });
});

/** The order schema with a fractional `quantity`, for the decimal-mark test. */
function decimalTargets(options: Parameters<ReturnType<typeof ordersAdapter>['targets']>[0]) {
  const set = ordersAdapter().targets(options);
  return { ...set, targets: set.targets.map(t => (t.ref === 'quantity' ? { ...t, value: { kind: 'number' as const } } : t)) };
}

describe('applyMapping — errors', () => {
  it('reports a cell that cannot be read, with its code, row, column and raw value', () => {
    const result = run([['A-1', 'three'], ['A-2', '2']], planFor(['orderId', 'quantity']));
    expect(result.errors).toEqual([{ row: 2, ref: 'quantity', column: 1, code: 'CELL_FORMAT', message: expect.any(String), raw: 'three' }]);
    expect(result.records.map(r => r['orderId'])).toEqual(['A-2']);
    expect(result).toMatchObject({ failed: 1, imported: 1 });
    expect(reconciles(result)).toBe(true);
  });

  it('carries each cell code through: an unknown option and a failed list item', () => {
    const result = run([['A-1', 'archived', 'a; b; c; d; e']], planFor(['orderId', 'status', 'tags']));
    expect(errorsOf(result)).toEqual([
      { row: 2, ref: 'status', code: 'CELL_UNKNOWN_OPTION' },
      { row: 2, ref: 'tags', code: 'RECORD_RANGE' },
    ]);
  });

  it('numbers rows as the sheet does, from firstRowNumber', () => {
    expect(errorsOf(run([['A-1', 'x']], planFor(['orderId', 'quantity']), ordersAdapter(), { firstRowNumber: 10 }))).toEqual([
      { row: 10, ref: 'quantity', code: 'CELL_FORMAT' },
    ]);
  });

  it('collects every problem of every row rather than stopping at the first', () => {
    const result = run([['', 'x'], ['A-2', '0'], ['A-3', '5']], planFor(['orderId', 'quantity']));
    expect(errorsOf(result)).toEqual([
      { row: 2, ref: 'quantity', code: 'CELL_FORMAT' },
      { row: 2, ref: 'orderId', code: 'RECORD_REQUIRED' },
      { row: 3, ref: 'quantity', code: 'RECORD_RANGE' },
    ]);
    expect(result).toMatchObject({ failed: 2, imported: 1, rowsRead: 3 });
    expect(reconciles(result)).toBe(true);
  });
});

describe('applyMapping — generic validation (§8)', () => {
  const check = (refs: string[], row: unknown[]) => errorsOf(run([row], planFor(refs)));

  it('requires a required target', () => {
    expect(check(['quantity', 'orderId'], ['2', ''])).toEqual([{ row: 2, ref: 'orderId', code: 'RECORD_REQUIRED' }]);
  });

  it('checks number bounds, string lengths, patterns, formats and list sizes', () => {
    expect(check(['orderId', 'quantity'], ['A-1', '100'])).toEqual([{ row: 2, ref: 'quantity', code: 'RECORD_RANGE' }]);
    expect(check(['orderId', 'customer.name'], ['A-1', 'A'])).toEqual([{ row: 2, ref: 'customer.name', code: 'RECORD_RANGE' }]);
    expect(check(['orderId', 'code'], ['A-1', 'abc'])).toEqual([{ row: 2, ref: 'code', code: 'RECORD_FORMAT' }]);
    expect(check(['orderId', 'customer.email'], ['A-1', 'not-an-email'])).toEqual([
      { row: 2, ref: 'customer.email', code: 'RECORD_FORMAT' },
    ]);
    expect(check(['orderId', 'code'], ['A-1', 'ABC'])).toEqual([]);
  });

  it('checks a repeating target per item that exists, by its compacted position', () => {
    // Slot 2's number is missing; after compaction that item is phones.0, and it is phones.0 that fails.
    expect(check(['orderId', 'phones.0.number', 'phones.1.kind'], ['A-1', '', 'home'])).toEqual([
      { row: 2, ref: 'phones.0.number', code: 'RECORD_REQUIRED' },
    ]);
    expect(check(['orderId', 'phones.0.number'], ['A-1', '12'])).toEqual([{ row: 2, ref: 'phones.0.number', code: 'RECORD_FORMAT' }]);
  });

  it('passes an empty optional array: requiring an item nobody added is not a check', () => {
    expect(check(['orderId', 'phones.0.number'], ['A-1', ''])).toEqual([]);
  });

  it('lets the adapter replace the generic checks', () => {
    const validate = (record: Record<string, unknown>): RecordProblem[] =>
      record['orderId'] === 'A-1' ? [{ ref: 'orderId', code: 'RECORD_RULE', message: 'taken' }] : [];
    const result = run([['A-1', '100'], ['A-2', '100']], planFor(['orderId', 'quantity']), ordersAdapter({ validate }));
    expect(errorsOf(result)).toEqual([{ row: 2, ref: 'orderId', code: 'RECORD_RULE' }]);
    expect(result.records.map(r => r['orderId'])).toEqual(['A-2']);
  });
});

describe('applyMapping — slots (§6)', () => {
  it('compacts by default: data only in slot 2 is one item at index 0', () => {
    expect(run([['A-1', '', '+44 20 7946 0000']], planFor(['orderId', 'phones.0.number', 'phones.1.number'])).records[0]).toEqual({
      orderId: 'A-1',
      phones: [{ number: '+44 20 7946 0000' }],
    });
  });

  it('keeps positions with compact: false: data only in slot 2 is [null, {…}]', () => {
    const plan = planFor(['orderId', 'guardians.0.name', 'guardians.1.name', 'guardians.2.name'], {
      lists: { guardians: { compact: false } },
    });
    expect(run([['A-1', '', 'Bo', '']], plan).records[0]['guardians']).toEqual([null, { name: 'Bo' }]);
  });

  it('trims trailing empty slots of a positional array, and leaves no array when every slot is empty', () => {
    const plan = planFor(['orderId', 'guardians.0.name', 'guardians.1.name'], { lists: { guardians: { compact: false } } });
    expect(run([['A-1', 'Ada', '']], plan).records[0]['guardians']).toEqual([{ name: 'Ada' }]);
    expect(run([['A-1', '', '']], plan).records[0]).toEqual({ orderId: 'A-1' });
  });
});

describe('applyMapping — adapter hooks', () => {
  it("uses the adapter's coerce, and the generic coercer where it returns null", () => {
    const adapter = ordersAdapter({
      coerce: (target, raw) => (target.ref === 'orderId' ? { value: `ORD-${String(raw)}` } : null),
    });
    expect(run([['7', '3']], planFor(['orderId', 'quantity']), adapter).records[0]).toEqual({ orderId: 'ORD-7', quantity: 3 });
  });

  it("carries the adapter's coerce failure, code and all", () => {
    const adapter = ordersAdapter({ coerce: () => ({ error: 'no', code: 'CELL_UNKNOWN_OPTION' }) });
    // As in 2.3, a cell that failed is also absent from the record, so a required target is
    // reported as required too: the record is judged as it stands.
    expect(errorsOf(run([['7']], planFor(['orderId']), adapter))).toEqual([
      { row: 2, ref: 'orderId', code: 'CELL_UNKNOWN_OPTION' },
      { row: 2, ref: 'orderId', code: 'RECORD_REQUIRED' },
    ]);
  });

  it('runs finalize after compaction and before validation', () => {
    const adapter = ordersAdapter({
      finalize: record => ({ ...record, phoneCount: (record['phones'] as unknown[] | undefined)?.length ?? 0 }),
    });
    const record = run([['A-1', '', '+44 20 7946 0000']], planFor(['orderId', 'phones.0.number', 'phones.1.number']), adapter).records[0];
    expect(record['phoneCount']).toBe(1);
  });

  it('throws when a target is custom and the adapter cannot read it: an adapter bug, not a row error', () => {
    const adapter = ordersAdapter({
      targets: () => ({
        targets: [{ ref: 'sig', shapeRef: 'sig', header: 'Sig', required: false, value: { kind: 'custom' }, meta: null }],
        arrays: [],
        unsupported: [],
      }),
    });
    expect(() => run([['x']], planFor(['sig']), adapter)).toThrow(/custom/);
  });
});

describe('preparePlan', () => {
  it('stops before the first row on a plan error, reporting it', () => {
    const result = run([['A-1']], planFor(['nope']));
    expect(result.records).toEqual([]);
    expect(result.planProblems.map(p => p.code)).toEqual(['PLAN_UNKNOWN_REF']);
    expect(result).toMatchObject({ rowsRead: 0, imported: 0, failed: 0 });
  });

  it('reads a stored v1 plan through the aliases', () => {
    const v1 = { entity: 'orders', entries: [{ ref: 'orderId', column: 0 }] };
    const result = run([['A-1']], v1);
    expect(result.planProblems).toEqual([]);
    expect(result.records).toEqual([{ orderId: 'A-1' }]);
  });

  it("runs the adapter's upgradeRefs between reading and validating, keeping its warnings", () => {
    const adapter = ordersAdapter({
      upgradeRefs: plan => ({
        plan: { ...plan, entries: plan.entries.map(e => (e.ref === 'id' ? { ...e, ref: 'orderId' } : e)) },
        problems: [{ level: 'warning', code: 'PLAN_LEGACY_REF', path: 'entries[0].ref', message: 'renamed' }],
      }),
    });
    const result = run([['A-1']], planFor(['id']), adapter);
    expect(result.planProblems.map(p => p.code)).toEqual(['PLAN_LEGACY_REF']);
    expect(result.records).toEqual([{ orderId: 'A-1' }]);
  });

  it('refuses an old ref mapped alongside its new one, which only collide after the upgrade', () => {
    const adapter = ordersAdapter({
      upgradeRefs: plan => ({ plan: { ...plan, entries: plan.entries.map(e => ({ ...e, ref: 'orderId' })) }, problems: [] }),
    });
    expect(preparePlan(planFor(['id', 'orderId']), adapter).problems).toEqual([
      expect.objectContaining({ level: 'error', code: 'PLAN_DUPLICATE_REF', path: 'entries[1].ref' }),
    ]);
  });

  it('throws when upgradeRefs adds or drops entries: it may only rewrite refs (§7)', () => {
    const adapter = ordersAdapter({ upgradeRefs: plan => ({ plan: { ...plan, entries: [] }, problems: [] }) });
    expect(() => preparePlan(planFor(['orderId']), adapter)).toThrow(/only rewrite refs/);
  });

});
