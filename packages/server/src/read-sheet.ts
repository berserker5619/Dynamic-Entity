/**
 * read-sheet.ts — bytes in, a header row and an async stream of rows out.
 *
 * Two properties this file exists to hold:
 *
 * 1. **Format is decided by content, never by the filename.** `.csv` is client-controlled and
 *    an attacker who wants a zip parsed will name their zip `.csv`. The first four bytes are
 *    not. Both readers then meet the same row guards, so a workbook cannot buy itself a
 *    larger sheet by being a workbook.
 * 2. **Rows arrive one at a time.** Nothing here ever holds the sheet. `rows` is an
 *    `AsyncIterable`, so a consumer that stops pulling stops the read.
 *
 * Cells are `unknown[]`, never `string[]`. An xlsx cell is a number, a boolean or a `Date`,
 * and core's `coerceCell` reads a typed cell as its type — stringifying here to make the
 * signature tidier is exactly the bug that would reintroduce.
 */

import { createCsvReader, padRow } from '@dynamic-entity/core';
import { destroySource, limitBytes, peek, toByteStream, type ByteSource } from './bytes';
import { sampleText } from './cell-text';
import { ImportError } from './errors';
import { resolveLimits, type ImportLimits } from './limits';
import { xlsxRows } from './xlsx-source';

/** The formats this package reads. Both are decided by magic bytes. */
export type SheetFormat = 'csv' | 'xlsx';

export interface SheetSource {
  /** What the bytes turned out to be, which may not be what the filename claimed. */
  format: SheetFormat;
  headers: string[];
  /** Data rows, one at a time. Pulling stops the read; not pulling stops it too. */
  rows: AsyncIterable<unknown[]>;
}

export interface ReadSheetOptions {
  stream: ByteSource;
  /** Display only — it names the file in an error message and decides nothing. */
  filename?: string;
  limits?: Partial<ImportLimits>;
}

/** Enough bytes to tell a zip from text, with room for a UTF-16 BOM. */
const MAGIC_BYTES = 8;

const ZIP = [0x50, 0x4b]; // "PK"
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0]; // a pre-2007 .xls, which is a compound file, not a zip
const UTF16_LE = [0xff, 0xfe];
const UTF16_BE = [0xfe, 0xff];

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((byte, i) => bytes[i] === byte);

/**
 * What these bytes actually are.
 *
 * Exported because the multipart layer wants the same answer for the same reason, and because
 * a second copy of a magic-byte table is a second table to be wrong.
 */
export function detectFormat(head: Uint8Array): SheetFormat {
  if (startsWith(head, ZIP)) return 'xlsx';

  if (startsWith(head, OLE2)) {
    throw new ImportError(
      'UNSUPPORTED_FORMAT',
      'This is a pre-2007 Excel file (.xls). Save it as .xlsx or .csv and try again.',
    );
  }
  if (startsWith(head, UTF16_LE) || startsWith(head, UTF16_BE)) {
    throw new ImportError(
      'UNSUPPORTED_FORMAT',
      'This file is UTF-16 encoded. Save it as UTF-8 CSV and try again.',
    );
  }

  // Anything else is read as delimited text. A binary file that reaches here produces a sheet
  // of nonsense rather than an error, which is the right trade: refusing everything that does
  // not look like text would refuse legitimately unusual encodings too, and nonsense rows are
  // reported per row by the mapping rather than as a mysterious rejection.
  return 'csv';
}

/** Decode UTF-8 across chunk boundaries and feed core's incremental reader. */
async function* csvRows(stream: AsyncIterable<Uint8Array>): AsyncGenerator<string[]> {
  // Not `fatal`: a sheet is user data from somewhere else, and one bad byte replaced with
  // U+FFFD is a cell the importer can report on. Rejecting the whole file for it is a worse
  // answer to a problem the user can see in exactly one cell.
  const decoder = new TextDecoder('utf-8');
  const reader = createCsvReader();

  for await (const chunk of stream) {
    // `stream: true` is what holds a multi-byte character split across a 64 KB boundary.
    for (const row of reader.push(decoder.decode(chunk, { stream: true }))) yield row;
  }

  for (const row of reader.push(decoder.decode())) yield row;
  for (const row of reader.end()) yield row;
}

