import { TestBed } from '@angular/core/testing';
import type { EntityFormConfig, MappingPlan } from '@dynamic-entity/core';
import { SHEET_PARSER } from '../tokens/injection-tokens';
import { LocalImportTransport } from './local-import-transport';
import type { ImportContext } from './import-contracts';
import { PREVIEW_PARITY_CASES, suggestedEntries } from '../../../../core/test-fixtures/preview-parity';

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

/**
 * Preview parity with the server. Every case in `core/test-fixtures/preview-parity.ts` also runs
 * through the server's `previewSheet` in `server/src/run-import.spec.ts`, against the same
 * `expected`, so a plan made in one wizard fits the other.
 *
 * Covers: `LocalImportTransport.preview` (`local-import-transport.ts:73`) →
 * `defaultSheetParser` (`sheet-parser.ts`, `.tsv` forced to tabs, otherwise `parseCsv`'s
 * `detectDelimiter`) → `arrayBoundFor` → `deriveImportColumns` → `suggestMapping`, with the
 * sample rendered by `cellText`.
 */
describe('LocalImportTransport.preview, against the shared parity cases', () => {
  for (const parity of PREVIEW_PARITY_CASES) {
    it(parity.name, async () => {
      TestBed.configureTestingModule({});
      const preview = await TestBed.inject(LocalImportTransport).preview(csvFile(parity.filename, parity.text), {
        config: parity.config,
        lang: 'en',
      });

      expect({
        headers: preview.headers,
        sample: preview.sample,
        rowCount: preview.rowCount,
        delimiter: preview.delimiter,
        arrayBound: preview.arrayBound,
        suggestion: suggestedEntries(preview.suggestion),
      }).toEqual(parity.expected);
      expect(preview.suggestion.entity).toBe(parity.config.entity);
    });
  }
});

/**
 * Commit parity with the server, for the shared cases that carry a plan. The same plans and
 * the same `expectedCommit` run through `runImport` in `server/src/run-import.spec.ts`.
 *
 * Covers: `LocalImportTransport.commit` (`local-import-transport.ts:91`) → `applyMapping` with
 * `decimal: decimalMarkFor(sheet.delimiter)` (`csv.ts:285`) → `coerceCell` → `parseNumberText`
 * (`import-engine.ts:262`, `NUMERIC_COMMA` for a `,` decimal mark). The browser has no unit test
 * of its own for the decimal comma otherwise; the server's is `run-import.spec.ts`
 * "imports it with a decimal comma, so 1,500 is one and a half".
 */
describe('LocalImportTransport.commit, against the shared parity cases', () => {
  for (const parity of PREVIEW_PARITY_CASES) {
    if (!parity.plan || !parity.expectedCommit) continue;
    const { plan, expectedCommit } = parity;
    it(parity.name, async () => {
      TestBed.configureTestingModule({});
      const result = await TestBed.inject(LocalImportTransport).commit(csvFile(parity.filename, parity.text), plan, {
        config: parity.config,
        lang: 'en',
      });
      expect({ records: result.records, errors: result.errors }).toEqual(expectedCommit);
    });
  }
});

/**
 * A parser that keeps cell types — what a workbook library produces when asked to. The date is
 * built with `Date.UTC`, which is how a workbook stores a calendar date and how the server's
 * reader hands one over, so the result is the same in every timezone this runs in.
 */
describe('LocalImportTransport with a typed parser', () => {
  const TYPED: EntityFormConfig = {
    entity: 'people',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        flatData: true,
        fields: [
          { id: 'born', type: 'date', label: { en: 'Born' } },
          { id: 'score', type: 'number', label: { en: 'Score' } },
          { id: 'active', type: 'boolean', label: { en: 'Active' } },
        ],
      },
    ],
  };
  const PLAN_TYPED: MappingPlan = {
    entity: 'people',
    entries: [
      { ref: 'born', column: 0 },
      { ref: 'score', column: 1 },
      { ref: 'active', column: 2 },
    ],
  };

  let local: LocalImportTransport;
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SHEET_PARSER,
          useValue: () => ({
            headers: ['Born', 'Score', 'Active'],
            rows: [[new Date(Date.UTC(2024, 2, 7)), 1234.5, true]],
          }),
        },
      ],
    });
    local = TestBed.inject(LocalImportTransport);
  });

  it('imports a date cell as the calendar date it is, as the server would', async () => {
    const file = csvFile('people.xlsx', '');
    const result = await local.commit(file, PLAN_TYPED, { config: TYPED });
    expect(result.errors).toEqual([]);
    expect(result.records[0]).toMatchObject({ born: '2024-03-07', score: 1234.5, active: true });
  });

  it('shows that date in the sample as a date, not a timestamp', async () => {
    const preview = await local.preview(csvFile('people.xlsx', ''), { config: TYPED });
    expect(preview.sample).toEqual([['2024-03-07', '1234.5', 'true']]);
  });
});
