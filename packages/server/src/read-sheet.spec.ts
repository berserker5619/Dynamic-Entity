import { parseCsv } from '@dynamic-entity/core';
import { detectFormat, guardRows, readSheet } from './read-sheet';
import { DEFAULT_LIMITS, resolveLimits } from './limits';
import { chunked, CSV_TEXT, HEADERS, OLE2_HEAD, trackedStream, ZIP_HEAD } from './sheet.fixtures';

const drain = async (rows: AsyncIterable<unknown[]>): Promise<unknown[][]> => {
  const out: unknown[][] = [];
  for await (const row of rows) out.push(row);
  return out;
};

describe('detectFormat', () => {
  it('reads a zip as xlsx, whatever the file is called', () => {
    // The guard: `.csv` is client-controlled, and an attacker who wants a zip parsed will name
    // their zip `.csv`. The first four bytes are not client-controlled in the same way.
    expect(detectFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toBe('xlsx');
  });

  it('reads anything else as delimited text', () => {
    expect(detectFormat(Buffer.from('name,age', 'utf8'))).toBe('csv');
    expect(detectFormat(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('csv');
    expect(detectFormat(Buffer.alloc(0))).toBe('csv');
  });

  it('names a pre-2007 .xls rather than failing to parse it later', () => {
    expect(() => detectFormat(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toThrow(
      /\.xls/,
    );
  });

  it('names a UTF-16 file rather than decoding it into nonsense', () => {
    expect(() => detectFormat(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toThrow(/UTF-16/);
    expect(() => detectFormat(Buffer.from([0xfe, 0xff, 0x00, 0x61]))).toThrow(/UTF-16/);
  });
});

describe('readSheet over CSV', () => {
  it('reads the header row and streams the rest', async () => {
    const sheet = await readSheet({ stream: chunked(CSV_TEXT) });
    expect(sheet.format).toBe('csv');
    expect(sheet.headers).toEqual(HEADERS);
    expect(await drain(sheet.rows)).toEqual(parseCsv(CSV_TEXT).rows);
  });

  it('agrees with parseCsv however the bytes are split', async () => {
    const expected = parseCsv(CSV_TEXT).rows;
    for (const size of [1, 2, 3, 5, 13, 64, 4096]) {
      const sheet = await readSheet({ stream: chunked(CSV_TEXT, size) });
      expect({ size, rows: await drain(sheet.rows) }).toEqual({ size, rows: expected });
    }
  });

  it('holds a multi-byte character split across a chunk boundary', async () => {
    const text = 'name\r\nJosé\r\n';
    const bytes = Buffer.from(text, 'utf8');
    // é is two bytes; split between them.
    const at = bytes.indexOf(0xc3) + 1;
    async function* split(): AsyncGenerator<Uint8Array> {
      yield bytes.subarray(0, at);
      yield bytes.subarray(at);
    }
    const sheet = await readSheet({ stream: split() });
    expect(await drain(sheet.rows)).toEqual([['José']]);
  });

  it('strips the BOM Excel writes, so the first header still matches something', async () => {
    const bom = String.fromCharCode(0xfeff);
    const sheet = await readSheet({ stream: chunked(`${bom}${CSV_TEXT}`) });
    expect(sheet.headers[0]).toBe('First Name');
  });

  it('pads a short row exactly the way parseCsv does', async () => {
    const sheet = await readSheet({ stream: chunked(CSV_TEXT) });
    const rows = await drain(sheet.rows);
    expect(rows[3]).toEqual(['Carol', '29', '', '', '']);
  });

  it('reads an empty file as no headers and no rows', async () => {
    const sheet = await readSheet({ stream: chunked('') });
    expect(sheet.headers).toEqual([]);
    expect(await drain(sheet.rows)).toEqual([]);
  });

  it('refuses a truncated archive rather than hanging on it', async () => {
    // Eight bytes of zip signature and nothing else. Before the guard's error was raced
    // against the parser's pulls, this hung a sixty-second test instead of failing it.
    await expect(readSheet({ stream: ZIP_HEAD })).rejects.toMatchObject({
      code: 'ARCHIVE_REFUSED',
    });
  });

  it('closes the request body when it refuses the format', async () => {
    // Refusing and then leaving the socket half-read is how a rejected upload still costs a
    // handle. The pre-2007 .xls signature is the cheapest way to make it refuse.
    const { stream, destroyed } = trackedStream(OLE2_HEAD);
    await expect(readSheet({ stream })).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    expect(destroyed()).toBe(true);
  });

  it('closes the request body when the upload is too large', async () => {
    const { stream, destroyed } = trackedStream(CSV_TEXT, 8);
    await expect(readSheet({ stream, limits: { maxBytes: 16 } })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    expect(destroyed()).toBe(true);
  });

  it('refuses a header row wider than maxColumns before reading a single data row', async () => {
    const wide = Array.from({ length: 20 }, (_, i) => `c${i}`).join(',');
    await expect(
      readSheet({ stream: chunked(`${wide}\r\n1,2,3\r\n`), limits: { maxColumns: 8 } }),
    ).rejects.toMatchObject({ code: 'SHEET_TOO_LARGE' });
  });
});

describe('guardRows', () => {
  const limits = resolveLimits({ maxRows: 2, maxColumns: 3, maxCellLength: 5 });

  async function* rows(...values: unknown[][]): AsyncGenerator<unknown[]> {
    for (const row of values) yield row;
  }

  it('pads to the header width and lets the rest through', async () => {
    expect(await drain(guardRows(rows(['a'], ['b', 'c']), 3, limits))).toEqual([
      ['a', '', ''],
      ['b', 'c', ''],
    ]);
  });

  it('refuses past maxRows, naming the limit', async () => {
    await expect(drain(guardRows(rows(['a'], ['b'], ['c']), 1, limits))).rejects.toThrow(
      /more than 2 rows/,
    );
  });

  it('refuses a row wider than maxColumns', async () => {
    await expect(drain(guardRows(rows(['a', 'b', 'c', 'd']), 1, limits))).rejects.toMatchObject({
      code: 'SHEET_TOO_LARGE',
    });
  });

  it('refuses an over-long cell, which is also the bound on a backtracking regex', async () => {
    // maxCellLength is not only a memory guard: `validators.pattern` is config-supplied and
    // runs against this text, so its length is what bounds a catastrophic backtrack.
    await expect(drain(guardRows(rows(['abcdefghij']), 1, limits))).rejects.toMatchObject({
      code: 'SHEET_TOO_LARGE',
    });
  });

  it('does not measure a non-string cell by its rendered length', async () => {
    // A Date stringifies to well over maxCellLength's smallest sensible value; it is a typed
    // cell, not text, and must not be refused for how it would print.
    const long = resolveLimits({ maxCellLength: 4 });
    expect(await drain(guardRows(rows([new Date(0), 12345678]), 2, long))).toEqual([
      [new Date(0), 12345678],
    ]);
  });

  it('counts rows against the default, which is finite', () => {
    expect(DEFAULT_LIMITS.maxRows).toBeGreaterThan(0);
  });
});
