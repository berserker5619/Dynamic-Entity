/**
 * What 3.0 changed underneath this package, held from the outside.
 *
 * The other suites here are the 2.x suites, unchanged, and they pass over sheet-to-schema's
 * runner and router. These are the things only a 3.0 server does, and the things a 2.x client
 * relies on that the generic router would not do on its own.
 */
import express from 'express';
import request from 'supertest';
import { CORE_VERSION, readPlan, type EntityFormConfig, type MappingPlan } from '@dynamic-entity/core';
import { ImportError as ImporterError, readSheet as importerReadSheet } from 'sheet-to-schema/node';
import { ImportError } from './errors';
import { createImportRouter, type OnImport } from './express';
import { readSheet } from './read-sheet';
import { previewSheet, runImport, suggestionFor } from './run-import';
import { CONFIG, CSV_TEXT, HEADERS, LOOKUPS, PLAN, chunked } from './sheet.fixtures';
import { templateSheetOf } from './write-template';

function app(
  overrides: Partial<Parameters<typeof createImportRouter>[0]> = {},
  written: Record<string, unknown>[] = [],
  seen: unknown[] = [],
): express.Express {
  const onImport: OnImport = (records, context) => {
    written.push(...records);
    seen.push(context);
  };
  const server = express();
  server.use('/import', createImportRouter({ configs: { employee: CONFIG }, lookups: LOOKUPS, onImport, ...overrides }));
  return server;
}
const upload = (server: express.Express, route: string, plan?: unknown) => {
  const call = request(server).post(`/import/employee/${route}`);
  return (plan === undefined ? call : call.field('plan', JSON.stringify(plan))).attach('file', Buffer.from(CSV_TEXT), 'people.csv');
};

/** PLAN as a 3.0 wizard writes it. */
const PLAN_V2: MappingPlan = { planVersion: 2, target: PLAN.entity, schemaVersion: PLAN.configVersion, sourceHeaders: PLAN.sourceHeaders, entries: PLAN.entries };

describe('what a 3.0 server says about itself', () => {
  it('still answers engineVersion with CORE_VERSION, which is what a Dynamic Entity client compares', async () => {
    const preview = await upload(app(), 'preview');
    const commit = await upload(app(), 'validate', PLAN);
    expect(preview.body.engineVersion).toBe(CORE_VERSION);
    expect(commit.body.engineVersion).toBe(CORE_VERSION);
  });

  it('adds the adapter it runs and the plan versions it reads', async () => {
    const preview = await upload(app(), 'preview');
    expect(preview.body.adapter).toEqual({ name: 'dynamic-entity', version: CORE_VERSION });
    expect(preview.body.planVersions).toEqual([1, 2]);
    expect((await upload(app(), 'validate', PLAN)).body.adapter).toEqual({ name: 'dynamic-entity', version: CORE_VERSION });
  });

  it('suggests plan v2, and sends the one array bound a 2.x wizard sizes with beside the slots per array', async () => {
    const { body } = await upload(app(), 'preview');
    expect(body.suggestion).toMatchObject({ planVersion: 2, target: 'employee' });
    expect(body.suggestion).toEqual(suggestionFor(HEADERS, CONFIG, 'en').suggestion);
    expect(body.arrayBound).toBe(suggestionFor(HEADERS, CONFIG, 'en').arrayBound);
    expect(body.slots).toEqual({});
  });
});

