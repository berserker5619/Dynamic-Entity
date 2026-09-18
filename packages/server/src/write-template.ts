/**
 * write-template.ts — the sheet to hand a user so their data arrives already in the right shape.
 *
 * **This is the one place in the library that writes a file another program executes.** A
 * template is opened in Excel, and `=cmd|'/C calc'!A0` in a cell is a command, not text. So
 * every cell goes through core's `escapeFormula` on the way in.
 *
 * The cell's *type* is the other half, and it cannot be set: exceljs derives it from the value
 * and exposes `type` read-only. Handing it a string is therefore what makes a string cell —
 * which is a claim about a library rather than a line of code here, so `write-template.spec.ts`
 * reads the written XML back and asserts no `<f>` element appears in it. A guard that is an
 * assertion in a test is a guard; a comment saying "exceljs writes this as text" is not.
 *
 * The header text itself is derived from config labels, which is authored data like any other
 * and therefore not trusted here.
 */

import { escapeFormula, toCsv, type TemplateSpec } from '@dynamic-entity/core';
import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { ImportError } from './errors';
import { resolveLimits, type ImportLimits } from './limits';

/** The formats a generated template can be written in. */
export type TemplateFormat = 'csv' | 'xlsx';

export interface WriteTemplateOptions {
  spec: TemplateSpec;
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
  const columns = options.spec.columns;

  if (columns.length > limits.maxColumns) {
    throw new ImportError(
      'SHEET_TOO_LARGE',
      `A template of ${columns.length} columns is past the ${limits.maxColumns} column limit.`,
    );
  }

  if (options.format === 'csv') {
    await writeCsv(options.spec, options.out);
    return;
  }
  await writeXlsx(options.spec, options.out);
}

/**
 * Headers only, and `spec.notes` deliberately left out of the file.
 *
 * The same decision the browser transport makes, for the same reason: CSV has one header row
 * and no concept of a second, so a guidance row would be read back as a record and report a
 * failed row 2 on every re-import of the template the user just filled in.
 */
function writeCsv(spec: TemplateSpec, out: Writable): Promise<void> {
  // Byte-for-byte what `LocalImportTransport.template` produces, through the same `toCsv` —
  // which escapes every cell — so a template downloaded from a server and one generated in the
  // browser are the same file.
  const csv = toCsv(spec.columns.map(column => column.header));
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
async function writeXlsx(spec: TemplateSpec, out: Writable): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
  const sheet = workbook.addWorksheet(sheetName(spec.sheetName));
  const { columns, notes } = spec;

  const row = sheet.addRow(columns.map(column => escapeFormula(column.header)));
  row.eachCell((cell, index) => {
    cell.font = { bold: true };
    const note = notes[index - 1];
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
