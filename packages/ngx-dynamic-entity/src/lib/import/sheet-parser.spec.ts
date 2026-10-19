import { defaultSheetParser } from './sheet-parser';

/** A `File` whose `text()` and `arrayBuffer()` work under jsdom, which implements neither. */
function csvFile(name: string, body: string): File {
  const file = new File([body], name, { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(body) });
  // The built-in parser reads bytes (sheet-to-schema's readCsvFile, from 3.1), as a browser's
  // Blob.arrayBuffer gives them; jsdom's File does not implement it.
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new TextEncoder().encode(body).buffer) });
  return file;
}

describe('defaultSheetParser', () => {
  it('reads a CSV into headers and positional rows', async () => {
    const sheet = await defaultSheetParser(csvFile('people.csv', 'First Name,Status\nAlice,Active'));
    expect(sheet).toEqual({
      headers: ['First Name', 'Status'],
      rows: [['Alice', 'Active']],
      delimiter: ',',
    });
  });

  it('reads a .tsv by tabs, with no parser registered', async () => {
    const tsv = 'First Name\tStatus\nAlice\tActive';
    const sheet = await defaultSheetParser(csvFile('people.tsv', tsv));
    expect(sheet.headers).toEqual(['First Name', 'Status']);
    expect(sheet.rows).toEqual([['Alice', 'Active']]);
  });

  it('detects a semicolon CSV, keeping a quoted semicolon inside its cell', async () => {
    const sheet = await defaultSheetParser(
      csvFile('people.csv', 'Name;Email;City\n"Rao; Jr.";rao@example.com;Pune'),
    );
    expect(sheet.delimiter).toBe(';');
    expect(sheet.rows).toEqual([['Rao; Jr.', 'rao@example.com', 'Pune']]);
  });

  // 3.0 refused by name; from 3.1 the bytes decide (docs/3.1-spec.md, Compatibility).
  it('refuses a workbook by its bytes, whatever it is called, rather than reading a zip as text', async () => {
    // Attempting it yields a header row of mojibake and a mapping screen of nonsense, which
    // is far harder to diagnose than being told the format is not supported.
    for (const name of ['people.xlsx', 'people.csv']) {
      await expect(defaultSheetParser(csvFile(name, 'PK\u0003\u0004...'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT', message: expect.stringContaining('.xlsx workbook') });
    }
  });

  it('reads a CSV whatever it is called, which 3.0 refused by name', async () => {
    const sheet = await defaultSheetParser(csvFile('export.xlsx', 'Name,City\nAda,Paris'));
    expect(sheet).toEqual({ headers: ['Name', 'City'], rows: [['Ada', 'Paris']], delimiter: ',' });
  });

  it('refuses a pre-2007 .xls and a UTF-16 file with sheet-to-schema codes', async () => {
    const bytes = (values: number[]) => {
      const file = new File([Uint8Array.from(values)], 'legacy.xls');
      Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(Uint8Array.from(values).buffer) });
      return file;
    };
    await expect(defaultSheetParser(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT', message: expect.stringContaining('.xls') });
    await expect(defaultSheetParser(bytes([0xff, 0xfe, 0x61, 0x00]))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT', message: expect.stringContaining('UTF-16') });
  });
});
