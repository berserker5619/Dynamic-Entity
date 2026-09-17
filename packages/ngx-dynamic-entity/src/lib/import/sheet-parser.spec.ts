import { defaultSheetParser } from './sheet-parser';

/** A `File` whose `text()` works under jsdom, which does not implement Blob.text. */
function csvFile(name: string, body: string): File {
  const file = new File([body], name, { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(body) });
  return file;
}

describe('defaultSheetParser', () => {
  it('reads a CSV into headers and positional rows', async () => {
    const sheet = await defaultSheetParser(csvFile('people.csv', 'First Name,Status\nAlice,Active'));
    expect(sheet).toEqual({ headers: ['First Name', 'Status'], rows: [['Alice', 'Active']] });
  });

  it('refuses a workbook by name rather than reading a zip as text', async () => {
    // Attempting it yields a header row of mojibake and a mapping screen of nonsense, which
    // is far harder to diagnose than being told the format is not supported.
    await expect(defaultSheetParser(csvFile('people.xlsx', 'PK...'))).rejects.toThrow(
      /built-in parser handles CSV only/,
    );
  });
});
