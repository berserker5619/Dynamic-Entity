/**
 * Grouping (spec §5) through applyMapping (`apply-mapping.ts`, `groupRows` and `buildGroup`),
 * against the test adapter's collected `items`. Codes, rows and refs only; never message text.
 *
 * The streaming runner's limits (`maxGroups`, `maxGroupKeyBytes`, `maxGroupRows`) bound memory
 * that `applyMapping` does not hold, and are tested with the runner.
 */
import { ordersAdapter } from './adapter.fixtures';
import type { RecordProblem } from './adapter.types';
import { applyMapping } from './apply-mapping';
import { ImportFailure } from './import-failure';
import type { ImportResult } from './result.types';

const ctx = { calls: [] as string[] };
/** Columns: 0 order id, 1 customer email, 2 sku, 3 qty. Grouped by column 0, collecting items. */
const plan = (group: Record<string, unknown> = {}) => ({
  planVersion: 2,
  target: 'orders',
  entries: [
    { ref: 'orderId', column: 0 },
    { ref: 'customer.email', column: 1 },
    { ref: 'items.sku', column: 2 },
    { ref: 'items.qty', column: 3 },
  ],
  group: { key: [0], collect: ['items'], ...group },
});
const run = (rows: unknown[][], p: unknown = plan(), adapter = ordersAdapter()) => applyMapping(rows, p, adapter, ctx);
const reconciles = (r: ImportResult) => (r.rowsInImported ?? 0) + r.skipped + (r.failed ?? 0) === r.rowsRead;

