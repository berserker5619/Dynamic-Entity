/**
 * The wizard's messages for the failures 3.1 adds (docs/3.1-spec.md, C2), through the real
 * transports: the built-in parser and `ngx-dynamic-entity/xlsx` in the browser, sheet-to-schema's
 * engine for a grouped plan there, and `HttpImportTransport` against a server's answers.
 *
 * `exceljs` is mocked as not installed for the whole file (a module mock covers a file), the way
 * Node fails for a missing package. jsdom has no `DecompressionStream`, so a workbook is
 * `UNSUPPORTED_RUNTIME` here unless a test lends it Node's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DecompressionStream as NodeDecompressionStream } from 'node:stream/web';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EntityFormConfig, MappingPlan } from '@dynamic-entity/core';
import { provideSheetFileParser } from '../../../xlsx/src/public-api';
import { DEFAULT_UI_TEXT } from '../services/ui-text.service';
import { IMPORT_TRANSPORT, SHEET_PARSER } from '../tokens/injection-tokens';
import { EntityImportComponent } from './entity-import.component';
import { HttpImportTransport } from './http-import-transport';
import type { ImportTransport } from './import-contracts';
import { LocalImportTransport } from './local-import-transport';

jest.mock('exceljs', () => {
  throw Object.assign(new Error("Cannot find module 'exceljs' from 'sheet-to-schema/dist/browser/index.js'"), { code: 'MODULE_NOT_FOUND' });
});

const CONFIG: EntityFormConfig = {
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
const GROUPED: MappingPlan = {
  planVersion: 2,
  target: 'people',
  schemaVersion: 1,
  entries: [{ ref: 'name', column: 0 }, { ref: 'phones.number', column: 1 }],
  group: { key: [0], collect: ['phones'] },
};
const WORKBOOK = readFileSync(join(__dirname, '../../../../core/test-fixtures/case5_non_latin.xlsx'));

/** A `File` with the byte and text readers a browser's has and jsdom's lacks. */
function fileOf(name: string, body: string | Uint8Array): File {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(buffer) });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(new TextDecoder().decode(bytes)) });
  return file;
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('the wizard says what went wrong, by code (3.1)', () => {
  let fixture: ComponentFixture<EntityImportComponent>;

  const mount = async (providers: unknown[] = []): Promise<void> => {
    await TestBed.configureTestingModule({ imports: [EntityImportComponent], providers: providers as never[] }).compileComponents();
    fixture = TestBed.createComponent(EntityImportComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();
  };
  const idle = async (): Promise<void> => {
    await fixture.whenStable();
    for (let turn = 0; turn < 200 && fixture.componentInstance['busy'](); turn++) await settle();
    await settle();
    fixture.detectChanges();
  };
  const choose = async (file: File): Promise<void> => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="import-file"]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await idle();
  };
  const commit = async (): Promise<void> => {
    fixture.nativeElement.querySelector('[data-testid="import-to-review"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="import-commit"]').click();
    await idle();
  };
  const problem = (): string => fixture.nativeElement.querySelector('[data-testid="import-problem"]')?.textContent?.trim() ?? '';
  const text = (key: keyof typeof DEFAULT_UI_TEXT, params: Record<string, string> = {}) =>
    Object.entries(params).reduce((out, [name, value]) => out.split(`{${name}}`).join(value), DEFAULT_UI_TEXT[key]);

  describe('a file the browser cannot read', () => {
    it('says a workbook needs saving as CSV, where the app reads CSV only', async () => {
      await mount();
      await choose(fileOf('book.xlsx', WORKBOOK));
      expect(problem()).toBe(text('importFormatXlsxNotRead'));
    });

    it('says an .xls needs saving as CSV, and UTF-16 as UTF-8, in a CSV-only app', async () => {
      await mount();
      await choose(fileOf('old.xls', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])));
      expect(problem()).toBe(text('importFormatXlsCsvOnly'));
      await choose(fileOf('wide.csv', Uint8Array.from([0xff, 0xfe, 0x61, 0x00])));
      expect(problem()).toBe(text('importFormatWideText'));
    });

    it('says an .xls can be saved as .xlsx too, and a zip is no workbook, where the app reads .xlsx', async () => {
      await mount([provideSheetFileParser()]);
      await choose(fileOf('old.xls', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])));
      expect(problem()).toBe(text('importFormatXls'));
      // An empty zip: its directory end record alone, which is no workbook. A browser that cannot
      // read a workbook says so first, whatever the zip holds, so this one can.
      (globalThis as { DecompressionStream?: unknown }).DecompressionStream = NodeDecompressionStream;
      try {
        await choose(fileOf('letter.docx', Uint8Array.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])));
        expect(problem()).toBe(text('importFormatNotWorkbook'));
      } finally {
        delete (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
      }
    });

    it('names the browsers that can read .xlsx, where this one has no deflate-raw (UNSUPPORTED_RUNTIME)', async () => {
      expect(globalThis.DecompressionStream).toBeUndefined();
      await mount([provideSheetFileParser()]);
      await choose(fileOf('book.xlsx', WORKBOOK));
      expect(problem()).toBe(text('importUnsupportedRuntime'));
      // And a CSV still imports, in the same browser.
      await choose(fileOf('people.csv', 'Name\nAda\n'));
      expect(problem()).toBe('');
      expect(fixture.nativeElement.querySelector('[data-testid="import-mapper"]')).toBeTruthy();
    });

    it('says which package to install, where exceljs is missing (PEER_MISSING)', async () => {
      (globalThis as { DecompressionStream?: unknown }).DecompressionStream = NodeDecompressionStream;
      try {
        await mount([provideSheetFileParser()]);
        await choose(fileOf('book.xlsx', WORKBOOK));
        expect(problem()).toBe(text('importPeerMissing', { peer: 'exceljs' }));
        // And a CSV still imports, which never needed it.
        await choose(fileOf('people.csv', 'Name\nAda\n'));
        expect(problem()).toBe('');
        expect(fixture.nativeElement.querySelector('[data-testid="import-mapper"]')).toBeTruthy();
      } finally {
        delete (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
      }
    });
  });

  it("does not call a workbook chunk that failed to download a missing package: it shows the browser's own error", async () => {
    // What a lazy chunk's failed download throws (sheet-to-schema passes it through, 1.2): the
    // package is installed and the network failed, so "install exceljs" would be wrong.
    const failed = new TypeError('Failed to fetch dynamically imported module: https://app.example/assets/exceljs.min-C8vHhlMF.js');
    const SHEET_PARSER_FAILING = { provide: SHEET_PARSER, useValue: () => Promise.reject(failed) };
    await mount([SHEET_PARSER_FAILING]);
    await choose(fileOf('book.xlsx', WORKBOOK));
    expect(problem()).toBe(failed.message);
    expect(problem()).not.toContain('install');
  });

  describe('a grouped plan in the browser, through LocalImportTransport', () => {
    /** The browser transport, with a grouped plan as its suggestion: grouped plans come from code in 3.1. */
    const grouped = { provide: IMPORT_TRANSPORT, deps: [], useFactory: () => groupingLocal() };
    const groupingLocal = (): ImportTransport => {
      const local = TestBed.inject(LocalImportTransport);
      return {
        accept: local.accept,
        preview: async (file, context) => ({ ...(await local.preview(file, context)), suggestion: GROUPED }),
        commit: (file, plan, context) => local.commit(file, plan, context),
        template: (spec, format) => local.template(spec, format),
      };
    };
    const rows = (lines: string[]) => fileOf('people.csv', ['Name,Number', ...lines].join('\n'));

    it('names the key and both rows when a group comes back (GROUP_NOT_CONTIGUOUS)', async () => {
      await mount([grouped]);
      await choose(rows(['Ada,111', 'Bo,222', 'Ada,333']));
      await commit();
      expect(problem()).toBe(text('importGroupNotContiguous', { key: 'Ada', ended: '2', again: '4' }));
    });

    it('names the key and rows of a group past 10,000 rows (GROUP_TOO_LARGE)', async () => {
      await mount([grouped]);
      await choose(rows(Array.from({ length: 10_001 }, (_, i) => `Ada,${i}`)));
      await commit();
      expect(problem()).toBe(text('importGroupTooLarge', { key: 'Ada', first: '2', last: '10002' }));
    });

    // By key bytes: past 200,000 groups is past the browser's 200,000-row limit, so that cap is
    // the server's to meet. 8 MiB of closed keys is reachable inside 10 MB and 200,000 rows.
    it('names the row where the group keys pass 8 MiB (TOO_MANY_GROUPS)', async () => {
      await mount([grouped]);
      const pad = 'k'.repeat(96);
      await choose(rows(Array.from({ length: 88_000 }, (_, i) => `${pad}${String(i).padStart(6, '0')},1`)));
      await commit();
      // Each closed key is its JSON tuple, ["k…000000"]: 106 bytes. The group whose close passes
      // 8 MiB is the (floor(8 MiB / 106) + 1)th, on that many rows after the header.
      const keyBytes = JSON.stringify([pad + '000000']).length;
      expect(problem()).toBe(text('importTooManyGroups', { row: String(Math.floor((8 * 1024 * 1024) / keyBytes) + 2) }));
    }, 120_000);
  });

  describe("a grouped plan over HTTP, by the server's answers", () => {
    const PREVIEW = { headers: ['Name', 'Number'], sample: [['Ada', '111']], suggestion: GROUPED, rowCount: 2, planVersions: [1, 2], engineVersion: '3.1.0' };
    const reply = (status: number, body: unknown): Response =>
      ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
    /** A server whose preview says `preview` and whose import answers `status` with `error`. */
    const server = (preview: Record<string, unknown>, status = 200, error?: Record<string, unknown>) => {
      const uploads: unknown[] = [];
      const fetch = (async (url: RequestInfo | URL) => {
        if (String(url).endsWith('/preview')) return reply(200, { ...PREVIEW, ...preview });
        uploads.push(url);
        return reply(status, { error });
      }) as unknown as typeof globalThis.fetch;
      return { uploads, provider: { provide: IMPORT_TRANSPORT, useValue: new HttpImportTransport({ baseUrl: '/api/import', fetch, warn: () => undefined }) } };
    };
    const upload = () => fileOf('people.csv', 'Name,Number\nAda,111\nAda,222\n');

    it('says the server does not group, before uploading, where its preview does not list "group"', async () => {
      const { uploads, provider } = server({});
      await mount([provider]);
      await choose(upload());
      await commit();
      expect(problem()).toBe(text('importServerCannotGroup'));
      expect(uploads).toEqual([]);
    });

    it.each([
      ['grouping-disabled', 'importServerCannotGroup'],
      ['non-contiguous', 'importGroupScatteredRefused'],
    ] as const)('says what a PLAN_GROUP refusal with reason %s means', async (reason, key) => {
      const details = [{ level: 'error', code: 'PLAN_GROUP', path: 'group', message: 'server words', reason }];
      const { provider } = server({ features: ['group'] }, 400, { code: 'INVALID_PLAN', message: 'server words', details });
      await mount([provider]);
      await choose(upload());
      await commit();
      expect(problem()).toBe(text(key));
    });

    it.each([
      [422, 'GROUP_NOT_CONTIGUOUS', { key: ['Ada'], rows: [3, 9] }, 'importGroupNotContiguous', { key: 'Ada', ended: '3', again: '9' }],
      [413, 'GROUP_TOO_LARGE', { key: ['Ada'], rows: [2, 10002] }, 'importGroupTooLarge', { key: 'Ada', first: '2', last: '10002' }],
      [413, 'TOO_MANY_GROUPS', { key: ['p'], rows: [200002] }, 'importTooManyGroups', { row: '200002' }],
    ] as const)('names the key and rows of a %i %s from the server', async (status, code, details, key, params) => {
      const { provider } = server({ features: ['group'] }, status, { code, message: 'server words', details });
      await mount([provider]);
      await choose(upload());
      await commit();
      expect(problem()).toBe(text(key, params));
    });

    it("shows a failure it does not know by its own message, as before 3.1", async () => {
      const { provider } = server({ features: ['group'] }, 500, { code: 'INTERNAL', message: 'The import could not be completed.' });
      await mount([provider]);
      await choose(upload());
      await commit();
      expect(problem()).toBe('The import could not be completed.');
    });
  });
});
