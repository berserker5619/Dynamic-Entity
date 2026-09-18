import { applyMapping, parseCsv } from '@dynamic-entity/core';
import { cellValue } from './xlsx-source';
import { readSheet } from './read-sheet';
import { runImport } from './run-import';
import {
  chunked,
  collectedHeap,
  CONFIG,
  CSV_TEXT,
  HEADERS,
  LOOKUPS,
  PLAN,
  trackedStream,
} from './sheet.fixtures';
import {
  BILLION_LAUGHS_SHEET,
  generatedRows,
  manyEntries,
  plainSheet,
  streamedWorkbook,
  workbook,
  workbookWithSheet,
  XXE_SHEET,
  zipBomb,
} from './workbook.fixtures';

const drain = async (rows: AsyncIterable<unknown[]>): Promise<unknown[][]> => {
  const out: unknown[][] = [];
  for await (const row of rows) out.push(row);
  return out;
};

describe('reading a workbook', () => {
  it('is recognised by its bytes, whatever the filename says', async () => {
    const sheet = await readSheet({ stream: await workbook(), filename: 'export.csv' });
    expect(sheet.format).toBe('xlsx');
    expect(sheet.headers).toEqual(HEADERS);
  });

  it('keeps a date cell as a Date rather than stringifying it', async () => {
    // The whole point of the typed-cell path: exceljs hands back UTC midnight, and it must
    // still be a Date when core sees it.
    const sheet = await readSheet({ stream: await workbook() });
    const rows = await drain(sheet.rows);
    expect(rows[0][2]).toBeInstanceOf(Date);
    expect((rows[0][2] as Date).toISOString()).toBe('2024-03-07T00:00:00.000Z');
    expect(typeof rows[0][1]).toBe('number');
    expect(typeof rows[0][3]).toBe('boolean');
  });

  it('puts back the blank row exceljs skips, so row numbers stay aligned', async () => {
    // exceljs emits row 3 and then row 5. Passing that through would shift every later row
    // number in every error message, and disagree with the CSV path about `skipped`.
    const sheet = await readSheet({ stream: await workbook() });
    const rows = await drain(sheet.rows);
    expect(rows).toHaveLength(4);
    expect(rows[2]).toEqual(['', '', '', '', '']);
    expect(rows[3][0]).toBe('Carol');
  });

  it('pads a short row to the header width, the way the CSV path does', async () => {
    const sheet = await readSheet({ stream: await workbook() });
    const rows = await drain(sheet.rows);
    expect(rows[3]).toEqual(['Carol', 29, '', '', '']);
  });

  it('reads an archive written with data descriptors, which the streaming writer uses', async () => {
    // exceljs's own streaming writer leaves the local header sizes at zero and writes them
    // after the data. A guard that could only walk declared sizes would refuse this package's
    // own templates.
    const sheet = await readSheet({ stream: await streamedWorkbook() });
    expect(sheet.headers).toEqual(HEADERS);
    expect((await drain(sheet.rows))[0][0]).toBe('Alice');
  });

  it('survives the bytes arriving in small pieces', async () => {
    const bytes = await workbook();
    const sheet = await readSheet({ stream: chunked(bytes, 97) });
    expect(sheet.headers).toEqual(HEADERS);
    expect(await drain(sheet.rows)).toHaveLength(4);
  });

  it('produces the same records as the same data read as CSV', async () => {
    // The parity that makes "one engine, both sides" true across formats as well as across
    // machines: a date typed into a spreadsheet and the same date typed into a CSV must
    // import to the same record.
    const browser = applyMapping(parseCsv(CSV_TEXT).rows, PLAN, CONFIG, { lookups: LOOKUPS });

    const records: Record<string, unknown>[] = [];
    await runImport({
      stream: await workbook(),
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
      onBatch: batch => {
        records.push(...batch);
      },
    });

    expect(records).toEqual(browser.records);
  });

  it('applies the row limits a CSV meets, so a workbook buys no extra room', async () => {
    await expect(
      readSheet({ stream: await workbook(), limits: { maxColumns: 2 } }),
    ).rejects.toMatchObject({ code: 'SHEET_TOO_LARGE' });
  });

  it('refuses a sheet whose XML is not readable, rather than importing nothing from it', async () => {
    // A SAX parser handed rubbish inside a well-formed zip stops rather than complains, so
    // without a check this reads as an empty workbook and reports a successful import of zero
    // rows — the wrong thing to tell someone whose file plainly has data in it.
    await expect(
      readSheet({ stream: await workbookWithSheet('<not-xml') }),
    ).rejects.toMatchObject({ code: 'MALFORMED_FILE' });
  });

  it('refuses an archive with no worksheet at all', async () => {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await expect(readSheet({ stream: bytes })).rejects.toMatchObject({ code: 'MALFORMED_FILE' });
  });
});

