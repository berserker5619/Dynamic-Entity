/**
 * xlsx parity with the browser.
 *
 * The workbook, the plan and the expected outcome are in `core/test-fixtures/xlsx-parity.ts`.
 * The Angular package's `xlsx-parity.spec.ts` reads the same bytes through a typed
 * `SheetParser` and `LocalImportTransport.commit`, against the same expectation.
 *
 * Covers: `runImport` (`run-import.ts:140`) → `readSheet` → `detectFormat` (a zip is `xlsx`) →
 * `xlsxRows` (`xlsx-source.ts:68`: `guardZip`, exceljs's streaming reader, blank rows put back)
 * → `cellValue` (`xlsx-source.ts:39`, cells keep their types) → batched `applyMapping` →
 * `coerceTypedCell` (`import-engine.ts:334`: a `Date` by its UTC components). Run in every
 * zone by `check:timezones`.
 */
import { runImport } from './run-import';
import { chunked } from './sheet.fixtures';
import {
  PARITY_XLSX_CONFIG,
  PARITY_XLSX_EXPECTED,
  PARITY_XLSX_PLAN,
  PARITY_XLSX_SHA256,
  buildParityWorkbook,
  sha256,
} from '../../core/test-fixtures/xlsx-parity';

describe('an xlsx import, against the shared parity workbook', () => {
  let bytes: Uint8Array;
  beforeAll(async () => {
    bytes = await buildParityWorkbook();
  });

  it('reads the same bytes the browser reads', () => {
    expect(sha256(bytes)).toBe(PARITY_XLSX_SHA256);
  });

  it('produces the records and errors the browser produces', async () => {
    const records: Record<string, unknown>[] = [];
    const result = await runImport({
      stream: chunked(bytes, 1024),
      filename: 'people.xlsx',
      plan: PARITY_XLSX_PLAN,
      config: PARITY_XLSX_CONFIG,
      lang: 'en',
      onBatch: batch => {
        records.push(...batch);
      },
    });

    expect(result.format).toBe('xlsx');
    expect({ records, errors: result.errors, skipped: result.skipped }).toEqual(PARITY_XLSX_EXPECTED);
  });
});
