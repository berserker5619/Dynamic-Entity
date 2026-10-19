/**
 * The HTTP transport and the server it is talking to (spec §4, "Talking to an older server").
 *
 * Since 3.0 the mapper writes mapping plan v2. A 2.x server reads every plan as v1 and ignores
 * what it does not know, so the transport has to know which kind it previewed with before it
 * commits: it sends such a server the plan in 2.x form, and refuses to send it a plan that
 * only a v2 reader would get right.
 */
import { CORE_VERSION, type EntityFormConfig, type MappingPlan, type MappingPlanV1 } from '@dynamic-entity/core';
import { HttpImportTransport, type ImportCapabilityError } from './http-import-transport';
import type { ImportContext } from './import-contracts';

const CONFIG: EntityFormConfig = {
  entity: 'employee',
  version: 3,
  tabs: [{ id: 'personal', label: { en: 'Personal' }, fields: [{ id: 'firstName', type: 'text', label: { en: 'First Name' } }] }],
};
const CONTEXT: ImportContext = { config: CONFIG };
const entries = [{ ref: 'personal.firstName', column: 0, header: 'name' }];
const PLAN_V2: MappingPlan = { planVersion: 2, target: 'employee', schemaVersion: 3, sourceHeaders: ['name'], entries };
const PLAN_V1: MappingPlanV1 = { entity: 'employee', configVersion: 3, sourceHeaders: ['name'], entries };
const GROUPED: MappingPlan = { ...PLAN_V2, group: { key: [0], collect: ['personal.phones'] } };

const PREVIEW = { headers: ['name'], sample: [['Alice']], suggestion: PLAN_V2, rowCount: 1, engineVersion: CORE_VERSION };
const COMMIT = { written: true, imported: 1, skipped: 0, failed: 0, rowsRead: 1, errors: [], errorCount: 0, truncated: false, planProblems: [], engineVersion: CORE_VERSION };

const reply = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const file = (): File => new File(['name\nAlice'], 'people.csv', { type: 'text/csv' });

/** A server that answers a preview and a commit as told, and what it was sent as the plan. */
function server(preview: Record<string, unknown> = {}, commit: Record<string, unknown> = {}) {
  const plans: unknown[] = [];
  const warnings: string[] = [];
  const fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    if (String(url).endsWith('/preview')) return reply({ ...PREVIEW, ...preview });
    plans.push(JSON.parse(String((init.body as FormData).get('plan'))));
    return reply({ ...COMMIT, ...commit });
  }) as unknown as typeof globalThis.fetch;
  const transport = new HttpImportTransport({ baseUrl: '/api/import', fetch, warn: message => warnings.push(message) });
  return { transport, plans, warnings };
}

