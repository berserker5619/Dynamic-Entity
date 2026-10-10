/**
 * jsonSchemaAdapter (`json-schema-adapter.ts`), on its own and through the engine
 * (`applyMapping`, `suggestMapping`, `validatePlan`).
 */
import { applyMapping } from './apply-mapping';
import { jsonSchemaAdapter, type JsonSchemaNode } from './json-schema-adapter';
import { readPlan } from './read-plan';
import { suggestMapping } from './suggest';
import { validatePlan } from './validate-plan';

const ORDER: JsonSchemaNode = {
  $id: 'order',
  title: 'Order',
  type: 'object',
  required: ['orderId', 'customer', 'items'],
  $defs: {
    address: { type: 'object', properties: { city: { type: 'string', title: 'City' } }, required: ['city'] },
    node: { type: 'object', properties: { child: { $ref: '#/$defs/node' } } },
  },
  properties: {
    orderId: { type: 'string', title: 'Order ID', pattern: '^ORD-\\d+$' },
    placed: { type: 'string', format: 'date', title: 'Placed' },
    paid: { type: 'boolean' },
    total: { type: 'number', minimum: 0 },
    status: { enum: ['open', 'shipped'] },
    priority: { title: 'Priority', oneOf: [{ const: 1, title: 'Low' }, { const: 2, title: 'High' }] },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    customer: {
      type: 'object',
      title: 'Customer',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email', title: 'Email' },
        website: { type: 'string', format: 'uri' },
      },
    },
    shipping: { anyOf: [{ type: 'null' }, { $ref: '#/$defs/address' }], title: 'Shipping' },
    billing: { allOf: [{ $ref: '#/$defs/address' }, { properties: { zip: { type: 'string' } } }] },
    items: {
      type: 'array',
      title: 'Items',
      items: {
        type: 'object',
        required: ['sku'],
        properties: {
          sku: { type: 'string', title: 'SKU' },
          qty: { type: 'integer', minimum: 1, title: 'Qty' },
          options: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
        },
      },
    },
    meta: { type: 'object' },
    tree: { $ref: '#/$defs/node' },
    anything: {},
  },
};

const adapter = jsonSchemaAdapter(ORDER, { version: 3 });
const at = (ref: string, slots: Record<string, number> = {}) => adapter.targets({ slots }).targets.find(t => t.ref === ref);

