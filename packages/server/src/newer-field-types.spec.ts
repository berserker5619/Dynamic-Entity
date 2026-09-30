import {
  applyMapping,
  deriveImportColumns,
  parseCsv,
  suggestMapping,
  type EntityFormConfig,
} from '@dynamic-entity/core';
import { runImport } from './run-import';
import { chunked } from './sheet.fixtures';
import { synthesiseCsv } from './config-rows.fixtures';

/**
 * The six newer field types through a streamed server import, against the browser path.
 *
 * `all-configs.spec.ts` covers every type the reference configs use, and none of them use
 * these yet. Without this, a server import of a `tags` column would be checked by nothing.
 */
const CONFIG: EntityFormConfig = {
  entity: 'profile',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      fields: [
        { id: 'site', type: 'url', label: { en: 'Website' }, validators: { url: true } },
        { id: 'tel', type: 'phone', label: { en: 'Phone' }, validators: { phone: true } },
        { id: 'volume', type: 'slider', label: { en: 'Volume' }, validators: { min: 0, max: 10 } },
        { id: 'score', type: 'rating', label: { en: 'Score' } },
        { id: 'brand', type: 'color', label: { en: 'Brand' } },
        { id: 'labels', type: 'tags', label: { en: 'Labels' }, validators: { maxLength: 3 } },
      ],
    },
  ],
};

const HEADERS = ['Website', 'Phone', 'Volume', 'Score', 'Brand', 'Labels'];

const CSV = [
  HEADERS.join(','),
  'https://example.com,+1 555 555 0123,7,4,ABC,red;blue',
  'example.com,12,11,6,teal,a;b;c;d',
  '',
].join('\r\n');

describe('the newer field types through a server import', () => {
  const columns = deriveImportColumns(CONFIG).columns;
  const plan = suggestMapping(HEADERS, columns, 'profile');

  it('maps every column by its header', () => {
    expect(plan.entries.map(e => e.ref).sort()).toEqual(
      ['main.brand', 'main.labels', 'main.score', 'main.site', 'main.tel', 'main.volume'].sort(),
    );
  });

  it('stores each value in the shape the form holds, and agrees with the browser', async () => {
    const records: Record<string, unknown>[] = [];
    const server = await runImport({
      stream: chunked(CSV, 5),
      plan,
      config: CONFIG,
      onBatch: batch => {
        records.push(...batch);
      },
    });
    const browser = applyMapping(parseCsv(CSV).rows, plan, CONFIG);

    expect(records).toEqual(browser.records);
    expect(server.errors).toEqual(browser.errors);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      main: {
        site: 'https://example.com',
        tel: '+1 555 555 0123',
        volume: 7,
        score: 4,
        brand: '#aabbcc',
        labels: ['red', 'blue'],
      },
    });
  });

  it('refuses the bad row with a reason for each cell', async () => {
    const server = await runImport({ stream: chunked(CSV), plan, config: CONFIG });
    const reasons = server.errors.filter(e => e.row === 3).map(e => `${e.ref}: ${e.message}`);

    expect(reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^main\.volume: .*outside 0 to 10/),
        expect.stringMatching(/^main\.score: .*whole number from 1 to 5/),
        expect.stringMatching(/^main\.brand: .*not a colour/),
      ]),
    );
  });

  it('checks the declared validators once every cell coerces', async () => {
    const csv = [HEADERS.join(','), 'example.com,12,5,3,#000000,a;b;c;d', ''].join('\r\n');
    const server = await runImport({ stream: chunked(csv), plan, config: CONFIG });
    const reasons = server.errors.map(e => e.message);

    expect(reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('not a valid web address'),
        expect.stringContaining('not a valid phone number'),
        expect.stringContaining('at most 3 items'),
      ]),
    );
  });

  it('can be fed by the synthesised row the other suites use', async () => {
    const records: Record<string, unknown>[] = [];
    const server = await runImport({
      stream: chunked(synthesiseCsv(columns, 1)),
      plan: suggestMapping(
        columns.map(c => c.header),
        columns,
        'profile',
      ),
      config: CONFIG,
      onBatch: batch => {
        records.push(...batch);
      },
    });
    expect(server.errors).toEqual([]);
    expect(records).toHaveLength(1);
  });
});
