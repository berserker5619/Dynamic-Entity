/**
 * csv.ts — RFC 4180 parse and emit, with no dependency.
 *
 * Why this is in core rather than left to the consumer: a spreadsheet import that needs a
 * parser installed before it does anything is a feature with a prerequisite. CSV is the
 * format every tool exports and the one a text editor can produce, so handling it here means
 * the whole ingestion path works on a fresh install, and `SHEET_PARSER` exists for the
 * consumer who also wants `.xlsx` rather than for the consumer who wants it to work at all.
 *
 * Rows are **positional** (`string[][]`), not keyed by header. Real sheets carry duplicate
 * headers — two columns both called "Notes" — and blank ones, so a header-keyed row silently
 * loses columns. Everything downstream addresses a column by index for the same reason.
 */

/** A parsed sheet: the header row, and every data row by position. */
export interface SheetData {
  headers: string[];
  rows: string[][];
}

/**
 * Cell prefixes a spreadsheet application treats as the start of a formula.
 *
 * A generated template is a file we hand to someone who opens it in Excel, which makes it the
 * one place this library writes something another program executes. `=cmd|'/C calc'!A0` in a
 * cell is a command, not text.
 */
const FORMULA_LEAD = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Prefix a cell that would otherwise be read as a formula.
 *
 * Numbers are exempt, and deliberately: `-5` and `+1.5` both start with a lead character and
 * both are ordinary values. Escaping them would turn every negative number in an exported
 * template into the text `'-5`, which is a worse bug than the one being prevented — it is
 * silent, and it happens on every export rather than on a crafted one. A string that merely
 * *begins* like a number (`-2+3+cmd|…`) does not parse as one and is still escaped.
 */
export function escapeFormula(value: string): string {
  if (!value || !FORMULA_LEAD.has(value[0])) return value;
  if (value.trim() !== '' && Number.isFinite(Number(value))) return value;
  return `'${value}`;
}

/** Quote a field when it contains a delimiter, a quote, or a line break. */
function quoteField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** A cell's text: `null`/`undefined` become empty, everything else is stringified. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

/**
 * Serialise a header row and data rows to CSV text.
 *
 * Every cell goes through `escapeFormula` before quoting — including headers, which are
 * derived from config labels and are therefore authored data like any other.
 */
export function toCsv(headers: readonly unknown[], rows: readonly (readonly unknown[])[] = []): string {
  const line = (cells: readonly unknown[]): string =>
    cells.map(cell => quoteField(escapeFormula(cellText(cell)))).join(',');

  const out = [line(headers), ...rows.map(line)];
  return out.join('\r\n');
}

/**
 * The UTF-8 byte-order mark, written as an escape because the character itself is invisible
 * in source. Excel writes one, and a BOM left on the first header makes it match nothing.
 */
const BOM = '\uFEFF';

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

/**
 * Pad a short row out to the header width.
 *
 * Exported because two callers need it and a second copy would be a second decision — and
 * generic because the second caller's cells are `unknown`: an xlsx row carries numbers,
 * booleans and dates, not text. A spreadsheet that ends a row early still has values in the
 * columns it did fill, and losing them silently is worse than carrying empty strings. Longer rows keep their extra cells —
 * the mapping decides which columns matter, and a column the header forgot to name may
 * still be mapped.
 */
export function padRow<T>(row: readonly T[], width: number): (T | '')[] {
  if (row.length >= width) return [...row];
  return [...row, ...Array(width - row.length).fill('')];
}

/**
 * An incremental CSV parser: push text, pull whole rows.
 *
 * `parseCsv` takes the entire file as one string, which is fine in a browser tab and wrong on
 * a server streaming a fifty-thousand-row export — CSV being the *most* common format, a
 * streaming importer that buffered it would miss most of the point.
 *
 * The hard part is not chunking, it is that three of CSV's decisions need the character
 * *after* the one in hand, and a 64 KB boundary can land between them:
 *
 *   - a `"` inside a quoted field either closes it or, doubled, is one literal quote;
 *   - `\r\n` is one terminator, and the `\n` may arrive in the next chunk;
 *   - a quoted field may contain a line break, so a record can straddle any number of chunks.
 *
 * So each is a flag carried across `push` calls rather than a lookahead. `parseCsv` is
 * expressed in terms of this reader — one set of quoting rules, one place to be wrong.
 */
