/**
 * workbook.fixtures.ts — workbooks built at test time, friendly and hostile alike.
 *
 * **Nothing here is committed as a file, and that is deliberate.** A zip bomb checked into a
 * repository trips every scanner that ever looks at the repository and is a liability of its
 * own — for contributors, for CI, and for anyone who clones it. Generating them costs a few
 * milliseconds and costs nobody anything else.
 *
 * The hostile ones need a zip *writer*, because exceljs only writes valid workbooks. That is
 * what the `jszip` devDependency is for. The alternative is asserting that the guards work by
 * reading the code, which is how "we assumed the parser was safe" gets written down.
 */

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { HEADERS } from './sheet.fixtures';

/** The rows the CSV fixture carries, as the typed values a workbook would hold. */
export const WORKBOOK_ROWS: unknown[][] = [
  ['Alice', 34, new Date(Date.UTC(2024, 2, 7)), true, 'Active'],
  ['Bo, Jr.', 41, new Date(Date.UTC(2024, 0, 1)), false, 'Inactive'],
  [],
  ['Carol', 29],
];

/** A real .xlsx, written by exceljs, with the header row and whatever rows are given. */
export async function workbook(rows: unknown[][] = WORKBOOK_ROWS): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet1');
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow(row as ExcelJS.CellValue[]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** `count` rows of plausible data, generated rather than listed. */
export function generatedRows(count: number): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < count; i++) {
    rows.push([`Name${i}`, 20 + (i % 40), new Date(Date.UTC(2024, 2, 7)), true, 'Active']);
  }
  return rows;
}

/** A workbook written by the *streaming* writer, which uses zip data descriptors. */
export async function streamedWorkbook(rows: unknown[][] = WORKBOOK_ROWS): Promise<Buffer> {
  const { PassThrough } = await import('node:stream');
  const chunks: Buffer[] = [];
  const out = new PassThrough();
  out.on('data', chunk => chunks.push(chunk as Buffer));
  const finished = new Promise(resolve => out.on('finish', resolve));

  const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
  const sheet = book.addWorksheet('Sheet1');
  sheet.addRow(HEADERS).commit();
  for (const row of rows) sheet.addRow(row as ExcelJS.CellValue[]).commit();
  sheet.commit();
  await book.commit();
  await finished;
  return Buffer.concat(chunks);
}

// ─── The parts a minimal workbook needs, so a hostile sheet can be the only odd one ──────

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

/** An archive that is a valid workbook apart from the sheet XML it is handed. */
export async function workbookWithSheet(sheetXml: string, extra: Record<string, string> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('xl/workbook.xml', WORKBOOK_XML);
  zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS);
  zip.file('xl/worksheets/sheet1.xml', sheetXml);
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** A sheet of one inline-string cell, so a crafted XML body has somewhere to sit. */
export const plainSheet = (text: string): string =>
  `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData></worksheet>`;

/**
 * The classic nested-entity expansion, as an xlsx.
 *
 * Six levels of ten is a million copies of a forty-character string — forty megabytes out of
 * a few hundred bytes in, if anything expands it.
 */
export const BILLION_LAUGHS_SHEET = `<?xml version="1.0"?>
<!DOCTYPE worksheet [
<!ENTITY a "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
<!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">
<!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;">
<!ENTITY f "&e;&e;&e;&e;&e;&e;&e;&e;&e;&e;">
]>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&f;</t></is></c></row></sheetData>
</worksheet>`;

/** An external-entity reference, which a parser must never resolve. */
export const XXE_SHEET = `<?xml version="1.0"?>
<!DOCTYPE worksheet [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;</t></is></c></row></sheetData>
</worksheet>`;

/**
 * A zip bomb: one entry of highly compressible bytes that inflates out of all proportion.
 *
 * `size` is what it inflates to. A megabyte of zeroes compresses to about a kilobyte, so
 * 64 MB of them is a ~64 KB upload that costs 64 MB to open — well inside any byte limit on
 * the upload itself, which is exactly why `maxBytes` is the wrong guard for this.
 */
export async function zipBomb(size: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('xl/worksheets/sheet1.xml', Buffer.alloc(size, 0x20));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** An archive of `count` tiny entries, for the entry-count bound. */
export async function manyEntries(count: number): Promise<Buffer> {
  const zip = new JSZip();
  for (let i = 0; i < count; i++) zip.file(`e${i}.txt`, 'x');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
