import { TestBed } from '@angular/core/testing';
import type { EntityFormConfig, MappingPlan } from '@dynamic-entity/core';
import { SHEET_PARSER } from '../tokens/injection-tokens';
import { LocalImportTransport } from './local-import-transport';
import type { ImportContext } from './import-contracts';

const STATUS = [
  { en: 'Active', de: 'Aktiv' },
  { en: 'Inactive', de: 'Inaktiv' },
];

const CONFIG: EntityFormConfig = {
  entity: 'employees',
  version: 2,
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal' },
      fields: [
        { id: 'firstName', type: 'text', label: { en: 'First Name' }, validators: { required: true } },
        { id: 'status', type: 'dropdown', label: { en: 'Status' }, options: STATUS },
        { id: 'photo', type: 'image', label: { en: 'Photo' } },
      ],
    },
  ],
};

/** A `File` whose `text()` works under jsdom, which does not implement Blob.text. */
function csvFile(name: string, body: string): File {
  const file = new File([body], name, { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(body) });
  return file;
}

/** Reads a Blob under jsdom, which has FileReader but not Blob.text. */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const CONTEXT: ImportContext = { config: CONFIG, lang: 'en' };

describe('LocalImportTransport', () => {
  let transport: LocalImportTransport;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    transport = TestBed.inject(LocalImportTransport);
  });

  it('previews headers, a sample and a suggested mapping', async () => {
    const preview = await transport.preview(
      csvFile('p.csv', 'First Name,Status\nAlice,Active\nBob,Inactive'),
      CONTEXT,
    );

    expect(preview.headers).toEqual(['First Name', 'Status']);
    expect(preview.rowCount).toBe(2);
    expect(preview.suggestion.entries).toContainEqual(
      expect.objectContaining({ ref: 'personal.firstName', column: 0 }),
    );
  });

  it('commits a file into records through the same engine a server would use', async () => {
    const plan: MappingPlan = {
      entity: 'employees',
      entries: [
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.status', column: 1 },
      ],
    };
    const result = await transport.commit(csvFile('p.csv', 'a,b\nAlice,Aktiv'), plan, CONTEXT);

    expect(result.errors).toEqual([]);
    // Resolved to the option object, not the German text that was in the cell.
    expect((result.records[0] as any).personal.status).toEqual(STATUS[0]);
  });

  it('writes a CSV template of headers only', async () => {
    // Not headers plus a guidance row: CSV has one header row, so guidance inside the file
    // comes back as a record and fails row 2 of every re-import.
    const spec = {
      entity: 'employees',
      sheetName: 'Employees',
      columns: [
        { ref: 'a', scope: '(root)', field: {} as never, header: 'First Name', required: true },
      ],
      notes: ['Required'],
      unsupported: [],
    };
    const text = await blobText(await transport.template(spec, 'csv'));
    expect(text).toBe('First Name');
  });

  it('refuses xlsx rather than handing back CSV under an xlsx name', async () => {
    const spec = { entity: 'e', sheetName: 's', columns: [], notes: [], unsupported: [] };
    await expect(transport.template(spec, 'xlsx')).rejects.toThrow(/only write CSV/);
  });

  it('parses one file once, however many times the wizard asks', async () => {
    // A run reads the same file to show its headers and again to import it. This is the
    // transport whose stated limit is holding the file in memory, so doing it twice doubled
    // the cost of the one implementation that can least afford it.
    let parses = 0;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SHEET_PARSER,
          useValue: () => {
            parses++;
            return { headers: ['First Name'], rows: [['Alice']] };
          },
        },
      ],
    });

    const local = TestBed.inject(LocalImportTransport);
    const file = csvFile('p.csv', 'First Name\nAlice');

    const preview = await local.preview(file, CONTEXT);
    await local.commit(file, preview.suggestion, CONTEXT);

    expect(parses).toBe(1);
  });

  it('does not remember a parse that failed, so a fixed file can be retried', async () => {
    let attempt = 0;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SHEET_PARSER,
          useValue: () => {
            attempt++;
            if (attempt === 1) throw new Error('malformed');
            return { headers: ['First Name'], rows: [['Alice']] };
          },
        },
      ],
    });

    const local = TestBed.inject(LocalImportTransport);
    const file = csvFile('p.csv', 'anything');

    await expect(local.preview(file, CONTEXT)).rejects.toThrow('malformed');
    // The same File object again: a cached rejection would make the retry fail forever.
    await expect(local.preview(file, CONTEXT)).resolves.toMatchObject({ rowCount: 1 });
  });

  it('uses a registered sheet parser instead of the built-in one', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SHEET_PARSER,
          useValue: () => ({ headers: ['First Name'], rows: [['FromParser']] }),
        },
      ],
    });
    const preview = await TestBed.inject(LocalImportTransport).preview(
      csvFile('anything.xlsx', ''),
      CONTEXT,
    );
    expect(preview.sample).toEqual([['FromParser']]);
  });
});
