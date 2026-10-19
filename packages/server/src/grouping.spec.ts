/**
 * DE's router with `grouping` (docs/3.1-spec.md, B2).
 *
 * - On: every Feature B case imports through DE's own `createImportRouter` exactly as through
 *   sheet-to-schema's router over the same binding, which B1 holds to `LocalImportTransport`
 *   (`core/test-fixtures/grouping-cases.ts`). Previews say `features: ["group"]`.
 * - Off, the default: a grouped plan is refused as in 3.0, and previews say nothing. The 3.0
 *   refusal test (`over-sheet-to-schema.spec.ts`) is unchanged.
 * - `contiguous: false` is refused either way, and nothing is written.
 */
import express from 'express';
import request from 'supertest';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { CASES, sheetFile, viaImporterRouter, viaRouter, type Case } from '../../core/test-fixtures/grouping-cases';
import { createImportRouter, type ImportRouterOptions } from './express';

/** DE's router, as an app would mount it, with this case's config, rules and lookups. */
const viaDynamicEntity = (c: Case) =>
  viaRouter((app, onImport) => {
    app.use(
      '/import',
      createImportRouter({
        configs: { [c.config.entity]: c.config },
        rules: c.rules ? { [c.config.entity]: c.rules } : undefined,
        lookups: c.lookups,
        grouping: true,
        onImport: records => onImport(records),
      }),
    );
  });

describe.each(['csv', 'xlsx'] as const)("DE's router with grouping: true, as %s", format => {
  const run = async (c: Case) => {
    const file = await sheetFile(format, c.headers, c.rows);
    const ours = await viaDynamicEntity(c)(c, file);
    expect(ours).toEqual(await viaImporterRouter(c, file));
    c.check(ours);
  };
  it.each(CASES.map(c => [c.name, c] as const))('%s: the same as through sheet-to-schema directly', (_, c) => run(c));
});

// ─── The option ───────────────────────────────────────────────────────────────

const PEOPLE: EntityFormConfig = {
  entity: 'people',
  version: 1,
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      flatData: true,
      fields: [
        { id: 'name', type: 'text', label: { en: 'Name' } },
        { id: 'phones', type: 'array', label: { en: 'Phone' }, children: [{ id: 'number', type: 'text', label: { en: 'Number' } }] },
      ],
    },
  ],
};
const SHEET = 'Name,Number\r\nAda,111\r\nAda,222\r\nBo,333\r\n';
const groupedPlan = (contiguous?: boolean) => ({
  planVersion: 2,
  target: 'people',
  entries: [{ ref: 'name', column: 0 }, { ref: 'phones.number', column: 1 }],
  group: { key: [0], collect: ['phones'], ...(contiguous === undefined ? {} : { contiguous }) },
});

function app(options: Partial<ImportRouterOptions> = {}, written: Record<string, unknown>[] = []): express.Express {
  const server = express();
  server.use('/import', createImportRouter({ configs: { people: PEOPLE }, onImport: records => void written.push(...records), ...options }));
  return server;
}
const post = (server: express.Express, route: string, plan?: unknown) => {
  const call = request(server).post(`/import/people/${route}`);
  return (plan === undefined ? call : call.field('plan', JSON.stringify(plan))).attach('file', Buffer.from(SHEET), 'people.csv');
};

describe('the grouping option', () => {
  it('is off by default: a grouped plan is refused as in 3.0, by reason, and nothing is written', async () => {
    const written: Record<string, unknown>[] = [];
    for (const route of ['import', 'validate']) {
      const response = await post(app({}, written), route, groupedPlan());
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PLAN');
      expect(response.body.error.details).toEqual([expect.objectContaining({ level: 'error', code: 'PLAN_GROUP', path: 'group', reason: 'grouping-disabled' })]);
    }
    expect(written).toEqual([]);
  });

  it('is off when false, the same as when absent', async () => {
    const off = await post(app({ grouping: false }), 'import', groupedPlan());
    const absent = await post(app(), 'import', groupedPlan());
    expect([off.status, off.body]).toEqual([absent.status, absent.body]);
  });

  it('says nothing about features on a preview when off, and "group" when on', async () => {
    expect((await post(app(), 'preview')).body).not.toHaveProperty('features');
    expect((await post(app({ grouping: false }), 'preview')).body).not.toHaveProperty('features');
    expect((await post(app({ grouping: true }), 'preview')).body.features).toEqual(['group']);
  });

  it('imports a grouped plan when on, one record per group', async () => {
    const written: Record<string, unknown>[] = [];
    const response = await post(app({ grouping: true }, written), 'import', groupedPlan());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ imported: 2, failed: 0, rowsRead: 3, rowsInImported: 3 });
    expect(written.map(record => [record['name'], record['phones']])).toEqual([
      ['Ada', [{ number: '111' }, { number: '222' }]],
      ['Bo', [{ number: '333' }]],
    ]);
  });

  it('refuses contiguous: false with grouping on or off, by reason, and writes nothing', async () => {
    const written: Record<string, unknown>[] = [];
    for (const [grouping, reason] of [[true, 'non-contiguous'], [false, 'grouping-disabled']] as const) {
      for (const route of ['import', 'validate']) {
        const response = await post(app({ grouping }, written), route, groupedPlan(false));
        expect(response.status).toBe(400);
        expect(response.body.error.details).toEqual([expect.objectContaining({ code: 'PLAN_GROUP', reason })]);
      }
    }
    expect(written).toEqual([]);
  });

  it('leaves a plan without a group as it was, on or off', async () => {
    const plan = { planVersion: 2, target: 'people', entries: [{ ref: 'name', column: 0 }, { ref: 'phones.0.number', column: 1 }] };
    const on: Record<string, unknown>[] = [];
    const off: Record<string, unknown>[] = [];
    const a = await post(app({ grouping: true }, on), 'import', plan);
    const b = await post(app({}, off), 'import', plan);
    expect(a.body).toEqual(b.body);
    expect(on).toEqual(off);
    expect(on).toHaveLength(3);
  });
});
