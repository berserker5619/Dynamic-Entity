/**
 * xlsx-parity.ts — one workbook both import paths must read the same way.
 *
 * The server reads a workbook with its own reader (`server/src/xlsx-source.ts`). The browser
 * has none; a consumer registers a typed `SheetParser`. Both hand typed cells to the same
 * `applyMapping`, so the same bytes must produce the same records and errors. Each package
 * rebuilds the workbook here and checks the bytes against `PARITY_XLSX_SHA256` before reading
 * them, so "the same bytes" is checked rather than assumed — and no binary is committed.
 *
 * Deterministic by construction: exceljs stamps the current time on every zip entry, so its
 * output is re-packed with JSZip at a fixed date, with fixed workbook properties. The result is
 * the same in Node and in jsdom, and in every timezone `check:timezones` runs.
 *
 * Test-only. exceljs and JSZip are server dependencies, resolved from the workspace root; no
 * package gains a runtime dependency.
 */

import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { EntityFormConfig, ImportRowError, MappingPlan } from '../src/index';

export const PARITY_XLSX_CONFIG: EntityFormConfig = {
  entity: 'people',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      flatData: true,
      fields: [
        { id: 'name', type: 'text', label: { en: 'Name' } },
        { id: 'born', type: 'date', label: { en: 'Born' } },
        { id: 'score', type: 'number', label: { en: 'Score' } },
        { id: 'active', type: 'boolean', label: { en: 'Active' } },
        { id: 'joined', type: 'datetime', label: { en: 'Joined' } },
        {
          id: 'phones',
          type: 'array',
          label: { en: 'Phone' },
          children: [{ id: 'number', type: 'text', label: { en: 'Number' } }],
        },
      ],
    },
  ],
};

export const PARITY_XLSX_HEADERS = ['Name', 'Born', 'Score', 'Active', 'Joined', 'Phone 1', 'Phone 2'];

export const PARITY_XLSX_PLAN: MappingPlan = {
  entity: 'people',
  entries: ['name', 'born', 'score', 'active', 'joined', 'phones.0.number', 'phones.1.number'].map(
    (ref, column) => ({ ref, column }),
  ),
};

/**
 * Data rows by spreadsheet row number. Row 4 is left blank, so both paths must keep the gap:
 * exceljs does not emit an empty row, and a reader that closed it up would shift `Cy`'s row
 * number in the error and disagree about `skipped`.
 */
const ROWS: Record<number, unknown[]> = {
  2: ['Ada', new Date(Date.UTC(2024, 2, 7)), 1234.5, true, new Date(Date.UTC(2024, 2, 7, 15, 30)), '111', '222'],
  // A calendar date on the first of the year: read with local getters west of Greenwich, it
  // would be the last day of 2023.
  3: ['Bo', new Date(Date.UTC(2024, 0, 1)), 3, false, new Date(Date.UTC(2023, 11, 31, 23, 59)), '333'],
  5: ['Cy', new Date(Date.UTC(2024, 1, 29)), 'n/a', true],
};

/** What committing `PARITY_XLSX_PLAN` over the workbook must produce, on both sides. */
export const PARITY_XLSX_EXPECTED: {
  records: Record<string, unknown>[];
  errors: ImportRowError[];
  skipped: number;
} = {
  records: [
    {
      name: 'Ada',
      born: '2024-03-07',
      score: 1234.5,
      active: true,
      joined: '2024-03-07T15:30:00.000Z',
      phones: [{ number: '111' }, { number: '222' }],
      _configVersion: 1,
    },
    {
      name: 'Bo',
      born: '2024-01-01',
      score: 3,
      active: false,
      joined: '2023-12-31T23:59:00.000Z',
      phones: [{ number: '333' }],
      _configVersion: 1,
    },
  ],
  errors: [{ row: 5, ref: 'score', column: 2, message: '"n/a" is not a number', raw: 'n/a' }],
  skipped: 1,
};

/** SHA-256 of `buildParityWorkbook()`'s bytes. Changes only when the workbook above does. */
export const PARITY_XLSX_SHA256 = 'd8c45588fabb852090eaffcf4ed7b02abdad5d0e55e8ad8c857f0267360b50f5';

/** Hex SHA-256 of some bytes, for checking them against `PARITY_XLSX_SHA256`. */
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const FIXED_DATE = new Date(Date.UTC(2024, 0, 1));

/** The workbook, as the bytes of an `.xlsx` file. */
export async function buildParityWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = workbook.modified = FIXED_DATE;
  workbook.creator = workbook.lastModifiedBy = 'dynamic-entity tests';
  const sheet = workbook.addWorksheet('People');
  sheet.getRow(1).values = PARITY_XLSX_HEADERS;
  for (const [row, values] of Object.entries(ROWS)) sheet.getRow(Number(row)).values = values as ExcelJS.CellValue[];

  const written = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  const repacked = new JSZip();
  for (const name of Object.keys(written.files).sort()) {
    const entry = written.files[name];
    if (entry.dir) continue;
    repacked.file(name, await entry.async('uint8array'), { date: FIXED_DATE, createFolders: false });
  }
  return repacked.generateAsync({ type: 'uint8array', compression: 'DEFLATE', platform: 'UNIX' });
}
