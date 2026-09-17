import { parseCsv, type SheetData } from '@dynamic-entity/core';
import type { SheetParser } from 'ngx-dynamic-entity';

/**
 * The demo's `SHEET_PARSER`: CSV, plus tab-separated files.
 *
 * This is what the seam is for. The library ships CSV only — deliberately, so the import
 * wizard works on a fresh install with no spreadsheet library in the dependency tree — and a
 * consumer who needs another format registers a reader for it here. A production app would
 * put SheetJS or ExcelJS behind this same function to accept `.xlsx`:
 *
 * ```ts
 * sheetParser: async file => {
 *   const wb = XLSX.read(await file.arrayBuffer());
 *   const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
 *     header: 1, raw: false, defval: '',
 *   }) as string[][];
 *   return { headers: rows[0] ?? [], rows: rows.slice(1) };
 * }
 * ```
 *
 * TSV is handled here rather than in the library because it is exactly the kind of format a
 * particular shop has and nobody else does — which is the argument for the token existing at
 * all rather than for a longer list of built-in formats.
 *
 * Rows come back positional, never keyed by header: a real export has duplicate column names
 * and blank ones, and a header-keyed row loses the second of two columns called "Notes".
 */
export const demoSheetParser: SheetParser = async (file: File): Promise<SheetData> => {
  const text = await file.text();

  if (/\.tsv$/i.test(file.name)) {
    // Tabs instead of commas, and no quoting rules to speak of — which is the whole reason
    // people export TSV in the first place.
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const rows = lines.map(line => line.split('\t'));
    return { headers: rows.shift() ?? [], rows };
  }

  return parseCsv(text);
};