describe('HttpImportTransport — the plan it sends, by what the server reads', () => {
  it('sends plan v2 as written to a server that says it reads v2', async () => {
    const { transport, plans } = server({ planVersions: [1, 2] });
    const upload = file();
    await transport.preview(upload, CONTEXT);
    await transport.commit(upload, PLAN_V2, CONTEXT);
    expect(plans).toEqual([PLAN_V2]);
  });

  it('sends the same mapping in 2.x form to a server that does not say, which is a 2.x server', async () => {
    const { transport, plans } = server();
    const upload = file();
    await transport.preview(upload, CONTEXT);
    await transport.commit(upload, PLAN_V2, CONTEXT);
    expect(plans).toEqual([PLAN_V1]);
    expect(plans[0]).not.toHaveProperty('planVersion');
    expect(plans[0]).not.toHaveProperty('target');
  });

  it('sends a stored 2.x plan as it is, to either', async () => {
    for (const planVersions of [undefined, [1], [1, 2]]) {
      const { transport, plans } = server({ planVersions });
      const upload = file();
      await transport.preview(upload, CONTEXT);
      await transport.commit(upload, PLAN_V1, CONTEXT);
      expect(plans).toEqual([PLAN_V1]);
    }
  });

  it('refuses to commit a plan that groups rows to a server that would ignore the grouping', async () => {
    const { transport, plans } = server();
    const upload = file();
    await transport.preview(upload, CONTEXT);
    await expect(transport.commit(upload, GROUPED, CONTEXT)).rejects.toThrow(/uses group, which the import server does not read.*Nothing was imported.*Upgrade the server/);
    expect(plans).toEqual([]);
  });

  it('refuses a per-column date order and a split the same way, naming each', async () => {
    const { transport, plans } = server({ planVersions: [1] });
    const upload = file();
    await transport.preview(upload, CONTEXT);
    const plan: MappingPlan = { ...PLAN_V2, entries: [{ ref: 'personal.born', column: 0, dateOrder: 'DMY' }, { ref: 'personal.tags', column: 1, split: ';' }] };
    await expect(transport.commit(upload, plan, CONTEXT)).rejects.toThrow('entries[0].dateOrder, entries[1].split');
    expect(plans).toEqual([]);
  });

  // 3.0 sent a grouped plan to any server reading v2, which then refused it after the upload.
  // From 3.1 it goes only where the preview says "group" (docs/3.1-spec.md, Feature C), and the
  // four servers of that table are run for real by scripts/check-transport-servers.mjs.
  describe('a grouped plan, by what the server says it can do (3.1)', () => {
    const refusalOf = async (preview: Record<string, unknown>) => {
      const { transport, plans } = server(preview);
      const upload = file();
      await transport.preview(upload, CONTEXT);
      const error = await transport.commit(upload, GROUPED, CONTEXT).then(
        () => undefined,
        (thrown: unknown) => thrown as ImportCapabilityError,
      );
      return { error, plans };
    };

    it('is sent to a server whose preview lists "group" (DE 3.1 with grouping on)', async () => {
      const { error, plans } = await refusalOf({ planVersions: [1, 2], features: ['group'] });
      expect(error).toBeUndefined();
      expect(plans).toEqual([GROUPED]);
    });

    it.each([
      ['DE 3.1 by default, or DE 3.0 (no features)', {}],
      ['a server listing other features', { features: ['something-else'] }],
      ['a features that is not a list', { features: 'group' }],
    ])('is refused before upload by %s, saying grouping is what it lacks', async (_, extra) => {
      const { error, plans } = await refusalOf({ planVersions: [1, 2], ...extra });
      expect(plans).toEqual([]);
      expect(error).toMatchObject({ name: 'ImportCapabilityError', code: 'UNSUPPORTED_BY_SERVER', refused: ['group'], feature: 'group' });
      expect(error?.message).toMatch(/does not import grouped plans.*Nothing was imported.*grouping: true.*or import this file in the browser/);
    });

    it('is refused before upload by DE 2.x (planVersions [1] or none), as in 3.0, with no feature', async () => {
      for (const preview of [{}, { planVersions: [1] }]) {
        const { error, plans } = await refusalOf({ ...preview, features: undefined });
        expect(plans).toEqual([]);
        expect(error).toMatchObject({ code: 'UNSUPPORTED_BY_SERVER', refused: ['group'] });
        expect(error).not.toHaveProperty('feature');
        expect(error?.message).toMatch(/before mapping plan v2/);
      }
    });

    it('names every v2-only field to a 2.x server, grouping among them, as the server would ignore them all', async () => {
      const { transport } = server();
      const upload = file();
      await transport.preview(upload, CONTEXT);
      const plan = { ...GROUPED, entries: [{ ...entries[0], dateOrder: 'DMY' as const }] };
      const error = (await transport.commit(upload, plan, CONTEXT).catch((thrown: unknown) => thrown)) as ImportCapabilityError;
      expect(error.refused).toEqual(['group', 'entries[0].dateOrder']);
      expect(error).not.toHaveProperty('feature');
    });

    it('leaves a plan without grouping as it was, whatever the features', async () => {
      for (const features of [undefined, ['group']]) {
        const { transport, plans } = server({ planVersions: [1, 2], features });
        const upload = file();
        await transport.preview(upload, CONTEXT);
        await transport.commit(upload, PLAN_V2, CONTEXT);
        expect(plans).toEqual([PLAN_V2]);
      }
    });
  });

  it('treats a file it never previewed as one for a server that reads only 2.x plans', async () => {
    const { transport, plans } = server({ planVersions: [1, 2] });
    await transport.commit(file(), PLAN_V2, CONTEXT);
    expect(plans).toEqual([PLAN_V1]);
    await expect(transport.commit(file(), GROUPED, CONTEXT)).rejects.toThrow(/does not read/);
  });

  it('takes a planVersions that is not a list to be none', async () => {
    const { transport, plans } = server({ planVersions: '1,2' });
    const upload = file();
    await transport.preview(upload, CONTEXT);
    await transport.commit(upload, PLAN_V2, CONTEXT);
    expect(plans).toEqual([PLAN_V1]);
  });
});

describe('HttpImportTransport — the adapter the server runs', () => {
  const [major] = CORE_VERSION.split('.');

  it('says nothing when it is this adapter at this major version, whatever the rest', async () => {
    const adapter = { name: 'dynamic-entity', version: `${major}.99.0` };
    const { transport, warnings } = server({ adapter }, { adapter });
    const upload = file();
    await transport.preview(upload, CONTEXT);
    await transport.commit(upload, PLAN_V1, CONTEXT);
    expect(warnings).toEqual([]);
  });

  it('says nothing to a server from before 3.0, which names no adapter', async () => {
    const { transport, warnings } = server();
    await transport.preview(file(), CONTEXT);
    expect(warnings).toEqual([]);
  });

  it('warns when the server runs this adapter at another major version', async () => {
    const adapter = { name: 'dynamic-entity', version: `${Number(major) + 1}.0.0` };
    const { transport, warnings } = server({ adapter });
    await transport.preview(file(), CONTEXT);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`dynamic-entity ${Number(major) + 1}.0.0`);
    expect(warnings[0]).toContain(`expects dynamic-entity ${major}.x`);
  });

  it('warns when the server runs another adapter altogether, on a commit too', async () => {
    const adapter = { name: 'json-schema', version: CORE_VERSION };
    const { transport, warnings } = server({ planVersions: [1, 2] }, { adapter });
    const upload = file();
    await transport.preview(upload, CONTEXT);
    await transport.commit(upload, PLAN_V2, CONTEXT);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('json-schema');
  });

  it('warns about a stamp that carries no version', async () => {
    const { transport, warnings } = server({ adapter: { name: 'dynamic-entity' } });
    await transport.preview(file(), CONTEXT);
    expect(warnings).toHaveLength(1);
  });
});

describe('HttpImportTransport — warnings a 3.0 server sends', () => {
  it('carries them through, and leaves the field out when there are none', async () => {
    const warned = [{ row: 2, rows: [2, 3], ref: 'city', code: 'RECORD_GROUP_CONFLICT', message: 'Rows disagree.' }];
    const withWarnings = server({ planVersions: [1, 2] }, { warnings: warned, warningCount: 1 });
    const upload = file();
    await withWarnings.transport.preview(upload, CONTEXT);
    expect((await withWarnings.transport.commit(upload, PLAN_V2, CONTEXT)).warnings).toEqual(warned);

    const without = server({ planVersions: [1, 2] }, { warnings: [], warningCount: 0 });
    const other = file();
    await without.transport.preview(other, CONTEXT);
    expect(await without.transport.commit(other, PLAN_V2, CONTEXT)).not.toHaveProperty('warnings');
  });
});