describe('grouping (§5)', () => {
  it('turns 7 order rows with 4 distinct contiguous keys into 4 records, items in sheet order', () => {
    const result = run([
      ['A', 'a@example.com', 'S1', '1'],
      ['A', '', 'S2', '2'],
      ['B', 'b@example.com', 'S3', '1'],
      ['C', 'c@example.com', 'S4', '1'],
      ['C', '', 'S5', '3'],
      ['C', '', 'S6', '1'],
      ['D', 'd@example.com', 'S7', '2'],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { orderId: 'A', customer: { email: 'a@example.com' }, items: [{ sku: 'S1', qty: 1 }, { sku: 'S2', qty: 2 }] },
      { orderId: 'B', customer: { email: 'b@example.com' }, items: [{ sku: 'S3', qty: 1 }] },
      {
        orderId: 'C',
        customer: { email: 'c@example.com' },
        items: [{ sku: 'S4', qty: 1 }, { sku: 'S5', qty: 3 }, { sku: 'S6', qty: 1 }],
      },
      { orderId: 'D', customer: { email: 'd@example.com' }, items: [{ sku: 'S7', qty: 2 }] },
    ]);
    expect(result).toMatchObject({ rowsRead: 7, imported: 4, rowsInImported: 7, skipped: 0, failed: 0 });
    expect(reconciles(result)).toBe(true);
  });

  it('keeps the first row on a parent-field disagreement, with one warning carrying every row', () => {
    const result = run([
      ['A', 'a@example.com', 'S1', '1'],
      ['A', 'other@example.com', 'S2', '1'],
      ['A', 'third@example.com', 'S3', '1'],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ row: 2, rows: [2, 3, 4], ref: 'customer.email', code: 'RECORD_GROUP_CONFLICT' }),
    ]);
    expect(result.records[0]['customer']).toEqual({ email: 'a@example.com' });
    expect(result).toMatchObject({ imported: 1, failed: 0 });
  });

  it('fills a parent field the first row left blank from a later row: nothing disagrees', () => {
    const result = run([
      ['A', '', 'S1', '1'],
      ['A', 'a@example.com', 'S2', '1'],
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.records[0]['customer']).toEqual({ email: 'a@example.com' });
  });

  it('fails the import when a closed key comes back, naming both rows', () => {
    const rows = [
      ['A', '', 'S1', '1'],
      ['B', '', 'S2', '1'],
      ['A', '', 'S3', '1'],
    ];
    expect(() => run(rows)).toThrow(ImportFailure);
    try {
      run(rows);
    } catch (failure) {
      expect((failure as ImportFailure).code).toBe('GROUP_NOT_CONTIGUOUS');
      expect((failure as ImportFailure).details).toEqual({ key: ['A'], rows: [2, 4] });
    }
  });

  it('gathers rows of one key wherever they are with contiguous: false, in order of first appearance', () => {
    const result = run(
      [
        ['A', '', 'S1', '1'],
        ['B', '', 'S2', '1'],
        ['A', '', 'S3', '1'],
      ],
      plan({ contiguous: false }),
    );
    expect(result.records.map(r => [r['orderId'], (r['items'] as { sku: string }[]).map(i => i.sku)])).toEqual([
      ['A', ['S1', 'S3']],
      ['B', ['S2']],
    ]);
    expect(result).toMatchObject({ rowsInImported: 3, imported: 2 });
    expect(reconciles(result)).toBe(true);
  });

  it('compares a key as a tuple, so values that would collide when joined stay apart', () => {
    const p = plan({ key: [0, 1] });
    const result = run(
      [
        ['a|b', 'c', 'S1', '1'],
        ['a', 'b|c', 'S2', '1'],
      ],
      p,
      ordersAdapter({ validate: () => [] }),
    );
    expect(result.records).toHaveLength(2);
  });

  it('keys a typed cell by its cellText, so a date cell and its ISO text group together', () => {
    const p = plan({ key: [1] });
    const result = run(
      [
        ['A', new Date(Date.UTC(2024, 2, 7)), 'S1', '1'],
        ['A', '2024-03-07', 'S2', '1'],
      ],
      p,
      ordersAdapter({ validate: () => [] }),
    );
    expect(result.records).toHaveLength(1);
  });

  it('imports a row with a blank key as its own record, with a RECORD_GROUP_NO_KEY warning', () => {
    const result = run([
      ['A', '', 'S1', '1'],
      ['', '', 'S2', '1'],
      ['', '', 'S3', '1'],
    ], plan(), ordersAdapter({ validate: () => [] }));
    expect(result.records).toHaveLength(3);
    expect(result.warnings).toEqual([
      expect.objectContaining({ row: 3, rows: [3], ref: '', code: 'RECORD_GROUP_NO_KEY' }),
      expect.objectContaining({ row: 4, rows: [4], ref: '', code: 'RECORD_GROUP_NO_KEY' }),
    ]);
  });

  it('closes an open group at a blank-key row, so the same key after it is not contiguous', () => {
    expect(() =>
      run([
        ['A', '', 'S1', '1'],
        ['', '', 'S2', '1'],
        ['A', '', 'S3', '1'],
      ]),
    ).toThrow(ImportFailure);
  });

  it('fails the whole record when one of its rows fails, counting every row of it', () => {
    const result = run([
      ['A', '', 'S1', '1'],
      ['A', '', 'S2', 'two'],
      ['B', '', 'S3', '1'],
    ]);
    expect(result.records.map(r => r['orderId'])).toEqual(['B']);
    expect(result.errors).toEqual([expect.objectContaining({ row: 2, rows: [2, 3], ref: 'items.qty', column: 3, code: 'CELL_FORMAT' })]);
    expect(result).toMatchObject({ failed: 2, rowsInImported: 1, imported: 1 });
    expect(reconciles(result)).toBe(true);
  });

  it('appends identical items as two items, and drops an all-blank one', () => {
    const result = run([
      ['A', '', 'S1', '1'],
      ['A', '', 'S1', '1'],
      ['A', 'a@example.com', '', ''],
    ]);
    expect(result.records[0]['items']).toEqual([{ sku: 'S1', qty: 1 }, { sku: 'S1', qty: 1 }]);
  });

  it('does not let a blank row between two rows of a group split it', () => {
    const result = run([
      ['A', '', 'S1', '1'],
      ['', '', '', ''],
      ['A', '', 'S2', '1'],
    ]);
    expect(result.records).toHaveLength(1);
    expect(result).toMatchObject({ skipped: 1, rowsInImported: 2 });
    expect(reconciles(result)).toBe(true);
  });

  it('compares a numbered-column array as a whole, by the parent-field rule', () => {
    const p = {
      planVersion: 2,
      target: 'orders',
      entries: [
        { ref: 'orderId', column: 0 },
        { ref: 'phones.0.number', column: 1 },
        { ref: 'items.sku', column: 2 },
      ],
      group: { key: [0], collect: ['items'] },
    };
    const result = run(
      [
        ['A', '+44 20 7946 0000', 'S1'],
        ['A', '+44 20 7946 0001', 'S2'],
      ],
      p,
    );
    expect(result.records[0]['phones']).toEqual([{ number: '+44 20 7946 0000' }]);
    expect(result.warnings).toEqual([expect.objectContaining({ ref: 'phones', code: 'RECORD_GROUP_CONFLICT' })]);
  });

  it('finalizes and validates each group once, after its last row', () => {
    const seen: number[] = [];
    const adapter = ordersAdapter({
      finalize: record => record,
      validate: (record): RecordProblem[] => {
        seen.push((record['items'] as unknown[]).length);
        return [];
      },
    });
    run(
      [
        ['A', '', 'S1', '1'],
        ['A', '', 'S2', '1'],
        ['B', '', 'S3', '1'],
      ],
      plan(),
      adapter,
    );
    expect(seen).toEqual([2, 1]);
  });

  it('validates collected items per item that exists', () => {
    const result = run([
      ['A', '', '', '2'],
      ['A', '', 'S2', '1'],
    ]);
    expect(result.errors).toEqual([expect.objectContaining({ ref: 'items.0.sku', code: 'RECORD_REQUIRED', rows: [2, 3] })]);
  });
});
