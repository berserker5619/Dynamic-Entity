/**
 * adapter.fixtures.ts — a small adapter written to the `SchemaAdapter` contract, for tests.
 *
 * An order with a customer, a split `tags` list, numbered `phones` (not positional, as DE's
 * arrays are), and positional numbered `guardians`. Each test overrides the hooks it is about.
 * Excluded from coverage, like the server's `*.fixtures.ts`.
 */
import type { ImportTarget, SchemaAdapter, TargetSet, ValueKind } from './adapter.types';

const text: ValueKind = { kind: 'string' };

export function leaf(ref: string, value: ValueKind = text, extra: Partial<ImportTarget<null>> = {}): ImportTarget<null> {
  return { ref, shapeRef: ref, header: ref, required: false, value, meta: null, ...extra };
}

function slotted(arrayRef: string, child: string, value: ValueKind, count: number, extra: Partial<ImportTarget<null>> = {}): ImportTarget<null>[] {
  return Array.from({ length: count }, (_, slot) =>
    leaf(`${arrayRef}.${slot}.${child}`, value, { shapeRef: `${arrayRef}.${child}`, arrayRef, arrayIndex: slot, ...extra }),
  );
}

export type TestAdapter = SchemaAdapter<null, { calls: string[] }>;

/** The order schema. `overrides` replace any hook or field. */
export function ordersAdapter(overrides: Partial<TestAdapter> = {}): TestAdapter {
  return {
    id: 'orders',
    version: 1,
    adapterVersion: '0.0.0',
    targets(options): TargetSet<null> {
      const slots = options.slots;
      return {
        targets: [
          leaf('orderId', text, { required: true }),
          leaf('customer.email', { kind: 'string', format: 'email' }),
          leaf('customer.name', { kind: 'string', minLength: 2, maxLength: 20 }),
          leaf('quantity', { kind: 'number', integer: true, min: 1, max: 99 }),
          leaf('placed', { kind: 'date' }),
          leaf('paid', { kind: 'boolean' }),
          leaf('status', { kind: 'enum', values: ['open', 'closed'], labels: ['Open', 'Closed'] }),
          leaf('tags', { kind: 'list', of: text, maxItems: 3 }),
          leaf('code', { kind: 'string', pattern: '^[A-Z]{3}$' }),
          ...slotted('phones', 'number', { kind: 'string', format: 'phone' }, slots['phones'] ?? 0, { required: true }),
          ...slotted('phones', 'kind', text, slots['phones'] ?? 0),
          ...slotted('guardians', 'name', text, slots['guardians'] ?? 0),
        ],
        arrays: [
          { ref: 'phones', label: 'Phones', itemKind: 'object', required: false, positional: false },
          { ref: 'guardians', label: 'Guardians', itemKind: 'object', required: false, positional: true },
        ],
        unsupported: [],
      };
    },
    ...overrides,
  };
}

/** A v2 plan mapping `refs` to columns 0, 1, 2, … */
export function planFor(refs: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { planVersion: 2, target: 'orders', entries: refs.map((ref, column) => ({ ref, column })), ...extra };
}
