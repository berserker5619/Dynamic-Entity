/**
 * write-template.ts — the sheet to hand a user so their data arrives already in the right shape.
 *
 * **This is the one place in the library that writes a file another program executes.** A
 * template is opened in Excel, and `=cmd|'/C calc'!A0` in a cell is a command, not text. So
 * every cell goes through the main entry's `escapeFormula` on the way in.
 *
 * The cell's *type* is the other half, and it cannot be set: exceljs derives it from the value
 * and exposes `type` read-only. Handing it a string is therefore what makes a string cell —
 * which is a claim about a library rather than a line of code here, so `write-template.spec.ts`
 * reads the written XML back and asserts no `<f>` element appears in it. A guard that is an
 * assertion in a test is a guard; a comment saying "exceljs writes this as text" is not.
 *
 * The header text itself comes from a schema's labels, which is authored data like any other
 * and therefore not trusted here.
 *
 * Moved from Dynamic Entity's server. There it took a `TemplateSpec`, whose columns are DE
 * fields; here it takes what a template is made of, the sheet's name, its headers and a note
 * for each, so any adapter's targets can be written.
 */

import { escapeFormula, toCsv } from 'sheet-to-schema';
import type { Writable } from 'node:stream';
import { ImportError } from './errors';
import { resolveLimits, type ImportLimits } from './limits';
import { loadOptional } from './optional';

/** `exceljs` is an optional peer: a CSV template does not need it, so it is loaded for a workbook only. */
const loadExcel = () => loadOptional('exceljs', 'write .xlsx templates', async () => (await import('exceljs')).default);

/** What a template is made of. An adapter's targets give the headers; see `ImportTarget.header`. */
export interface TemplateSheet {
  /** The worksheet's name. Cleaned to what Excel accepts, and ignored for CSV. */
  sheetName: string;
  /** One per column, in order. */
  headers: readonly string[];
  /** Guidance for each column, by position. Written as cell notes in a workbook, and left out of a CSV. */
  notes?: readonly string[];
}

/** The formats a generated template can be written in. */
export type TemplateFormat = 'csv' | 'xlsx';

export interface WriteTemplateOptions {
  sheet: TemplateSheet;
  format: TemplateFormat;
  /** Written into as the file is produced; an HTTP response is the intended one. */
  out: Writable;
  limits?: Partial<ImportLimits>;
}

/** The extension a written template should be offered under. */
export const TEMPLATE_EXTENSION: Record<TemplateFormat, string> = { csv: 'csv', xlsx: 'xlsx' };

/** The media type a written template should be served as. */
export const TEMPLATE_MEDIA_TYPE: Record<TemplateFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Write a template into `out`.
 *
 * Resolves when the file is complete and the stream has been ended. A caller that owns the
 * stream for other reasons — an Express response, say — gets it back finished, which is what
 * a download handler wants.
 */
export async function writeTemplate(options: WriteTemplateOptions): Promise<void> {
  const limits = resolveLimits(options.limits);
  const { headers } = options.sheet;

  if (headers.length > limits.maxColumns) {
    throw new ImportError(
      'SHEET_TOO_LARGE',
      `A template of ${headers.length} columns is past the ${limits.maxColumns} column limit.`,
    );
  }

  if (options.format === 'csv') {
    await writeCsv(options.sheet, options.out);
    return;
  }
  await writeXlsx(options.sheet, options.out);
}

/**
 * Headers only, and the notes deliberately left out of the file.
 *
 * The same decision the browser transport makes, for the same reason: CSV has one header row
 * and no concept of a second, so a guidance row would be read back as a record and report a
 * failed row 2 on every re-import of the template the user just filled in.
 */
function writeCsv(sheet: TemplateSheet, out: Writable): Promise<void> {
  // Byte-for-byte what a browser produces with the main entry's `toCsv`, which escapes every
  // cell, so a template downloaded from a server and one generated in a tab are the same file.
  const csv = toCsv(sheet.headers);
  return new Promise((resolve, reject) => {
    out.end(csv, () => resolve());
    out.on('error', reject);
  });
}

/**
 * The same headers, plus the guidance CSV had nowhere to put.
 *
 * An xlsx cell has a note attached to it, which is somewhere that is *not* data: the hint
 * reads in Excel and does not come back as a row on re-import. That is the distinction the
 * CSV writer could not make.
 */
async function writeXlsx(template: TemplateSheet, out: Writable): Promise<void> {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
  const sheet = workbook.addWorksheet(sheetName(template.sheetName));

  const row = sheet.addRow(template.headers.map(header => escapeFormula(header)));
  row.eachCell((cell, index) => {
    cell.font = { bold: true };
    const note = template.notes?.[index - 1];
    if (note) cell.note = note;
  });
  row.commit();

  sheet.commit();
  await workbook.commit();
}

/** Excel rejects a worksheet name over 31 characters or containing any of `[]:*?/\`. */
function sheetName(name: string): string {
  const cleaned = String(name).replace(/[[\]:*?/\\]/g, ' ').trim();
  return (cleaned || 'Import').slice(0, 31);
}