describe('the plans a 3.0 server reads', () => {
  it('imports the same records from a plan v2 as from the stored 2.x plan', async () => {
    const fromV1: Record<string, unknown>[] = [];
    const fromV2: Record<string, unknown>[] = [];
    const v1 = await upload(app({}, fromV1), 'import', PLAN);
    const v2 = await upload(app({}, fromV2), 'import', PLAN_V2);
    expect(v2.status).toBe(200);
    expect(v2.body).toEqual(v1.body);
    expect(fromV2).toEqual(fromV1);
    expect(fromV2.length).toBe(v1.body.imported);
  });

  it('reads a 2.x plan that names no entity against the config of the route, as 2.x did', async () => {
    const written: Record<string, unknown>[] = [];
    const response = await upload(app({}, written), 'import', { entries: PLAN.entries });
    expect(response.body.planProblems).toEqual([]);
    expect(response.body.imported).toBe(written.length);
    expect(written.length).toBeGreaterThan(0);
  });

  it('refuses a plan v2 that names no target', async () => {
    const written: Record<string, unknown>[] = [];
    const response = await upload(app({}, written), 'import', { planVersion: 2, entries: PLAN.entries });
    expect(response.body.planProblems.filter((problem: { level: string }) => problem.level === 'error').map((problem: { path: string }) => problem.path)).toEqual(['target']);
    expect(written).toEqual([]);
  });

  it('refuses a plan that groups rows before reading one, and says the browser import groups', async () => {
    const people: EntityFormConfig = {
      entity: 'people',
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
    const grouped: MappingPlan = {
      planVersion: 2,
      target: 'people',
      entries: [{ ref: 'name', column: 0 }, { ref: 'phones.number', column: 1 }],
      group: { key: [0], collect: ['phones'] },
    };
    const sheet = 'Name,Phone\r\nAda,111\r\nAda,222\r\n';
    const written: Record<string, unknown>[] = [];
    const server = app({ configs: { people } }, written);

    for (const route of ['import', 'validate']) {
      const response = await request(server).post(`/import/people/${route}`).field('plan', JSON.stringify(grouped)).attach('file', Buffer.from(sheet), 'people.csv');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PLAN');
      expect(response.body.error.message).toContain('browser import');
      expect(response.body.error.details).toEqual([expect.objectContaining({ level: 'error', code: 'PLAN_GROUP', path: 'group' })]);
    }
    expect(written).toEqual([]);

    await expect(runImport({ stream: chunked(sheet), plan: grouped, config: people })).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  });

  it('gives every error a code', async () => {
    const result = await runImport({ stream: chunked('First Name,Age\r\nAda,old\r\n'), plan: { entity: 'employee', entries: [{ ref: 'personal.firstName', column: 0 }, { ref: 'personal.age', column: 1 }] }, config: CONFIG, lookups: LOOKUPS });
    expect(result.errors.map(error => [error.ref, error.code])).toEqual([['personal.age', 'CELL_FORMAT']]);
    expect(result).toMatchObject({ warnings: [], warningCount: 0, rowsInImported: result.imported });
  });
});

describe('what the writer and the routes are still handed', () => {
  it('gives the writer the entity, the config and the request, with the entity under params.entity', async () => {
    const seen: { entity: string; config: EntityFormConfig; request: express.Request; index: number; firstRow: number; imported: number }[] = [];
    await upload(app({}, [], seen), 'import', PLAN);
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]).sort()).toEqual(['config', 'entity', 'firstRow', 'imported', 'index', 'request']);
    expect(seen[0]).toMatchObject({ entity: 'employee', index: 0, firstRow: 2, imported: 0 });
    expect(seen[0].config).toBe(CONFIG);
    expect(seen[0].request.params['entity']).toBe('employee');
  });

  it('names a template from the route when the config names no entity', async () => {
    const nameless = { ...CONFIG, entity: '' };
    const response = await request(app({ configs: { staff: nameless } })).get('/import/staff/template');
    expect(response.headers['content-disposition']).toBe('attachment; filename="staff-template.csv"');
  });

  it('says an unknown entity in the words it always has', async () => {
    const response = await request(app()).get('/import/nobody/template');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'UNKNOWN_ENTITY', message: 'No import is configured for that entity.' } });
  });
});

describe('the Dynamic Entity signatures over the generic ones', () => {
  it('previews with the suggestion the browser makes, as a plan the reader takes without a word', async () => {
    const preview = await previewSheet({ stream: chunked(CSV_TEXT), config: CONFIG });
    expect(preview).toEqual({ headers: HEADERS, sample: preview.sample, rowCount: preview.rowCount, format: 'csv', delimiter: ',', ...suggestionFor(HEADERS, CONFIG) });
    expect(readPlan(preview.suggestion).problems).toEqual([]);
  });

  it('suggests for a config that names no entity, and for none at all, as 2.x did: nothing mapped, no target', () => {
    expect(suggestionFor(HEADERS, { ...CONFIG, entity: undefined as never }).suggestion).toMatchObject({ target: '', entries: suggestionFor(HEADERS, CONFIG).suggestion.entries });
    expect(suggestionFor(HEADERS, null as never)).toMatchObject({ suggestion: { target: '', entries: [] } });
  });

  it('turns a template spec into the sheet the writer takes', () => {
    const spec = { entity: 'e', sheetName: 'People', columns: [{ header: 'Name' }, { header: 'Age' }], notes: ['Required', ''], unsupported: [] };
    expect(templateSheetOf(spec as never)).toEqual({ sheetName: 'People', headers: ['Name', 'Age'], notes: ['Required', ''] });
  });

  it('re-exports the moved code itself, not a copy of it', () => {
    expect(ImportError).toBe(ImporterError);
    expect(readSheet).toBe(importerReadSheet);
    expect(new ImporterError('NO_FILE', 'No file.')).toBeInstanceOf(ImportError);
  });
});