describe('hostile workbooks', () => {
  it('refuses a nested-entity expansion instead of expanding it', async () => {
    // Six levels of ten: a million copies of a forty-character string, from a few hundred
    // bytes, if anything expands it. exceljs's SAX parser refuses an undefined entity
    // outright — it does not process the internal DTD subset at all — and this asserts that
    // rather than taking it on trust.
    await expect(
      readSheet({ stream: await workbookWithSheet(BILLION_LAUGHS_SHEET) }),
    ).rejects.toMatchObject({ code: 'MALFORMED_FILE' });
  });

  it('does not resolve an external entity', async () => {
    const sheet = readSheet({ stream: await workbookWithSheet(XXE_SHEET) });
    await expect(sheet).rejects.toMatchObject({ code: 'MALFORMED_FILE' });
    // And nothing about the filesystem reached the message.
    await expect(sheet).rejects.not.toThrow(/passwd/);
  });

  it('refuses a zip bomb before inflating it', async () => {
    // 64 MB of spaces is a ~64 KB upload — comfortably inside maxBytes, which is exactly why
    // maxBytes is the wrong guard for an archive.
    const bomb = await zipBomb(64 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(1024 * 1024);

    await expect(
      readSheet({ stream: bomb, limits: { maxUncompressedBytes: 4 * 1024 * 1024 } }),
    ).rejects.toMatchObject({ code: 'ARCHIVE_REFUSED' });
  });

  it('refuses it on the ratio even when the total would have been allowed', async () => {
    const bomb = await zipBomb(8 * 1024 * 1024);
    await expect(
      readSheet({
        stream: bomb,
        limits: { maxUncompressedBytes: 512 * 1024 * 1024, maxCompressionRatio: 10 },
      }),
    ).rejects.toMatchObject({ code: 'ARCHIVE_REFUSED' });
  });

  it('refuses an archive of too many entries', async () => {
    await expect(
      readSheet({ stream: await manyEntries(200), limits: { maxZipEntries: 50 } }),
    ).rejects.toMatchObject({ code: 'ARCHIVE_REFUSED' });
  });

  it('closes the request body when it refuses an archive', async () => {
    const { stream, destroyed } = trackedStream(await zipBomb(64 * 1024 * 1024));
    await expect(
      readSheet({ stream, limits: { maxUncompressedBytes: 1024 * 1024 } }),
    ).rejects.toThrow();
    expect(destroyed()).toBe(true);
  });

  it('refuses a sparse sheet before generating its way to the row limit', async () => {
    // Two cells and `r="500000"` in under two kilobytes. Synthesising the gap to keep row
    // numbers aligned cost a quarter of a second of CPU per request before the row guard
    // noticed — a hundred-fold amplification from a file that fits in a tweet. The row number
    // says how big the sheet claims to be, so it says it first now.
    const sparse =
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>First Name</t></is></c></row>` +
      `<row r="500000"><c r="A500000" t="inlineStr"><is><t>Alice</t></is></c></row>` +
      `</sheetData></worksheet>`;

    const bytes = await workbookWithSheet(sparse);
    expect(bytes.length).toBeLessThan(4096);

    const started = Date.now();
    const sheet = await readSheet({ stream: bytes });
    await expect(drain(sheet.rows)).rejects.toMatchObject({ code: 'SHEET_TOO_LARGE' });
    // Generating two hundred thousand blank rows took ~190ms; refusing outright is immediate.
    expect(Date.now() - started).toBeLessThan(150);
  });

  it('still fills a gap a real sheet can legitimately have', async () => {
    // The guard must not cost a sheet its row numbering. Blank rows inside the limit are rows.
    const gapped =
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>First Name</t></is></c></row>` +
      `<row r="5"><c r="A5" t="inlineStr"><is><t>Alice</t></is></c></row>` +
      `</sheetData></worksheet>`;

    const sheet = await readSheet({ stream: await workbookWithSheet(gapped) });
    const rows = await drain(sheet.rows);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toEqual(['Alice']);
  });

  it('lets an ordinary workbook through the same guards untouched', async () => {
    // The guards have to be survivable by real files, which is the half of a limit that is
    // easy to forget to check.
    const sheet = await readSheet({ stream: await workbook() });
    expect(await drain(sheet.rows)).toHaveLength(4);
  });
});

describe('a workbook the size this package exists for', () => {
  /**
   * The leak this caught, recorded because it is invisible to the obvious measurement.
   *
   * Every row was raced against one long-lived rejection promise, which accumulated a reaction
   * per row and freed none of them until the generator finished — 1.9 KB a row, seventy-five
   * megabytes over this file, and a heap that looked perfectly clean before and after.
   */
  it('streams fifty thousand rows without holding them', async () => {
    const bytes = await streamedWorkbook(generatedRows(50_000));

    let peak = 0;
    let batches = 0;
    const before = collectedHeap();
    const result = await runImport({
      stream: bytes,
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
      limits: { batchSize: 500, maxBytes: 64 * 1024 * 1024 },
      onBatch: () => {
        // Every twentieth batch: collecting on all hundred of them measures the collector.
        // Every twentieth batch: collecting on all hundred of them measures the collector.
        if (batches++ % 20 === 0) peak = Math.max(peak, collectedHeap() - before);
      },
    });

    expect(result.imported).toBe(50_000);
    expect(result.errors).toEqual([]);
    // Measured on a collected heap, so this is what the run *holds* rather than what it has
    // not got round to dropping. The archive is ~1.3 MB and is held compressed on purpose;
    // the sheet XML inside it is ~11.5 MB inflated and is the thing that must not be. A
    // streaming run sits under 3 MB, so eight is headroom rather than a number chosen to pass.
    expect(peak).toBeLessThan(8 * 1024 * 1024);
  });
});

describe('cellValue', () => {
  it('takes a formula cell result, never its formula', () => {
    // Importing `=SUM(A1:A9)` as text is importing a string the user never saw.
    expect(cellValue({ formula: 'SUM(A1:A9)', result: 42 })).toBe(42);
    expect(cellValue({ sharedFormula: 'A1', result: 'ok' })).toBe('ok');
  });

  it('flattens rich text to the text it displays', () => {
    expect(cellValue({ richText: [{ text: 'Hello ' }, { text: 'world' }] })).toBe('Hello world');
  });

  it('takes the text of a hyperlink cell, not its target', () => {
    expect(cellValue({ text: 'Home', hyperlink: 'https://example.com' })).toBe('Home');
  });

  it('surfaces an error cell rather than importing it as blank', () => {
    expect(cellValue({ error: '#REF!' })).toBe('#REF!');
  });

  it('leaves a typed primitive exactly as it is', () => {
    const when = new Date(Date.UTC(2024, 2, 7));
    expect(cellValue(when)).toBe(when);
    expect(cellValue(42)).toBe(42);
    expect(cellValue(false)).toBe(false);
    expect(cellValue('text')).toBe('text');
  });

  it('reads an empty cell as empty', () => {
    expect(cellValue(null)).toBe('');
    expect(cellValue(undefined)).toBe('');
    expect(cellValue({})).toBe('');
  });
});

describe('previewing a workbook', () => {
  it('renders typed cells as the text the browser will coerce to the same value', async () => {
    const { previewSheet } = await import('./run-import');
    const preview = await previewSheet({ stream: await workbook(), config: CONFIG });

    expect(preview.format).toBe('xlsx');
    expect(preview.headers).toEqual(HEADERS);
    expect(preview.sample[0]).toEqual(['Alice', '34', '2024-03-07', 'true', 'Active']);
    // Identical to what the CSV of the same data previews as, which is the parity claim.
    expect(preview.rowCount).toBe(4);
  });

  it('reads a sheet whose only content is an inline string', async () => {
    const sheet = await readSheet({ stream: await workbookWithSheet(plainSheet('ok')) });
    expect(sheet.headers).toEqual(['ok']);
  });
});
