/**
 * grouping-cases.ts — Feature B's adapter cases (docs/3.1-spec.md, B1 and B2), for every path.
 *
 * Each case is a grouped plan over a Dynamic Entity config, with what it proves beyond the paths
 * agreeing. Three paths run them, as CSV and as `.xlsx`:
 *
 * - `LocalImportTransport` (ngx, `grouping-parity.spec.ts`);
 * - sheet-to-schema's router with `grouping: true`, over the binding DE's router builds
 *   (`viaImporterRouter` here), against which the other two are compared;
 * - DE's own `createImportRouter` with `grouping: true` (server, `grouping.spec.ts`).
 *
 * Equal to the same path means equal to each other. Not under `src/`, so it is neither
 * published nor counted by core's coverage gate. Imported by relative path, as
 * `preview-parity.ts` is.
 */
import ExcelJS from 'exceljs';
import express from 'express';
import { createImportRouter } from 'sheet-to-schema/node';
import request from 'supertest';
import { entityFormConfigAdapter, planForConfig, type EntityFormConfig, type FormRule, type ImportLookups, type NestedFieldConfig } from '../src/index';

/** A sheet as a user would upload it. */
export interface SheetBytes {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

// ─── Configs ──────────────────────────────────────────────────────────────────

const text = (id: string, label: string, extra: Partial<NestedFieldConfig> = {}): NestedFieldConfig => ({ id, type: 'text', label: { en: label }, ...extra });

const items = (extra: Partial<NestedFieldConfig> = {}, children?: NestedFieldConfig[]): NestedFieldConfig => ({
  id: 'items',
  type: 'array',
  label: { en: 'Item' },
  children: children ?? [text('sku', 'SKU'), { id: 'qty', type: 'number', label: { en: 'Qty' } }],
  ...extra,
});

const orderConfig = (...fields: NestedFieldConfig[]): EntityFormConfig => ({
  entity: 'orders',
  version: 7,
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [text('orderId', 'Order'), ...fields] }],
});

const KINDS = [
  { en: 'Gift', $key: 'gift' },
  { en: 'Sample', $key: 'sample' },
];

// ─── The cases (Feature B's table) ────────────────────────────────────────────

export interface Case {
  name: string;
  config: EntityFormConfig;
  headers: string[];
  rows: string[][];
  plan: Record<string, unknown>;
  rules?: FormRule[];
  lookups?: ImportLookups;
  /** What the case proves, beyond the two paths agreeing. */
  check: (result: Imported) => void;
  /** Set while the case waits on a release: run as `it.failing`, with this as the reason. */
  failing?: string;
}

const grouped = (entries: [string, number][], collect: string[], extra: Record<string, unknown> = {}) => ({
  planVersion: 2,
  target: 'orders',
  entries: entries.map(([ref, column]) => ({ ref, column })),
  group: { key: [0], collect },
  ...extra,
});

