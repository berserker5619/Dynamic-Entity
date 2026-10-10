/**
 * validatePlan (`validate-plan.ts`): the checks that need an adapter's targets (Decision 10),
 * against a small adapter written to the `SchemaAdapter` contract (`adapter.types.ts`).
 */
import type { ImportTarget, SchemaAdapter, TargetOptions, TargetSet, ValueKind } from './adapter.types';
import type { NormalizedPlan } from './plan.types';
import { readPlan } from './read-plan';
import { validatePlan } from './validate-plan';

const text: ValueKind = { kind: 'string' };

/** An order: a customer, `tags` as a split list, numbered `phones`, and `items` one per row. */
function ordersAdapter(): SchemaAdapter & { calls: TargetOptions[] } {
  const calls: TargetOptions[] = [];
  const leaf = (ref: string, value: ValueKind = text, extra: Partial<ImportTarget> = {}): ImportTarget => ({
    ref,
    shapeRef: ref,
    header: ref,
    required: false,
    value,
    meta: null,
    ...extra,
  });
  const slotted = (arrayRef: string, child: string, count: number): ImportTarget[] =>
    Array.from({ length: count }, (_, slot) =>
      leaf(`${arrayRef}.${slot}.${child}`, text, { shapeRef: `${arrayRef}.${child}`, arrayRef, arrayIndex: slot }),
    );
  return {
    id: 'orders',
    version: 2,
    adapterVersion: '0.0.0',
    calls,
    targets(options): TargetSet {
      calls.push(options);
      return {
        targets: [
          leaf('orderId'),
          leaf('customer.email'),
          leaf('tags', { kind: 'list', of: text }),
          ...slotted('phones', 'number', options.slots['phones'] ?? 0),
          ...slotted('items', 'sku', options.slots['items'] ?? 0),
          ...slotted('items', 'qty', options.slots['items'] ?? 0),
        ],
        arrays: [
          { ref: 'phones', label: 'Phone', itemKind: 'object', required: false, positional: false },
          { ref: 'items', label: 'Item', itemKind: 'object', required: true, positional: true },
        ],
        unsupported: [],
      };
    },
  };
}

/** A plan through readPlan, as validatePlan always receives one. */
function read(input: Record<string, unknown>): NormalizedPlan {
  const { plan, problems } = readPlan({ planVersion: 2, target: 'orders', ...input });
  if (!plan) throw new Error(`fixture plan does not read: ${JSON.stringify(problems)}`);
  return plan;
}
const problemsOf = (input: Record<string, unknown>, adapter = ordersAdapter()) =>
  validatePlan(read(input), adapter).map(({ level, code, path }) => ({ level, code, path }));
const map = (...refs: string[]) => ({ entries: refs.map((ref, column) => ({ ref, column })) });

describe('validatePlan', () => {
  it('accepts a plan every ref of which is a target', () => {
    expect(problemsOf(map('orderId', 'customer.email', 'phones.0.number', 'phones.2.number'))).toEqual([]);
  });

  it('sizes the targets from the plan, per array (§7)', () => {
    const adapter = ordersAdapter();
    validatePlan(read(map('orderId', 'phones.4.number')), adapter);
    expect(adapter.calls).toEqual([{ slots: { phones: 5 } }]);
  });

  it('refuses a ref the schema has no target for', () => {
    expect(problemsOf(map('orderId', 'customer.phone'))).toEqual([
      { level: 'error', code: 'PLAN_UNKNOWN_REF', path: 'entries[1].ref' },
    ]);
  });

  it('refuses split on a target that is not a list, and accepts it on one that is', () => {
    expect(problemsOf({ entries: [{ ref: 'tags', column: 0, split: '|' }] })).toEqual([]);
    expect(problemsOf({ entries: [{ ref: 'orderId', column: 0, split: '|' }] })).toEqual([
      { level: 'error', code: 'PLAN_SPLIT_TARGET', path: 'entries[0].split' },
    ]);
  });

  it('warns, never errs, when the plan was written for another target or version', () => {
    expect(problemsOf({ ...map('orderId'), target: 'invoices', schemaVersion: 1 })).toEqual([
      { level: 'warning', code: 'PLAN_TARGET_MISMATCH', path: 'target' },
      { level: 'warning', code: 'PLAN_TARGET_MISMATCH', path: 'schemaVersion' },
    ]);
    expect(problemsOf({ ...map('orderId'), schemaVersion: 2 })).toEqual([]);
  });

  describe('lists', () => {
    it("refuses a key that is not one of the schema's arrays", () => {
      expect(problemsOf({ ...map('orderId'), lists: { faxes: {} } })).toEqual([
        { level: 'error', code: 'PLAN_LIST_OPTION', path: 'lists["faxes"]' },
      ]);
    });

    it('refuses compact: false on an array the adapter cannot keep positions for, never compacting it silently', () => {
      expect(problemsOf({ ...map('phones.1.number'), lists: { phones: { compact: false } } })).toEqual([
        { level: 'error', code: 'PLAN_LIST_OPTION', path: 'lists["phones"].compact' },
      ]);
      expect(problemsOf({ ...map('phones.1.number'), lists: { phones: { compact: true } } })).toEqual([]);
    });

    it('accepts compact: false on a positional array', () => {
      expect(problemsOf({ ...map('items.1.sku'), lists: { items: { compact: false } } })).toEqual([]);
    });
  });

  describe('collected arrays', () => {
    const group = { key: [0], collect: ['items'] };

    it('maps a collected array by shape ref, with no slot index (§6)', () => {
      expect(problemsOf({ ...map('orderId', 'items.sku', 'items.qty'), group })).toEqual([]);
    });

    it('asks for one slot of a collected array, to learn its item targets', () => {
      const adapter = ordersAdapter();
      validatePlan(read({ ...map('orderId', 'items.sku'), group }), adapter);
      expect(adapter.calls).toEqual([{ slots: { items: 1 } }]);
    });

    it('refuses a slot index into a collected array', () => {
      expect(problemsOf({ ...map('orderId', 'items.0.sku'), group })).toEqual([
        { level: 'error', code: 'PLAN_GROUP', path: 'entries[1].ref' },
      ]);
    });

    it("refuses to collect something that is not one of the schema's arrays", () => {
      expect(problemsOf({ ...map('orderId'), group: { key: [0], collect: ['customer'] } })).toEqual([
        { level: 'error', code: 'PLAN_GROUP', path: 'group.collect[0]' },
      ]);
    });

    it('still refuses an unknown item ref of a collected array', () => {
      expect(problemsOf({ ...map('orderId', 'items.price'), group })).toEqual([
        { level: 'error', code: 'PLAN_UNKNOWN_REF', path: 'entries[1].ref' },
      ]);
    });
  });
});
