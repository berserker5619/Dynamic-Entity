import JSZip from 'jszip';
import zlib from 'node:zlib';
import { guardZip } from './guard-zip';
import { resolveLimits } from './limits';
import { chunked } from './sheet.fixtures';
import { workbook } from './workbook.fixtures';

const LIMITS = resolveLimits();

/**
 * A zip built byte by byte, because the malformed shapes this guards against are exactly the
 * ones a real writer will not produce.
 *
 * Only the fields the guard reads are filled in; everything else is left at zero, which is
 * what a hostile file would do too.
 */
function rawZip(
  entries: {
    name: string;
    data: Buffer;
    method?: number;
    /** What the local header claims, when that should differ from the truth. */
    declaredSize?: number;
    /** Set bit 3, so the sizes are claimed to follow the data. */
    dataDescriptor?: boolean;
    /** Write the trailing descriptor, with or without its optional signature. */
    descriptor?: 'signed' | 'bare' | 'none';
  }[],
): Buffer {
  const parts: Buffer[] = [];

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.dataDescriptor ? 0x08 : 0, 6);
    header.writeUInt16LE(entry.method ?? 8, 8);
    header.writeUInt32LE(entry.dataDescriptor ? 0 : entry.declaredSize ?? entry.data.length, 18);
    header.writeUInt32LE(entry.dataDescriptor ? 0 : entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    parts.push(header, name, entry.data);

    if (entry.descriptor && entry.descriptor !== 'none') {
      const descriptor = Buffer.alloc(entry.descriptor === 'signed' ? 16 : 12);
      if (entry.descriptor === 'signed') descriptor.writeUInt32LE(0x08074b50, 0);
      parts.push(descriptor);
    }
  }

  // A truncated end: the guard stops parsing at the first thing that is not a local header,
  // and a central directory it never walks is a central directory it cannot be misled by.
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  parts.push(end);
  return Buffer.concat(parts);
}

const deflate = (text: string): Buffer => zlib.deflateRawSync(Buffer.from(text, 'utf8'));

/** The three parts the guard insists on seeing, so a test can add just the odd one. */
const sheetEntry = { name: 'xl/worksheets/sheet1.xml', data: deflate('<worksheet/>') };