export const CASES: Case[] = [
  {
    name: 'an items array, one row per item',
    config: orderConfig(items()),
    headers: ['Order', 'SKU', 'Qty'],
    rows: [['A-1', 'PEN', '2'], ['A-1', 'INK', '1'], ['A-2', 'PAD', '5']],
    plan: grouped([['orderId', 0], ['items.sku', 1], ['items.qty', 2]], ['items']),
    check: ({ records, errors }) => {
      expect(errors).toEqual([]);
      expect(records.map(r => [r['orderId'], r['items']])).toEqual([
        ['A-1', [{ sku: 'PEN', qty: 2 }, { sku: 'INK', qty: 1 }]],
        ['A-2', [{ sku: 'PAD', qty: 5 }]],
      ]);
      // Stamped once, on the record: not on an item, and not once per row.
      expect(records.map(r => r['_configVersion'])).toEqual([7, 7]);
      expect(JSON.stringify(records).match(/_configVersion/g)).toHaveLength(2);
    },
  },
  {
    name: 'the same array, moved by refererField (tab-level)',
    config: orderConfig(items({ refererField: 'order.items' })),
    headers: ['Order', 'SKU', 'Qty'],
    rows: [['A-1', 'PEN', '2'], ['A-1', 'INK', '1']],
    plan: grouped([['orderId', 0], ['order.items.sku', 1], ['order.items.qty', 2]], ['order.items']),
    check: ({ records, errors }) => {
      expect(errors).toEqual([]);
      expect(records).toHaveLength(1);
      // Written where the form reads it, once, on the finished record: two items, not four.
      expect((records[0]['order'] as { items: unknown[] }).items).toEqual([{ sku: 'PEN', qty: 2 }, { sku: 'INK', qty: 1 }]);
    },
  },
  {
    name: 'a required field inside an item, and an item with a bad cell',
    config: orderConfig(items({}, [text('sku', 'SKU', { validators: { required: true } }), { id: 'qty', type: 'number', label: { en: 'Qty' } }])),
    headers: ['Order', 'SKU', 'Qty'],
    rows: [['A-1', 'PEN', '2'], ['A-1', 'INK', 'x'], ['A-2', 'PAD', '1'], ['A-2', '', '3'], ['A-3', 'NIB', '4']],
    plan: grouped([['orderId', 0], ['items.sku', 1], ['items.qty', 2]], ['items']),
    // sheet-to-schema 1.2 reports a record-level problem inside an item on the group's first row
    // (row 4, rows [4, 5]); 1.3.0 reports it on the item's own row. Failing until DE is on ^1.3.0.
    failing: 'sheet-to-schema 1.3.0: an item problem reports its own row',
    check: ({ records, errors }) => {
      // A bad item fails its whole record; the record without one imports.
      expect(records.map(r => r['orderId'])).toEqual(['A-3']);
      // Each error is on the item's own row (header is row 1): the cell error and the required one.
      expect(errors.map(e => [e.row, e.rows, e.ref, e.code])).toEqual([
        [3, [3], 'items.qty', 'CELL_FORMAT'],
        [5, [5], 'items.1.sku', 'RECORD_REQUIRED'],
      ]);
    },
  },
  {
    name: 'a rule that hides a required field in the parent',
    config: orderConfig(text('reason', 'Reason', { validators: { required: true } }), items()),
    headers: ['Order', 'Reason', 'SKU', 'Qty'],
    rows: [['skip', '', 'PEN', '1'], ['skip', '', 'INK', '2'], ['A-2', '', 'PAD', '1'], ['A-2', '', 'NIB', '1']],
    plan: grouped([['orderId', 0], ['reason', 1], ['items.sku', 2], ['items.qty', 3]], ['items']),
    rules: [
      {
        formConfigId: 'orders',
        fieldId: 'orderId',
        conditions: [{ operator: 'EQUAL', value: 'skip', compareType: 'value' }],
        action: { type: 'visibility', value: false },
        targets: [{ id: 'reason', type: 'field' }],
        enabled: true,
        priority: 0,
      } as FormRule,
    ],
    check: ({ records, errors }) => {
      // Hidden, so not required: the group imports. Visible and empty: one error for the record,
      // not one per row, because the rules ran once on the finished record.
      expect(records.map(r => r['orderId'])).toEqual(['skip']);
      expect(errors.filter(e => e.code === 'RECORD_REQUIRED').map(e => e.ref)).toEqual(['reason']);
    },
  },
  {
    name: 'a dropdown with a listName in an item',
    config: orderConfig(items({}, [text('sku', 'SKU'), { id: 'kind', type: 'dropdown', label: { en: 'Kind' }, listName: 'kinds' }])),
    headers: ['Order', 'SKU', 'Kind'],
    rows: [['A-1', 'PEN', 'Gift'], ['A-1', 'INK', 'Sample'], ['A-2', 'PAD', 'Bribe']],
    plan: grouped([['orderId', 0], ['items.sku', 1], ['items.kind', 2]], ['items']),
    lookups: { kinds: KINDS },
    check: ({ records, errors }) => {
      // Resolved per item, each against the list.
      expect(records).toHaveLength(1);
      const kinds = (records[0]['items'] as { kind: unknown }[]).map(item => item.kind);
      expect(kinds).toHaveLength(2);
      expect(kinds[0]).not.toEqual(kinds[1]);
      expect(errors.map(e => [e.row, e.code])).toEqual([[4, 'CELL_UNKNOWN_OPTION']]);
    },
  },
  {
    name: "parent fields that disagree across a group's rows",
    config: orderConfig(text('city', 'City'), items()),
    headers: ['Order', 'City', 'SKU', 'Qty'],
    rows: [['A-1', 'Paris', 'PEN', '1'], ['A-1', 'Rome', 'INK', '2']],
    plan: grouped([['orderId', 0], ['city', 1], ['items.sku', 2], ['items.qty', 3]], ['items']),
    check: ({ records, warnings }) => {
      expect(records.map(r => r['city'])).toEqual(['Paris']);
      expect(warnings.map(w => [w.code, w.ref])).toEqual([['RECORD_GROUP_CONFLICT', 'city']]);
    },
  },
  {
    name: 'a stored 2.2 plan with an un-indexed moved-array ref',
    config: orderConfig(items({ refererField: 'order.items' })),
    headers: ['Order', 'SKU', 'Qty'],
    rows: [['A-1', 'PEN', '2'], ['A-1', 'INK', '1']],
    // As 2.2 stored it (the array's own id, no slot), with a group added for the move to 3.1.
    plan: grouped([['orderId', 0], ['items.sku', 1], ['items.qty', 2]], ['order.items'], { schemaVersion: 7 }),
    check: ({ records, planProblems }) => {
      // upgradeRefs runs first, and a legacy ref can only become a slot (`order.items.0.sku`),
      // which a collected array refuses. A plan that groups must be written in v2 form: legacy
      // refs are not rewritten for collected arrays (docs/3.1-spec.md, Feature B).
      expect(planProblems.map(p => [p.level, p.code, p.path])).toEqual([
        ['warning', 'PLAN_LEGACY_REF', 'entries[1].ref'],
        ['warning', 'PLAN_LEGACY_REF', 'entries[2].ref'],
        ['error', 'PLAN_GROUP', 'entries[1].ref'],
        ['error', 'PLAN_GROUP', 'entries[2].ref'],
      ]);
      expect(records).toEqual([]);
    },
  },
];

