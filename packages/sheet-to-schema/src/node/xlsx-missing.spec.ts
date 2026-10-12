/**
 * `exceljs` is an optional peer dependency (docs/phase2-plan.md, decision 3). This is what
 * someone sees who reads a workbook without having installed it.
 *
 * The mock stands for the package not being there: it fails the way Node fails. It is in a
 * file of its own because a module mock covers the whole file, and every other spec here
 * needs the real package.
 */
import JSZip from 'jszip';
import { readSheet } from './read-sheet';
import { chunked, CSV_TEXT, HEADERS } from './sheet.fixtures';

jest.mock('exceljs', () => {
  throw Object.assign(new Error("Cannot find module 'exceljs' from 'src/node/xlsx-source.ts'"), { code: 'MODULE_NOT_FOUND' });
});

/** The smallest archive the zip guard takes for a workbook, built without exceljs. */
async function workbookBytes(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="S" sheetId="1"/></sheets></workbook>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('reading a workbook without exceljs installed', () => {
  it('says which package to install, and that it is optional', async () => {
    const failure = await readSheet({ stream: await workbookBytes() }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'sheet-to-schema/node needs the "exceljs" package to read .xlsx files, and it is not installed. ' +
        'It is an optional peer dependency: run `npm install exceljs`.',
    );
  });

  it('does not call it a problem with the file', async () => {
    // The file is fine. Reporting MALFORMED_FILE would send the user to fix a workbook that
    // has nothing wrong with it, when the server is what is missing something.
    const failure = await readSheet({ stream: await workbookBytes() }).catch((error: Error) => error);
    expect((failure as { code?: string }).code).toBeUndefined();
    expect((failure as Error).name).toBe('Error');
  });

  it('still reads a CSV, which never needed it', async () => {
    const sheet = await readSheet({ stream: chunked(CSV_TEXT, 16) });
    expect(sheet.format).toBe('csv');
    expect(sheet.headers).toEqual(HEADERS);
  });
});
