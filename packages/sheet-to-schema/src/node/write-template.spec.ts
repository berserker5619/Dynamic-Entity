import { parseCsv, toCsv } from 'sheet-to-schema';
import { PassThrough } from 'node:stream';
import { readSheet } from './read-sheet';
import { HEADERS } from './sheet.fixtures';
import { TEMPLATE_MEDIA_TYPE, writeTemplate, type TemplateFormat, type TemplateSheet } from './write-template';

/** Run a write and collect what came out. */
async function write(sheet: TemplateSheet, format: TemplateFormat): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const out = new PassThrough();
  out.on('data', chunk => chunks.push(chunk as Buffer));
  const finished = new Promise(resolve => out.on('finish', resolve));
  await writeTemplate({ sheet, format, out });
  await finished;
  return Buffer.concat(chunks);
}

const SPEC: TemplateSheet = {
  sheetName: 'Employee',
  headers: HEADERS,
  notes: ['Required', '0 to 150', 'YYYY-MM-DD', 'true or false', 'One of: Active, Inactive'],
};

describe('writeTemplate — csv', () => {
  it('writes the headers it is given', async () => {
    const csv = (await write(SPEC, 'csv')).toString('utf8');
    expect(parseCsv(csv).headers).toEqual(HEADERS);
  });

  it('writes byte-for-byte what the browser transport writes', async () => {
    // Both go through the main entry's `toCsv` over the headers. A template downloaded from a
    // server and one generated in a tab have to be the same file, or a user who got one and a
    // colleague who got the other are filling in different sheets.
    const expected = toCsv(HEADERS);
    expect((await write(SPEC, 'csv')).toString('utf8')).toBe(expected);
  });

  it('leaves the guidance notes out of the file', async () => {
    // A guidance row under the headers reads well and breaks the round trip: CSV has one
    // header row and no concept of a second, so re-importing the filled-in template would
    // report a failed row 2 every time.
    const csv = (await write(SPEC, 'csv')).toString('utf8');
    expect(parseCsv(csv).rows).toEqual([]);
  });

  it('neutralises a header that would otherwise be a formula', async () => {
    const spec: TemplateSheet = { ...SPEC, headers: [`=cmd|'/C calc'!A0`], notes: [''] };
    const csv = (await write(spec, 'csv')).toString('utf8');
    expect(parseCsv(csv).headers[0]).toBe(`'=cmd|'/C calc'!A0`);
  });

  it('round-trips through the reader as an empty sheet with the right columns', async () => {
    const sheet = await readSheet({ stream: await write(SPEC, 'csv') });
    expect(sheet.headers).toEqual(HEADERS);
  });
});

describe('writeTemplate — xlsx', () => {
  it('writes a workbook this package can read back', async () => {
    const bytes = await write(SPEC, 'xlsx');
    const sheet = await readSheet({ stream: bytes });
    expect(sheet.format).toBe('xlsx');
    expect(sheet.headers).toEqual(HEADERS);
  });

  it('carries the guidance CSV had nowhere to put, as notes rather than as data', async () => {
    // A note is somewhere that is not a row, so it reads in Excel and does not come back as a
    // record on re-import. That is the distinction the CSV writer could not make.
    const bytes = await write(SPEC, 'xlsx');
    const sheet = await readSheet({ stream: bytes });
    const rows: unknown[][] = [];
    for await (const row of sheet.rows) rows.push(row);
    expect(rows).toEqual([]);
  });

  it('writes a formula-shaped header as text, not as a formula', async () => {
    // The one place this library writes a file another program executes. Both guards are
    // exercised here: the cell's declared type, and the escape.
    const spec: TemplateSheet = { ...SPEC, headers: [`=cmd|'/C calc'!A0`], notes: [''] };
    const bytes = await write(spec, 'xlsx');

    const sheet = await readSheet({ stream: bytes });
    expect(sheet.headers[0]).toBe(`'=cmd|'/C calc'!A0`);
    // And nothing in the written XML declares a formula.
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).not.toContain('<f>');
  });

  it('cleans a sheet name Excel would refuse', async () => {
    const spec: TemplateSheet = { ...SPEC, sheetName: 'Employees: [2024]/Q1 *draft* ?'.repeat(3) };
    const bytes = await write(spec, 'xlsx');
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/workbook.xml')!.async('string');
    const name = /name="([^"]*)"/.exec(xml)?.[1] ?? '';
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[[\]:*?/\\]/);
  });

  it('writes each note on its header cell, and a workbook with no notes at all', async () => {
    const { default: JSZip } = await import('jszip');
    const noted = await JSZip.loadAsync(await write(SPEC, 'xlsx'));
    const comments = await noted.file('xl/comments1.xml')!.async('string');
    for (const note of SPEC.notes!) expect(comments).toContain(note);

    const plain = await write({ sheetName: 'Plain', headers: HEADERS }, 'xlsx');
    const bare = await JSZip.loadAsync(plain);
    expect(bare.file('xl/comments1.xml')).toBeNull();
    expect((await readSheet({ stream: plain })).headers).toEqual(HEADERS);
  });

  it('falls back to a name rather than writing an unnamed sheet', async () => {
    const spec: TemplateSheet = { ...SPEC, sheetName: ':::' };
    const bytes = await write(spec, 'xlsx');
    await expect(readSheet({ stream: bytes })).resolves.toBeDefined();
  });
});

describe('writeTemplate — limits', () => {
  it('refuses a template wider than maxColumns', async () => {
    const wide: TemplateSheet = { sheetName: 'Wide', headers: Array.from({ length: 20 }, (_unused, i) => `Column ${i}`) };
    const out = new PassThrough();
    out.resume();
    await expect(
      writeTemplate({ sheet: wide, format: 'csv', out, limits: { maxColumns: 8 } }),
    ).rejects.toMatchObject({ code: 'SHEET_TOO_LARGE' });
  });

  it('names a media type for every format it writes', () => {
    expect(TEMPLATE_MEDIA_TYPE.csv).toContain('text/csv');
    expect(TEMPLATE_MEDIA_TYPE.xlsx).toContain('spreadsheetml');
  });
});