// ─── The two paths ────────────────────────────────────────────────────────────

/** What both paths are compared on. */
export interface Imported {
  records: Record<string, unknown>[];
  errors: { row: number; rows?: number[]; ref: string; code?: string }[];
  warnings: { row: number; ref: string; code?: string }[];
  planProblems: { level: string; code?: string; path: string }[];
  imported: number;
  skipped: number;
}

/** Plain data, as it crosses the wire. */
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export async function sheetFile(format: 'csv' | 'xlsx', headers: string[], rows: string[][]): Promise<SheetBytes> {
  if (format === 'csv') {
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n') + '\n';
    return { name: 'orders.csv', bytes: new TextEncoder().encode(csv) };
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Orders');
  for (const row of [headers, ...rows]) sheet.addRow(row);
  return { name: 'orders.xlsx', bytes: new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer) };
}

/** Records written, and the parts of an `/import` answer compared. */
async function imported(app: express.Express, entity: string, c: Case, file: SheetBytes, written: Record<string, unknown>[]): Promise<Imported> {
  const response = await request(app)
    .post(`/import/${entity}/import`)
    .field('plan', JSON.stringify(c.plan))
    .attach('file', Buffer.from(file.bytes), file.name);
  if (response.status !== 200) throw new Error(`${c.name}: answered ${response.status} ${JSON.stringify(response.body)}`);
  return plain({
    records: written,
    errors: response.body.errors,
    warnings: response.body.warnings ?? [],
    planProblems: response.body.planProblems,
    imported: response.body.imported,
    skipped: response.body.skipped,
  });
}

/** sheet-to-schema's router with `grouping: true`, over the binding DE's router builds. */
export async function viaImporterRouter(c: Case, file: SheetBytes): Promise<Imported> {
  const written: Record<string, unknown>[] = [];
  const app = express();
  app.use(
    '/import',
    createImportRouter(express.Router(), {
      bindings: {
        [c.config.entity]: {
          adapter: entityFormConfigAdapter(c.config, { rules: c.rules, lookups: c.lookups }) as never,
          ctx: { lang: 'en' },
          kind: 'dynamic-entity',
          plan: plan => planForConfig(plan, c.config),
        },
      },
      param: 'entity',
      grouping: true,
      onImport: records => {
        written.push(...records);
      },
    }),
  );
  return imported(app, c.config.entity, c, file, written);
}

/** Any router mounted at `/import` that writes through `onImport`: DE's own, in the server's spec. */
export function viaRouter(mount: (app: express.Express, onImport: (records: Record<string, unknown>[]) => void) => void) {
  return (c: Case, file: SheetBytes): Promise<Imported> => {
    const written: Record<string, unknown>[] = [];
    const app = express();
    mount(app, records => written.push(...records));
    return imported(app, c.config.entity, c, file, written);
  };
}