/**
 * Enforce the row, column and cell bounds as rows go past, and pad short rows.
 *
 * Padding matches `parseCsv`, through the same `padRow` core exports, so a file imported on a
 * server and the same file imported in a browser produce the same rows. A second padding rule
 * here would be a place for the two halves to disagree, silently, about a row that ended early.
 */
export async function* guardRows(
  rows: AsyncIterable<unknown[]>,
  width: number,
  limits: ImportLimits,
): AsyncGenerator<unknown[]> {
  let seen = 0;

  for await (const row of rows) {
    if (++seen > limits.maxRows) {
      throw new ImportError(
        'SHEET_TOO_LARGE',
        `The sheet has more than ${limits.maxRows} rows.`,
      );
    }
    if (row.length > limits.maxColumns) {
      throw new ImportError(
        'SHEET_TOO_LARGE',
        `Row ${seen + 1} has more than ${limits.maxColumns} columns.`,
      );
    }
    for (const cell of row) {
      if (typeof cell === 'string' && cell.length > limits.maxCellLength) {
        throw new ImportError(
          'SHEET_TOO_LARGE',
          `A cell in row ${seen + 1} is longer than ${limits.maxCellLength} characters.`,
        );
      }
    }
    yield padRow(row, width);
  }
}

/**
 * Open a sheet: read its header row, and hand back the rest as a stream.
 *
 * The header row is pulled eagerly because everything downstream — the column count, the
 * mapping suggestion, the padding width — is a function of it. Exactly one row is held.
 */
export async function readSheet(options: ReadSheetOptions): Promise<SheetSource> {
  const limits = resolveLimits(options.limits);

  try {
    const counted = limitBytes(toByteStream(options.stream), limits.maxBytes);
    const { head, stream } = await peek(counted, MAGIC_BYTES);
    const format = detectFormat(head);
    const rows = format === 'xlsx' ? xlsxRows(stream, limits) : csvRows(stream);

    const iterator = rows[Symbol.asyncIterator]();
    const first = await iterator.next();
    // Headers are text whichever format they came from — a column heading is a label, and a
    // plan addresses a column by index anyway. `sampleText` rather than `String` so a header
    // cell that is somehow a date reads the same on both sides.
    const headers = first.done ? [] : first.value.map(sampleText);

    if (headers.length > limits.maxColumns) {
      throw new ImportError(
        'SHEET_TOO_LARGE',
        `The sheet has more than ${limits.maxColumns} columns.`,
      );
    }

    const remaining = drain(iterator);
    return {
      format,
      headers,
      rows: closing(guardRows(remaining, headers.length, limits), options.stream),
    };
  } catch (error) {
    // Every exit from this function closes the request body, including the ones that are a
    // refusal rather than a fault. Refusing an upload and then leaving the socket half-read is
    // how a rejected upload still costs a handle.
    destroySource(options.stream);
    throw error;
  }
}

/** Everything the iterator has left, after the header row has been taken off the front. */
async function* drain(
  iterator: AsyncIterator<unknown[]>,
): AsyncGenerator<unknown[]> {
  for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
    yield next.value;
  }
}

/**
 * Close the source if the row stream stops early — by a guard firing, or by the caller
 * abandoning it.
 *
 * `readSheet` returns before a single data row is read, so its own `try` is long finished by
 * the time a row-level limit fires. Without this, the only thing standing between a refused
 * sheet and a leaked socket would be every caller remembering to destroy it, and "every caller
 * remembers" is the assumption this package keeps declining to make.
 */
async function* closing(
  rows: AsyncIterable<unknown[]>,
  source: unknown,
): AsyncGenerator<unknown[]> {
  let drained = false;
  try {
    yield* rows;
    drained = true;
  } finally {
    // `finally` rather than `catch`, so an early `break` in the caller's loop closes it too.
    //
    // But **only when the stream did not finish**. On a clean read the source is already at
    // its end, and destroying it anyway would be actively wrong under Express: the file part
    // of a multipart body shares a socket with the response being written back, and tearing
    // that down after a successful import would abort the reply it was about to send.
    if (!drained) destroySource(source);
  }
}
