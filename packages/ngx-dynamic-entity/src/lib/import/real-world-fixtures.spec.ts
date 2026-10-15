import fs from 'node:fs';
import path from 'node:path';
import { TestBed } from '@angular/core/testing';
import type { EntityFormConfig, MappingPlanV1, SheetGrid } from '@dynamic-entity/core';
import ExcelJS from 'exceljs';
import { SHEET_PARSER } from '../tokens/injection-tokens';
import { LocalImportTransport } from './local-import-transport';

const FIXTURES_DIR = path.resolve(__dirname, '../../../../core/test-fixtures');

function cellOf(value: ExcelJS.CellValue | undefined): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date || typeof value !== 'object') return value;
  if ('richText' in value) return value.richText.map(part => part.text).join('');
  if ('result' in value) return cellOf(value.result as ExcelJS.CellValue);
  if ('text' in value) return String(value.text);
  if ('error' in value) return String(value.error);
  return '';
}

/** Contract-following typed SheetParser over ExcelJS */
async function contractExceljsParser(file: File): Promise<SheetGrid> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const ws = workbook.worksheets[0];
  const rows = ws.getSheetValues() as (ExcelJS.CellValue[] | undefined)[];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 1; c < row.length; c++) {
      const cell = ws.getCell(r, c);
      if (cell.isMerged && cell.master.address !== cell.address) {
        row[c] = '';
      }
    }
  }
  const cells = (row: ExcelJS.CellValue[] | undefined): unknown[] =>
    Array.from({ length: Math.max(0, (row?.length ?? 1) - 1) }, (_, i) => cellOf(row?.[i + 1]));
  const headers = cells(rows[1]).map(String);
  const data: unknown[][] = [];
  for (let i = 2; i < rows.length; i++) data.push(cells(rows[i]));
  return { headers, rows: data };
}

function toFile(bytes: Uint8Array, name: string): File {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file = new File([buffer], name);
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(buffer) });
  return file;
}

describe('real-world fixtures through browser import path', () => {
  let local: LocalImportTransport;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: SHEET_PARSER, useValue: contractExceljsParser }],
    });
    local = TestBed.inject(LocalImportTransport);
  });

  it('case1_1904_dates: imports Mac Excel 1904 dates without epoch drift', async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES_DIR, 'case1_1904_dates.xlsx'));
    const config: EntityFormConfig = {
      entity: 'people',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          flatData: true,
          fields: [
            { id: 'name', type: 'text', label: { en: 'Name' } },
            { id: 'birthDate', type: 'date', label: { en: 'BirthDate' } },
            { id: 'joinDate', type: 'date', label: { en: 'JoinDate' } },
          ],
        },
      ],
    };
    const plan: MappingPlanV1 = {
      entity: 'people',
      entries: [
        { ref: 'name', column: 0 },
        { ref: 'birthDate', column: 1 },
        { ref: 'joinDate', column: 2 },
      ],
    };

    const result = await local.commit(toFile(bytes, 'case1_1904_dates.xlsx'), plan, {
      config,
      lang: 'en',
    });

    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { name: 'Alice Mac', birthDate: '2026-05-15', joinDate: '1904-01-02', _configVersion: 1 },
      { name: 'Bob Mac', birthDate: '1985-10-26', joinDate: '2020-03-01', _configVersion: 1 },
    ]);
  });

  it('case2_numeric_identifiers: unsafe integer guard on browser path', async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES_DIR, 'case2_numeric_identifiers.xlsx'));
    const config: EntityFormConfig = {
      entity: 'records',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          flatData: true,
          fields: [
            { id: 'name', type: 'text', label: { en: 'Name' } },
            { id: 'phone', type: 'text', label: { en: 'Phone' } },
            { id: 'nationalId', type: 'text', label: { en: 'NationalID' } },
            { id: 'itemCount', type: 'number', label: { en: 'ItemCount' } },
          ],
        },
      ],
    };
    const plan: MappingPlanV1 = {
      entity: 'records',
      entries: [
        { ref: 'name', column: 0 },
        { ref: 'phone', column: 1 },
        { ref: 'nationalId', column: 2 },
        { ref: 'itemCount', column: 4 },
      ],
    };

    const result = await local.commit(toFile(bytes, 'case2_numeric_identifiers.xlsx'), plan, {
      config,
      lang: 'en',
    });

    // Row 2: 1234567890123456 is below MAX_SAFE_INTEGER -> imports exactly as string
    expect(result.records).toEqual([
      { name: 'Alice', phone: '9876543210', nationalId: '1234567890123456', itemCount: 42, _configVersion: 1 },
    ]);
    // Row 3: 9876543210987654 exceeds MAX_SAFE_INTEGER -> flagged with CELL_FORMAT
    expect(result.errors).toEqual([
      {
        row: 3,
        column: 2,
        ref: 'nationalId',
        code: 'CELL_FORMAT',
        message: 'too many digits to read exactly; format the column as Text in the source file',
        raw: 9876543210987654,
      },
    ]);
  });

  it('reports CELL_FORMAT for 9876543210987653 (odd, above limit) to string field; allows for numeric field', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['ID', 'Count']);
    ws.addRow([Number('9876543210987653'), Number('9876543210987653')]);
    ws.addRow([1234567890123456, 1234567890123456]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());

    const config: EntityFormConfig = {
      entity: 'e',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          flatData: true,
          fields: [
            { id: 'id', type: 'text', label: { en: 'ID' } },
            { id: 'count', type: 'number', label: { en: 'Count' } },
          ],
        },
      ],
    };
    const plan: MappingPlanV1 = {
      entity: 'e',
      entries: [
        { ref: 'id', column: 0 },
        { ref: 'count', column: 1 },
      ],
    };

    const result = await local.commit(toFile(bytes, 'unsafe.xlsx'), plan, {
      config,
      lang: 'en',
    });

    // 9876543210987653 to string field fails with CELL_FORMAT
    expect(result.errors).toEqual([
      {
        row: 2,
        column: 0,
        ref: 'id',
        code: 'CELL_FORMAT',
        message: 'too many digits to read exactly; format the column as Text in the source file',
        raw: Number('9876543210987653'),
      },
    ]);
    // 1234567890123456 imports cleanly
    expect(result.records).toEqual([
      { id: '1234567890123456', count: 1234567890123456, _configVersion: 1 },
    ]);
  });

  it('case4_complex_sheet: reads merged headers with covered cell as empty string', async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES_DIR, 'case4_complex_sheet.xlsx'));
    const preview = await local.preview(toFile(bytes, 'case4_complex_sheet.xlsx'), {
      config: { entity: 'test', tabs: [] },
      lang: 'en',
    });

    // Merged cell A1:B1 ("Customer Info"): master is A1, covered cell B1 is ''
    expect(preview.headers).toEqual([
      'Customer Info',
      '',
      'Qty',
      'Price',
      'Total',
      'Secret',
      'Status',
      'Status',
    ]);
  });
});
