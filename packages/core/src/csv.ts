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
 * Parse CSV text into a header row and positional data rows.
 *
 * Written as a character scan rather than a line split because a quoted field may contain
 * `,`, `"` and a line break, and splitting on lines breaks every one of those. Accepts LF,
 * CRLF and CR endings, and strips a UTF-8 BOM — Excel writes one, and a BOM left on the
 * first header makes it match nothing.
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
  const source = typeof text === 'string' ? stripBom(text) : '';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  /** Distinguishes a trailing newline (no final row) from a trailing empty field. */
  let pending = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    pending = true;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
    pending = false;
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      // A doubled quote inside a quoted field is one literal quote.
      if (source[i + 1] === '"') {
        field += '"';
        i++;
        continue;
      }
      quoted = false;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      pending = true;
      continue;
    }
    if (char === ',') {
      endField();
      continue;
    }
    if (char === '\r' || char === '\n') {
      // CRLF is one terminator, not two.
      if (char === '\r' && source[i + 1] === '\n') i++;
      endRow();
      continue;
    }
    field += char;
    pending = true;
  }

  if (pending || field !== '' || row.length > 0) endRow();

  const headers = rows.shift() ?? [];
  // A row shorter than the header is padded rather than dropped: a spreadsheet that ends a
  // row early still has values in the columns it did fill, and losing them silently is worse
  // than carrying empty strings. Longer rows keep their extra cells — the mapping decides
  // which columns matter, and a column the header forgot to name may still be mapped.
  const padded = rows.map(r =>
    r.length >= headers.length ? r : [...r, ...Array(headers.length - r.length).fill('')],
  );

  return { headers, rows: padded };
}