export interface CsvReader {
  /** Feed the next chunk of text; returns every row it completed, which may be none. */
  push(chunk: string): string[][];
  /** No more input: returns the final row if one is still open. */
  end(): string[][];
}

export function createCsvReader(): CsvReader {
  let row: string[] = [];
  let field = '';
  /** Inside a quoted field. */
  let quoted = false;
  /** Distinguishes a trailing newline (no final row) from a trailing empty field. */
  let pending = false;
  /** Saw a `"` while quoted; the next character says whether it closed or was doubled. */
  let quoteHeld = false;
  /** Ended a row on `\r`; a `\n` immediately after belongs to that same terminator. */
  let crHeld = false;
  /** Nothing has been consumed yet, so a leading BOM is still strippable. */
  let atStart = true;

  let out: string[][] = [];

  const endField = (): void => {
    row.push(field);
    field = '';
    pending = true;
  };
  const endRow = (): void => {
    endField();
    out.push(row);
    row = [];
    pending = false;
  };

  /** The unquoted-state transition, reached directly and after a held quote resolves. */
  const plain = (char: string): void => {
    if (char === '"' && field === '') {
      quoted = true;
      pending = true;
      return;
    }
    if (char === ',') {
      endField();
      return;
    }
    if (char === '\r') {
      endRow();
      crHeld = true;
      return;
    }
    if (char === '\n') {
      endRow();
      return;
    }
    field += char;
    pending = true;
  };

  return {
    push(chunk: string): string[][] {
      out = [];
      let source = typeof chunk === 'string' ? chunk : '';
      if (atStart && source !== '') {
        source = stripBom(source);
        atStart = false;
      }

      for (let i = 0; i < source.length; i++) {
        const char = source[i];

        // A `\n` right after a `\r` completes one terminator; anything else is ordinary and
        // falls through to be processed in its own right.
        if (crHeld) {
          crHeld = false;
          if (char === '\n') continue;
        }

        if (quoteHeld) {
          quoteHeld = false;
          // A doubled quote inside a quoted field is one literal quote.
          if (char === '"') {
            field += '"';
            continue;
          }
          quoted = false;
          plain(char);
          continue;
        }

        if (quoted) {
          if (char === '"') quoteHeld = true;
          else field += char;
          continue;
        }

        plain(char);
      }

      return out;
    },

    end(): string[][] {
      out = [];
      // A held quote at end of input closed its field: there is no next character to double it.
      quoteHeld = false;
      quoted = false;
      crHeld = false;
      atStart = false;
      if (pending || field !== '' || row.length > 0) endRow();
      return out;
    },
  };
}

/**
 * Parse CSV text into a header row and positional data rows.
 *
 * A thin wrapper over `createCsvReader`, so the whole-string and streaming paths cannot
 * disagree about quoting: there is one scanner and this feeds it once.
 *
 * Malformed input is read as far as it goes rather than rejected: a sheet is user data
 * arriving from somewhere else, and reporting "row 812 column 4 is unmatched" is the
 * importer's job, not the parser's.
 *
 * A blank line in the middle of a file becomes a row of one empty string rather than being
 * dropped, so row numbers stay aligned with what the user sees in their spreadsheet. The
 * importer skips empty rows and counts them; a parser that removed them would shift every
 * subsequent row number in every error message.
 */
export function parseCsv(text: string): SheetData {
  const reader = createCsvReader();
  const rows = [...reader.push(typeof text === 'string' ? text : ''), ...reader.end()];

  const headers = rows.shift() ?? [];
  return { headers, rows: rows.map(r => padRow(r, headers.length)) };
}
