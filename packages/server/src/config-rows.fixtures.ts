/**
 * config-rows.fixtures.ts — one valid row for *any* config, so a test can cover all of them.
 *
 * Every other import fixture in this repository is a hand-written config with a hand-written
 * sheet beside it, which proves the engine works for the five field types somebody thought to
 * write down. The repo carries nine real configs between `test_data.json` and the demo,
 * spanning sixteen field types, pattern validators, min/max bounds and a `listName` that only
 * resolves against a lookup list. A field type that only breaks on `insuranceClaims` breaks in
 * production and in nothing else.
 *
 * So the row is *derived from the column*, the same way the template is: give it an
 * `ImportColumn` and it answers with a cell that config would accept. A config added tomorrow
 * is covered by the tests that already exist.
 *
 * Not a spec, and excluded from coverage. It is imported by `all-configs.spec.ts`,
 * `stress.spec.ts`, and — by relative path — by the demo's Playwright suite, which is why it
 * depends on `@dynamic-entity/core` and on nothing else in this package.
 */

import { resolveOptionLabel, type ImportColumn, type ImportLookups } from '@dynamic-entity/core';

export interface SynthesiseOptions {
  /** Language the option labels were resolved in. Must match the one the columns came from. */
  lang?: string;
  /** Values for every `listName` the config mentions, exactly as a server is handed them. */
  lookups?: ImportLookups;
  /**
   * Per-ref values, for a config the generic path cannot satisfy.
   *
   * The escape hatch is a map rather than cleverness in the generic path on purpose: a
   * synthesiser that grows special cases stops being a statement about what a config accepts
   * and becomes a second implementation of the coercion rules.
   */
  overrides?: Readonly<Record<string, string>>;
  /** Names the config in the error when no candidate satisfies a pattern. */
  entity?: string;
}

/**
 * Text candidates tried, in order, against a `validators.pattern`.
 *
 * Short and fixed rather than generated: a regex *generator* would be a second implementation
 * of the pattern language, and the patterns real configs carry are a handful of shapes — an
 * email address, a national-insurance number, a reference code.
 */
const PATTERN_CANDIDATES = [
  'ada@example.com',
  'AB123456C',
  'ABC-123',
  'REF-0001',
  '12345',
  'A1',
  'Sample',
];

/** Fixed instants, at UTC, so the text and typed forms of one cell mean the same day. */
const WHEN = {
  date: Date.UTC(2024, 2, 7),
  datetime: Date.UTC(2024, 2, 7, 9, 30),
  /** A time-only cell is a fraction of a day against the spreadsheet epoch, 1899-12-30. */
  time: Date.UTC(1899, 11, 30, 9, 30),
} as const;

const TEXT = {
  date: '2024-03-07',
  datetime: '2024-03-07T09:30:00.000Z',
  monthYear: '2024-03',
  time: '09:30',
} as const;

/** The first option a `listName` field would offer, resolved the way `coerceCell` matches it. */
function firstListOption(listName: string, options: SynthesiseOptions): string | undefined {
  const list = options.lookups?.[listName];
  if (!list?.length) return undefined;
  return resolveOptionLabel(list[0], options.lang ?? 'en') || undefined;
}

/** The option text a choice column accepts: its own inline options, else its lookup list. */
function optionText(column: ImportColumn, options: SynthesiseOptions): string {
  const inline = column.enumValues?.[0];
  if (inline) return inline;

  const listName = column.field.listName;
  const fromList = listName ? firstListOption(listName, options) : undefined;
  if (fromList) return fromList;

  // No options and no list: `matchOption` has nothing to match against and passes the text
  // through, which is the behaviour an `entity-ref` relies on.
  return `Sample ${column.field.id}`;
}

/** A number inside `validators.min` / `max`, which is the only thing a bound can reject. */
function numberFor(column: ImportColumn): number {
  const validators = column.field.validators ?? {};
  let value = 42;
  if (typeof validators.min === 'number') value = Math.max(value, validators.min);
  if (typeof validators.max === 'number') value = Math.min(value, validators.max);
  return value;
}

/**
 * Text that satisfies `minLength`, `maxLength` and `pattern` at once.
 *
 * **A pattern with no satisfying candidate throws rather than returning a blank.** A
 * synthesiser that silently blanked a required field would turn a real failure into a passing
 * test — which is exactly what the prototype did on `complexFullTest.emailAddress` before this
 * check existed.
 */