describe('guardZip', () => {
  it('keeps the parts an import reads and drops the rest', async () => {
    const rebuilt = await guardZip(chunked(await workbook(), 4096), LIMITS);
    const names = Object.keys((await JSZip.loadAsync(rebuilt)).files);

    expect(names).toContain('xl/workbook.xml');
    expect(names).toContain('xl/worksheets/sheet1.xml');
    // Never parsed is never hostile: the theme and the document properties are dropped.
    expect(names).not.toContain('xl/theme/theme1.xml');
    expect(names).not.toContain('docProps/app.xml');
  });

  it('puts the workbook and its strings before the worksheet', async () => {
    // The ordering is the point of rebuilding: exceljs defers a worksheet it meets first and
    // loses entries doing it.
    const rebuilt = await guardZip(chunked(await workbook(), 4096), LIMITS);
    const names = Object.keys((await JSZip.loadAsync(rebuilt)).files);
    expect(names.indexOf('xl/workbook.xml')).toBeLessThan(
      names.indexOf('xl/worksheets/sheet1.xml'),
    );
  });

  it('repacks entries a zip reader accepts, checksums and all', async () => {
    const rebuilt = await guardZip(chunked(await workbook(), 4096), LIMITS);
    const zip = await JSZip.loadAsync(rebuilt, { checkCRC32: true });
    const xml = await zip.file('xl/workbook.xml')!.async('string');
    expect(xml).toContain('<sheets>');
  });

  it('reads a stored entry, which inflates to exactly itself', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet/>');
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });

    const rebuilt = await guardZip(chunked(bytes, 64), LIMITS);
    const back = await JSZip.loadAsync(rebuilt, { checkCRC32: true });
    expect(await back.file('xl/worksheets/sheet1.xml')!.async('string')).toBe('<worksheet/>');
  });

  it('counts a stored entry against the inflated total', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', 'x'.repeat(200_000));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    await expect(
      guardZip(chunked(bytes, 4096), resolveLimits({ maxUncompressedBytes: 1000 })),
    ).rejects.toMatchObject({ code: 'ARCHIVE_REFUSED' });
  });

  it('refuses a stored entry whose size is only written afterwards', async () => {
    // Nothing real produces one: without a declared size, the end of stored data cannot be
    // found without seeking, and seeking is what streaming means not doing.
    const bytes = rawZip([
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet/>'), method: 0, dataDescriptor: true, descriptor: 'bare' },
    ]);
    await expect(guardZip(chunked(bytes, 16), LIMITS)).rejects.toThrow(/stored without a declared size/);
  });

  it('refuses a compression method it does not implement', async () => {
    const bytes = rawZip([{ name: 'a.xml', data: Buffer.from('xx'), method: 99 }]);
    await expect(guardZip(chunked(bytes, 16), LIMITS)).rejects.toThrow(/compression method 99/);
  });

  it('refuses an archive that ends part-way through an entry header', async () => {
    const bytes = rawZip([sheetEntry]).subarray(0, 12);
    await expect(guardZip(chunked(bytes, 4), LIMITS)).rejects.toThrow(/part-way through an entry header/);
  });

  it('refuses an archive that ends part-way through an entry name', async () => {
    const bytes = rawZip([sheetEntry]).subarray(0, 34);
    await expect(guardZip(chunked(bytes, 4), LIMITS)).rejects.toThrow(/part-way through an entry header/);
  });

  it('refuses an archive that ends part-way through a deflated entry', async () => {
    const full = rawZip([{ ...sheetEntry, declaredSize: sheetEntry.data.length + 500 }]);
    await expect(guardZip(chunked(full, 16), LIMITS)).rejects.toThrow(/part-way through/);
  });

  it('refuses an archive that ends part-way through a stored entry', async () => {
    const bytes = rawZip([
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet/>'), method: 0, declaredSize: 4096 },
    ]);
    await expect(guardZip(chunked(bytes, 16), LIMITS)).rejects.toThrow(/part-way through/);
  });

  it('consumes a declared region that outruns its deflate stream rather than re-parsing it', async () => {
    // Guessing where the next header starts is how a scanner desynchronises, so padding inside
    // a declared length is consumed as this entry's.
    const padded = Buffer.concat([sheetEntry.data, Buffer.alloc(16)]);
    const bytes = rawZip([
      { name: 'xl/worksheets/sheet1.xml', data: padded },
      { name: 'xl/workbook.xml', data: deflate('<workbook/>') },
    ]);

    const rebuilt = await guardZip(chunked(bytes, 8), LIMITS);
    const back = await JSZip.loadAsync(rebuilt);
    expect(Object.keys(back.files)).toContain('xl/workbook.xml');
  });

  it('reads an entry whose sizes follow it, with the descriptor signed or bare', async () => {
    for (const descriptor of ['signed', 'bare'] as const) {
      const bytes = rawZip([
        { name: 'xl/workbook.xml', data: deflate('<workbook/>'), dataDescriptor: true, descriptor },
        { name: 'xl/worksheets/sheet1.xml', data: deflate('<worksheet/>'), dataDescriptor: true, descriptor },
      ]);
      const back = await JSZip.loadAsync(await guardZip(chunked(bytes, 7), LIMITS));
      expect({ descriptor, names: Object.keys(back.files).sort() }).toEqual({
        descriptor,
        names: ['xl/workbook.xml', 'xl/worksheets/sheet1.xml'],
      });
    }
  });

  it('reads a last entry whose descriptor is followed by nothing it recognises', async () => {
    const bytes = rawZip([
      { name: 'xl/worksheets/sheet1.xml', data: deflate('<worksheet/>'), dataDescriptor: true, descriptor: 'bare' },
    ]);
    const back = await JSZip.loadAsync(await guardZip(chunked(bytes, 5), LIMITS));
    expect(Object.keys(back.files)).toEqual(['xl/worksheets/sheet1.xml']);
  });

  it('refuses a deflate stream that is not one', async () => {
    const bytes = rawZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from('not deflate data') }]);
    await expect(guardZip(chunked(bytes, 8), LIMITS)).rejects.toMatchObject({
      code: 'MALFORMED_FILE',
    });
  });

  it('refuses to retain more than the upload bound, whatever the header claimed', async () => {
    // Incompressible on purpose: a repetitive payload would deflate to nothing and never
    // reach the retention bound, which would make this test pass for the wrong reason.
    const noise = Buffer.alloc(64 * 1024);
    let state = 1;
    for (let i = 0; i < noise.length; i++) {
      state = (state * 1103515245 + 12345) >>> 0;
      noise[i] = (state >>> 16) & 0xff;
    }
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', noise);
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await expect(
      guardZip(chunked(bytes, 4096), resolveLimits({ maxBytes: 1024 })),
    ).rejects.toThrow(/larger than the 1024 byte limit/);
  });

  it('keeps only the first worksheet', async () => {
    const bytes = rawZip([
      { name: 'xl/worksheets/sheet1.xml', data: deflate('<worksheet>one</worksheet>') },
      { name: 'xl/worksheets/sheet2.xml', data: deflate('<worksheet>two</worksheet>') },
    ]);
    const back = await JSZip.loadAsync(await guardZip(chunked(bytes, 16), LIMITS));
    expect(Object.keys(back.files)).toEqual(['xl/worksheets/sheet1.xml']);
  });

  it('keeps the first of two entries with the same name', async () => {
    // A duplicate name is a classic way to show a checker one thing and a reader another.
    const bytes = rawZip([
      { name: 'xl/workbook.xml', data: deflate('<workbook>first</workbook>') },
      { name: 'xl/workbook.xml', data: deflate('<workbook>second</workbook>') },
      sheetEntry,
    ]);
    const back = await JSZip.loadAsync(await guardZip(chunked(bytes, 16), LIMITS));
    expect(await back.file('xl/workbook.xml')!.async('string')).toBe('<workbook>first</workbook>');
  });

  it('refuses an archive with no worksheet in it', async () => {
    const bytes = rawZip([{ name: 'xl/workbook.xml', data: deflate('<workbook/>') }]);
    await expect(guardZip(chunked(bytes, 16), LIMITS)).rejects.toMatchObject({
      code: 'MALFORMED_FILE',
    });
  });

  it('treats a zip64 size sentinel as no size at all', async () => {
    // Declaring 0xFFFFFFFF means "the real size is in the extra field", which is a size this
    // never reads — so the entry is measured by what comes out of it instead. A file that
    // declared the sentinel to dodge the accounting gets the stricter path, not the looser one.
    const bytes = rawZip([
      { name: 'xl/worksheets/sheet1.xml', data: deflate('<worksheet/>'), declaredSize: 0xffffffff, descriptor: 'bare' },
    ]);
    const back = await JSZip.loadAsync(await guardZip(chunked(bytes, 6), LIMITS));
    expect(Object.keys(back.files)).toEqual(['xl/worksheets/sheet1.xml']);
  });
});
