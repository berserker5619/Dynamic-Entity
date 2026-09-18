/**
 * xlsx-source.ts — a workbook, one row at a time.
 *
 * exceljs's streaming reader does the XML; this file does the three things around it that
 * decide whether a server-side xlsx import matches a browser one.
 *
 * 1. **Every byte goes through `guardZip` first.** exceljs inflates internally and reports
 *    nothing while it does, so the only place an archive's real size is knowable early is
 *    before it gets there.
 * 2. **Blank rows are put back.** exceljs skips them — a sheet with a gap emits row 3 then
 *    row 5 — and a reader that passed that through would shift every later row number in
 *    every error message, and disagree with the CSV path about `skipped`. The row numbers a
 *    user is shown are the ones in their spreadsheet's gutter, so the gaps are synthesised.
 * 3. **Cells keep their types.** A date cell arrives as a `Date` at UTC midnight and is
 *    handed on as one, because `coerceCell` reads a typed cell as its type. Stringifying here
 *    to tidy the signature is the exact defect this feature already fixed once.
 *
 * **What this holds, stated rather than discovered:** the archive's wanted parts, kept
 * **compressed** and therefore bounded by `maxBytes` — ten megabytes by default, against a
 * fifty-thousand-row workbook's few. That is the cost of `guardZip` rebuilding the archive
 * rather than forwarding it, and the reasons it does are in that file. Row data is never
 * accumulated, which is the part that scales with the file.
 */

import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { ImportError } from './errors';
import { guardZip } from './guard-zip';
import type { ImportLimits } from './limits';

/**
 * Turn one exceljs cell value into the value a record should be built from.
 *
 * A formula cell yields its **result**, never its formula: a sheet someone uploaded may
 * contain anything, and importing the text `=SUM(A1:A9)` into a field is importing a string
 * the user never saw. An error cell yields its error text, which fails coercion loudly rather
 * than importing as blank.
 */
export function cellValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return raw;
  if (typeof raw !== 'object') return raw;

  const cell = raw as Record<string, unknown>;
  if (Array.isArray(cell['richText'])) {
    return (cell['richText'] as { text?: unknown }[]).map(part => String(part?.text ?? '')).join('');
  }
  if ('formula' in cell || 'sharedFormula' in cell) return cellValue(cell['result']);
  if ('error' in cell) return String(cell['error']);
  if ('text' in cell) return String(cell['text']);
  return '';
}

/** `row.values` is one-based with a hole at index 0, and sparse wherever a cell was empty. */
function rowCells(values: unknown): unknown[] {
  if (!Array.isArray(values)) return [];
  const out: unknown[] = [];
  for (let i = 1; i < values.length; i++) out.push(cellValue(values[i]));
  return out;
}

/**
 * Rows of the first worksheet, starting at spreadsheet row 1.
 *
 * The first worksheet and no other: a mapping plan addresses one sheet's columns, and picking
 * a second one silently would import a different file from the one the user previewed.
 */
export async function* xlsxRows(
  source: AsyncIterable<Uint8Array>,
  limits: ImportLimits,
): AsyncGenerator<unknown[]> {
  const archive = await guardZip(source, limits);
  const guarded = Readable.from([archive]);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(guarded, {
    // Nothing decorative is parsed. Each of these is XML this import has no use for, and
    // every part not parsed is a part that cannot be hostile.
    entries: 'ignore',
    hyperlinks: 'ignore',
    // Cached because a string cell is a reference into this table and an unresolved reference
    // is not a value. See the note at the top about what that costs.
    sharedStrings: 'cache',
    // Cached because it is what tells a numeric cell it is a date.
    styles: 'cache',
    worksheets: 'emit',
  });

  /**
   * The next spreadsheet row number expected, so a gap can be filled rather than skipped.
   *
   * **There used to be a race here, and its removal is worth recording.** Every pull was raced
   * against a rejection bound to the input stream, because `guardZip` throwing mid-stream
   * destroyed exceljs's input and the reader then stopped producing worksheets without ever
   * rejecting — an eight-byte truncated zip hung a sixty-second test rather than failing it.
   * `guardZip` now reads and validates the whole archive *before* the parser is constructed, so
   * that failure cannot reach this code any more, and the race was doing two things instead:
   * nothing, and leaking. Racing each row against one long-lived promise attached a reaction
   * per row and released none until it settled, which for a promise that only rejects on
   * failure is never — 1.9 KB a row, seventy-five megabytes over a fifty-thousand-row workbook.
   * A request that hangs for some *other* reason is the Express adapter's `totalTimeoutMs` to
   * answer, which is the layer that owns a clock.
   */
  let expected = 1;
  let yielded = false;

  try {
    // The first worksheet and no other: a mapping plan addresses one sheet's columns, and
    // picking up a second silently would import a different file from the one the user
    // previewed.
    for await (const worksheet of reader) {
      for await (const row of worksheet) {
        const number = typeof row.number === 'number' ? row.number : expected;
        // A blank row is a row. `applyMapping` counts it as skipped, and every row after it
        // keeps the number the user sees.
        while (expected < number) {
          yield [];
          expected++;
        }
        yield rowCells(row.values);
        yielded = true;
        expected = number + 1;
      }
      break;
    }

    if (!yielded) {
      // A worksheet that produced not one row, or no worksheet at all. Either the sheet XML is
      // not readable — a SAX parser given rubbish inside a well-formed zip stops rather than
      // complains — or the sheet is genuinely empty. Neither is a file anyone meant to import,
      // and "imported 0 rows" is the wrong thing to tell someone whose file plainly has data.
      throw new ImportError('MALFORMED_FILE', 'This workbook has no readable rows.');
    }
  } catch (error) {
    // A guard that already decided says what it decided. Anything else is the parser refusing
    // the file, and what it says about itself is not for a response to carry — exceljs's SAX
    // parser refuses an undefined entity, which is how a billion-laughs sheet arrives here.
    if (error instanceof ImportError) throw error;
    throw new ImportError('MALFORMED_FILE', 'This is not a readable workbook.', { cause: error });
  } finally {
    guarded.destroy();
  }
}
