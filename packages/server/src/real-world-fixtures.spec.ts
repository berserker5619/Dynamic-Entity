import fs from 'node:fs';
import path from 'node:path';
import { runImport } from './run-import';
import { readSheet } from './read-sheet';
import { chunked } from './sheet.fixtures';
import type { EntityFormConfig, MappingPlanV1 } from '@dynamic-entity/core';

const FIXTURES_DIR = path.resolve(__dirname, '../../core/test-fixtures');

describe('real-world fixtures through server import path', () => {
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

    const records: Record<string, unknown>[] = [];
    const result = await runImport({
      stream: chunked(bytes, 1024),
      filename: 'case1_1904_dates.xlsx',
      plan,
      config,
      lang: 'en',
      onBatch: batch => {
        records.push(...batch);
      },
    });

    expect(result.errors).toEqual([]);
    expect(records).toEqual([
      { name: 'Alice Mac', birthDate: '2026-05-15', joinDate: '1904-01-02', _configVersion: 1 },
      { name: 'Bob Mac', birthDate: '1985-10-26', joinDate: '2020-03-01', _configVersion: 1 },
    ]);
  });

  it('case2_numeric_identifiers: unsafe integer guard on server path', async () => {
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

    const records: Record<string, unknown>[] = [];
    const result = await runImport({
      stream: chunked(bytes, 1024),
      filename: 'case2_numeric_identifiers.xlsx',
      plan,
      config,
      lang: 'en',
      onBatch: batch => {
        records.push(...batch);
      },
    });

    // Row 2: 1234567890123456 is below MAX_SAFE_INTEGER -> imports exactly as string
    expect(records).toEqual([
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
    // Generate an xlsx in memory with 9876543210987653 and 1234567890123456
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['ID', 'Count']);
    ws.addRow([Number('9876543210987653'), Number('9876543210987653')]);
    ws.addRow([1234567890123456, 1234567890123456]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());

    const stringConfig: EntityFormConfig = {
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

    const records: Record<string, unknown>[] = [];
    const result = await runImport({
      stream: chunked(bytes, 1024),
      filename: 'unsafe.xlsx',
      plan,
      config: stringConfig,
      lang: 'en',
      onBatch: batch => {
        records.push(...batch);
      },
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
    expect(records).toEqual([
      { id: '1234567890123456', count: 1234567890123456, _configVersion: 1 },
    ]);
  });

  it('case4_complex_sheet: reads merged headers with covered cell as empty string', async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES_DIR, 'case4_complex_sheet.xlsx'));
    const sheet = await readSheet({ stream: chunked(bytes, 1024), filename: 'case4_complex_sheet.xlsx' });

    // Merged cell A1:B1 ("Customer Info"): master is A1, covered cell B1 is ''
    expect(sheet.headers).toEqual([
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