describe('jsonSchemaAdapter — targets', () => {
  it('takes its id from $id, and its version from the options', () => {
    expect(adapter.id).toBe('order');
    expect(adapter.version).toBe(3);
    expect(jsonSchemaAdapter({ type: 'object', properties: { a: { type: 'string' } } }).id).toBe('json-schema');
    expect(jsonSchemaAdapter({ title: 'Thing', type: 'object', properties: { a: { type: 'string' } } }).id).toBe('Thing');
  });

  it('reads each leaf as its value kind', () => {
    expect(at('orderId')?.value).toEqual({ kind: 'string', pattern: '^ORD-\\d+$' });
    expect(at('placed')?.value).toEqual({ kind: 'date' });
    expect(at('placed')?.format).toBe('YYYY-MM-DD');
    expect(at('paid')?.value).toEqual({ kind: 'boolean' });
    expect(at('total')?.value).toEqual({ kind: 'number', min: 0 });
    expect(at('customer.email')?.value).toEqual({ kind: 'string', format: 'email' });
    expect(at('customer.website')?.value).toEqual({ kind: 'string', format: 'url' });
  });

  it('stores the raw enum value, and reads a oneOf of consts as a labelled enum', () => {
    expect(at('status')?.value).toEqual({ kind: 'enum', values: ['open', 'shipped'] });
    expect(at('priority')?.value).toEqual({ kind: 'enum', values: [1, 2], labels: ['Low', 'High'] });
  });

  it('reads an array of primitives as one split list', () => {
    expect(at('tags')?.value).toEqual({ kind: 'list', of: { kind: 'string' }, maxItems: 3 });
    expect(adapter.targets({ slots: {} }).arrays.map(a => a.ref)).toEqual(['items']);
  });

  it('requires a field only when every object above it is required', () => {
    expect(at('orderId')?.required).toBe(true);
    expect(at('customer.email')?.required).toBe(true);
    expect(at('placed')?.required).toBe(false);
    // `shipping` is optional, so its required city is not required of the record.
    expect(at('shipping.city')?.required).toBe(false);
  });

  it('resolves a local $ref, merges allOf, and takes the first non-null anyOf branch', () => {
    expect(at('shipping.city')).toMatchObject({ header: 'Shipping / City' });
    expect(at('billing.city')).toBeDefined();
    expect(at('billing.zip')).toBeDefined();
  });

  it('unrolls an array of objects into numbered slots, per item required, as a positional array', () => {
    expect(adapter.targets({ slots: { items: 2 } }).arrays).toEqual([
      { ref: 'items', label: 'Items', itemKind: 'object', required: true, positional: true },
    ]);
    expect(at('items.1.sku', { items: 2 })).toMatchObject({
      shapeRef: 'items.sku',
      header: 'Items / SKU 2',
      matchKeys: ['SKU', 'sku'],
      required: true,
      arrayRef: 'items',
      arrayLabel: 'Items',
      arrayIndex: 1,
    });
    expect(at('items.0.qty', { items: 1 })?.value).toEqual({ kind: 'number', integer: true, min: 1 });
    expect(at('items.0.sku')).toBeUndefined();
  });

  it('reports what a sheet cannot carry, rather than guessing', () => {
    const reasons = Object.fromEntries(adapter.targets({ slots: { items: 1 } }).unsupported.map(u => [u.ref, u.reason]));
    expect(Object.keys(reasons).sort()).toEqual(['anything', 'items.0.options', 'meta', 'tree.child']);
    expect(reasons['items.0.options']).toMatch(/list inside a list/);
    expect(reasons['meta']).toMatch(/free-form/);
    expect(reasons['tree.child']).toMatch(/refers back/);
  });

  it('reads the edges of JSON Schema it meets in practice', () => {
    const edges = jsonSchemaAdapter({
      type: 'object',
      $defs: { 'a/b': { type: 'string', format: 'time' } },
      properties: {
        escaped: { $ref: '#/$defs/a~1b' },
        nullable: { type: ['string', 'null'], format: 'url' },
        whole: { type: 'integer', maximum: 9 },
        untypedEnum: { enum: ['x', 'y'] },
        onlyNull: { oneOf: [{ type: 'null' }] },
        untypedList: { type: 'array', items: {} },
        remote: { $ref: 'https://example.com/schema.json' },
        missing: { $ref: '#/$defs/nope' },
      },
    });
    const set = edges.targets({ slots: {} });
    const value = (ref: string) => set.targets.find(t => t.ref === ref)?.value;
    expect(value('escaped')).toEqual({ kind: 'time' });
    expect(set.targets.find(t => t.ref === 'escaped')?.format).toBe('HH:mm');
    expect(value('nullable')).toEqual({ kind: 'string', format: 'url' });
    expect(value('whole')).toEqual({ kind: 'number', integer: true, max: 9 });
    expect(value('untypedEnum')).toEqual({ kind: 'enum', values: ['x', 'y'] });
    expect(set.unsupported.map(u => u.ref).sort()).toEqual(['missing', 'onlyNull', 'remote', 'untypedList']);
    expect(set.unsupported.find(u => u.ref === 'untypedList')?.reason).toMatch(/items cannot be read/);
  });

  it('refuses a schema that describes no record', () => {
    expect(() => jsonSchemaAdapter({ type: 'string' })).toThrow(/object with properties/);
    expect(() => jsonSchemaAdapter({ type: 'object' })).toThrow(/object with properties/);
  });

  it('is pure: the same slots give the same targets', () => {
    expect(adapter.targets({ slots: { items: 2 } })).toEqual(adapter.targets({ slots: { items: 2 } }));
  });
});