function textFor(column: ImportColumn, options: SynthesiseOptions): string {
  const validators = column.field.validators ?? {};
  const pattern = validators.pattern;

  if (pattern) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      // A pattern that does not compile is a *config* problem, and `validateConfig` is what
      // reports it. Matching everything here keeps that failure where it belongs.
      regex = /(?:)/;
    }
    const match = PATTERN_CANDIDATES.find(candidate => regex.test(candidate));
    if (match === undefined) {
      throw new Error(
        `config-rows.fixtures: no candidate satisfies /${pattern}/ for "${column.ref}"` +
          `${options.entity ? ` on "${options.entity}"` : ''}. Add one to PATTERN_CANDIDATES ` +
          'or pass an override for that ref — do not let the cell go out blank.',
      );
    }
    return match;
  }

  if (validators.email === true) return 'ada@example.com';

  let text = `Sample ${column.field.id}`;
  const min = validators.minLength;
  const max = validators.maxLength;
  if (typeof min === 'number' && text.length < min) text = text.padEnd(min, 'x');
  if (typeof max === 'number' && text.length > max) text = text.slice(0, max);
  return text;
}

/**
 * The cell a CSV would carry for this column — always text, because a CSV has nothing else.
 *
 * This is the value `coerceCell` reads through its string path, which is the path an
 * in-browser import and a served CSV both take.
 */
export function cellFor(column: ImportColumn, options: SynthesiseOptions = {}): string {
  const override = options.overrides?.[column.ref];
  if (override !== undefined) return override;

  switch (column.field.type) {
    case 'dropdown':
    case 'radio':
      return optionText(column, options);
    // One value, not several: a second would have to be a *different* valid option, and a
    // list with one entry has none to give.
    case 'multiSelect':
      return optionText(column, options);
    case 'boolean':
    case 'checkbox':
      return 'true';
    case 'number':
    case 'currency':
      return String(numberFor(column));
    case 'date':
      return TEXT.date;
    case 'datetime':
      return TEXT.datetime;
    case 'monthYear':
      return TEXT.monthYear;
    case 'time':
      return TEXT.time;
    default:
      return textFor(column, options);
  }
}

/**
 * The cell a **workbook** would carry: a `Date`, a number or a boolean where the format has
 * one, and the same text everywhere else.
 *
 * This is what makes the xlsx leg worth running. A workbook does not hold text in a date cell,
 * so an import that only ever saw CSV never exercised `coerceTypedCell` — the function that
 * exists because `String(date)` renders *local* time and moves the day for every user west of
 * Greenwich. The instants are built at UTC for the same reason.
 */
export function typedCellFor(column: ImportColumn, options: SynthesiseOptions = {}): unknown {
  const override = options.overrides?.[column.ref];
  if (override !== undefined) return override;

  switch (column.field.type) {
    case 'boolean':
    case 'checkbox':
      return true;
    case 'number':
    case 'currency':
      return numberFor(column);
    case 'date':
      return new Date(WHEN.date);
    case 'datetime':
      return new Date(WHEN.datetime);
    // A workbook has no month cell, so it carries a date and the month is read off it.
    case 'monthYear':
      return new Date(WHEN.date);
    case 'time':
      return new Date(WHEN.time);
    default:
      return cellFor(column, options);
  }
}

/** One CSV row, in the order the template generates its columns. */
export function synthesiseRow(
  columns: readonly ImportColumn[],
  options: SynthesiseOptions = {},
): string[] {
  return columns.map(column => cellFor(column, options));
}

/** The same row as a workbook would hold it. */
export function synthesiseTypedRow(
  columns: readonly ImportColumn[],
  options: SynthesiseOptions = {},
): unknown[] {
  return columns.map(column => typedCellFor(column, options));
}

/** A cell as a CSV writes it: quoted only where it has to be. */
function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A whole CSV file: the template's own headers, then `rows` copies of the synthesised row.
 *
 * Built as a string rather than streamed because every caller that wants fifty thousand rows
 * wants them chunked anyway — `csvChunks` is that, and holding a 30 MB fixture in memory while
 * asserting that the *reader* does not hold it would measure the wrong thing.
 */
export function synthesiseCsv(
  columns: readonly ImportColumn[],
  rows: number,
  options: SynthesiseOptions = {},
): string {
  const header = columns.map(column => csvCell(column.header)).join(',');
  const body = synthesiseRow(columns, options).map(csvCell).join(',');
  const lines = [header];
  for (let i = 0; i < rows; i++) lines.push(body);
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The same CSV, produced lazily in 64 KB chunks, so the fixture is never held whole.
 *
 * A stress test that built its own thirty-megabyte string first would be measuring the
 * fixture's heap alongside the reader's, and the reader is the only one under test.
 */
export async function* csvChunks(
  columns: readonly ImportColumn[],
  rows: number,
  options: SynthesiseOptions = {},
): AsyncGenerator<Uint8Array> {
  yield Buffer.from(`${columns.map(column => csvCell(column.header)).join(',')}\r\n`, 'utf8');

  const line = `${synthesiseRow(columns, options).map(csvCell).join(',')}\r\n`;
  let buffer = '';
  for (let i = 0; i < rows; i++) {
    buffer += line;
    if (buffer.length >= 64 * 1024) {
      yield Buffer.from(buffer, 'utf8');
      buffer = '';
    }
  }
  if (buffer) yield Buffer.from(buffer, 'utf8');
}
