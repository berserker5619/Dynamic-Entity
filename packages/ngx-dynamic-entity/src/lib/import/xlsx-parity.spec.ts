/**
 * xlsx parity with the server.
 *
 * The workbook, the plan and the expected outcome are in `core/test-fixtures/xlsx-parity.ts`.
 * The server's `xlsx-parity.spec.ts` imports the same bytes through `runImport`, against the
 * same expectation.
 *
 * The browser has no workbook reader of its own: a consumer registers a typed `SheetParser`
 * (`import-contracts.ts:58`). The one below is what a consumer might write with exceljs — it is
 * test code, and exceljs is not a dependency of this package. It keeps cells typed and keeps
 * blank rows, which is what the contract asks of any parser.
 *
 * Covers: `LocalImportTransport.commit` (`local-import-transport.ts:91`) → the registered parser
 * → `applyMapping` (no `delimiter`, so `decimalMarkFor` gives `.`) → `coerceTypedCell`
 * (`import-engine.ts:334`: a `Date` by its UTC components). Run in every zone by
 * `check:timezones`.
 */
import { TestBed } from '@angular/core/testing';
import type { SheetGrid } from '@dynamic-entity/core';
import ExcelJS from 'exceljs';
import { SHEET_PARSER } from '../tokens/injection-tokens';
import { LocalImportTransport } from './local-import-transport';
import {
  PARITY_XLSX_CONFIG,
  PARITY_XLSX_EXPECTED,
  PARITY_XLSX_HEADERS,
  PARITY_XLSX_PLAN,
  PARITY_XLSX_SHA256,
  buildParityWorkbook,
  sha256,
} from '../../../../core/test-fixtures/xlsx-parity';

/** One exceljs cell value as the typed value a record is built from. */
function cellOf(value: ExcelJS.CellValue | undefined): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date || typeof value !== 'object') return value;
  if ('richText' in value) return value.richText.map(part => part.text).join('');
  if ('result' in value) return cellOf(value.result as ExcelJS.CellValue);
  if ('text' in value) return String(value.text);
  if ('error' in value) return String(value.error);
  return '';
}

/** A typed `SheetParser` over exceljs: first worksheet, row 1 as headers, gaps kept. */
async function exceljsParser(file: File): Promise<SheetGrid> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  // One-based, with a hole wherever a row is blank; each row one-based with a hole at 0.
  const rows = workbook.worksheets[0].getSheetValues() as (ExcelJS.CellValue[] | undefined)[];
  const cells = (row: ExcelJS.CellValue[] | undefined): unknown[] =>
    Array.from({ length: Math.max(0, (row?.length ?? 1) - 1) }, (_, i) => cellOf(row?.[i + 1]));
  const headers = cells(rows[1]).map(String);
  const data: unknown[][] = [];
  for (let i = 2; i < rows.length; i++) data.push(cells(rows[i]));
  return { headers, rows: data };
}

/** A `File` whose `arrayBuffer()` works under jsdom, which does not implement it. */
function workbookFile(bytes: Uint8Array): File {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file = new File([buffer], 'people.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(buffer) });
  return file;
}

describe('an xlsx import in the browser, against the shared parity workbook', () => {
  let bytes: Uint8Array;
  let local: LocalImportTransport;

  beforeAll(async () => {
    bytes = await buildParityWorkbook();
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: SHEET_PARSER, useValue: exceljsParser }] });
    local = TestBed.inject(LocalImportTransport);
  });

  it('reads the same bytes the server reads', () => {
    expect(sha256(bytes)).toBe(PARITY_XLSX_SHA256);
  });

  it('previews the headers the server reads', async () => {
    const preview = await local.preview(workbookFile(bytes), { config: PARITY_XLSX_CONFIG, lang: 'en' });
    expect(preview.headers).toEqual(PARITY_XLSX_HEADERS);
    expect(preview.delimiter).toBeUndefined();
  });

  it('produces the records and errors the server produces', async () => {
    const result = await local.commit(workbookFile(bytes), PARITY_XLSX_PLAN, {
      config: PARITY_XLSX_CONFIG,
      lang: 'en',
    });
    expect({ records: result.records, errors: result.errors, skipped: result.skipped }).toEqual(
      PARITY_XLSX_EXPECTED,
    );
  });
});