describe('jsonSchemaAdapter — through the engine', () => {
  const ctx = undefined;

  it('imports grouped order rows into records the schema describes', () => {
    const plan = {
      planVersion: 2,
      target: 'order',
      entries: [
        { ref: 'orderId', column: 0 },
        { ref: 'customer.email', column: 1 },
        { ref: 'items.sku', column: 2 },
        { ref: 'items.qty', column: 3 },
        { ref: 'priority', column: 4 },
        { ref: 'tags', column: 5 },
      ],
      group: { key: [0], collect: ['items'] },
    };
    const result = applyMapping(
      [
        ['ORD-1', 'a@example.com', 'S1', '2', 'High', 'gift; fragile'],
        ['ORD-1', '', 'S2', '1', '', ''],
        ['ORD-2', 'b@example.com', 'S3', '1', 'low', ''],
      ],
      plan,
      adapter,
      ctx,
    );
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { orderId: 'ORD-1', customer: { email: 'a@example.com' }, priority: 2, tags: ['gift', 'fragile'], items: [{ sku: 'S1', qty: 2 }, { sku: 'S2', qty: 1 }] },
      { orderId: 'ORD-2', customer: { email: 'b@example.com' }, priority: 1, items: [{ sku: 'S3', qty: 1 }] },
    ]);
  });

  it('judges records by the schema with the generic checks', () => {
    const plan = { planVersion: 2, target: 'order', entries: [{ ref: 'orderId', column: 0 }, { ref: 'customer.email', column: 1 }, { ref: 'items.0.sku', column: 2 }] };
    const result = applyMapping([['nope', 'not-email', 'S1']], plan, adapter, ctx);
    expect(result.errors.map(e => ({ ref: e.ref, code: e.code }))).toEqual([
      { ref: 'orderId', code: 'RECORD_FORMAT' },
      { ref: 'customer.email', code: 'RECORD_FORMAT' },
    ]);
  });

  it("uses a caller's validator in place of the generic checks", () => {
    const strict = jsonSchemaAdapter(ORDER, { validator: record => (record['orderId'] ? [] : [{ ref: 'orderId', code: 'RECORD_REQUIRED', message: 'missing' }]) });
    const plan = { planVersion: 2, target: 'order', entries: [{ ref: 'orderId', column: 0 }, { ref: 'paid', column: 1 }] };
    const result = applyMapping([['bad id', 'yes']], plan, strict, ctx);
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([{ orderId: 'bad id', paid: true }]);
  });

  it('keeps slot positions with compact: false, because it is positional', () => {
    const plan = {
      planVersion: 2,
      target: 'order',
      entries: [
        { ref: 'orderId', column: 0 },
        { ref: 'customer.email', column: 3 },
        { ref: 'items.0.sku', column: 1 },
        { ref: 'items.1.sku', column: 2 },
      ],
      lists: { items: { compact: false } },
    };
    const { plan: read } = readPlan(plan);
    expect(validatePlan(read!, adapter)).toEqual([]);
    expect(applyMapping([['ORD-1', '', 'S2', 'a@example.com']], plan, adapter, ctx).records[0]['items']).toEqual([null, { sku: 'S2' }]);
  });

  it('suggests a mapping from a sheet whose headers name the schema', () => {
    const plan = suggestMapping(['Order ID', 'Email', 'Items 1 SKU', 'Items 2 SKU', 'Priority'], adapter);
    expect(plan.target).toBe('order');
    expect(plan.schemaVersion).toBe(3);
    expect(Object.fromEntries(plan.entries.map(e => [e.header, e.ref]))).toEqual({
      'Order ID': 'orderId',
      Priority: 'priority',
      Email: 'customer.email',
      'Items 1 SKU': 'items.0.sku',
      'Items 2 SKU': 'items.1.sku',
    });
  });
});
