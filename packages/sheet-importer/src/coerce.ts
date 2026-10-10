/**
 * coerce.ts — one cell into the value its target's kind stores (spec §8, "Generic coercion").
 *
 * Lifted from Dynamic Entity 2.3's `coerceCell` and `coerceTypedCell` (`core/src/import-engine.ts`),
 * with the schema taken out: a cell is read by its target's `ValueKind`, never by a field type.
 * The rules that make DE's import trustworthy come across unchanged:
 * - numbers by shape, never by `Number()`;
 * - a calendar date read textually, never through an instant;
 * - a typed `Date` by its UTC parts;
 * - a decimal comma only when asked for.
 *
 * `null`, `undefined` and blank text are always "no value" (`{ value: undefined }`), never an
 * error and never `''`: a blank cell is a cell the user said nothing in.
 */
import type { CoerceOutcome, ValueKind } from './adapter.types';
import { cellText } from './cell-text';

export interface CoerceValueOptions {
  /** The decimal mark in number text. `','` is the default for a `;`-separated file (§8). */
  decimal?: '.' | ',';
  /** The separator for a `list` cell: the entry's `split`, which overrides the kind's own (§6). */
  split?: string;
}

const TRUE_TEXT = new Set(['true', 't', 'yes', 'y', '1']);
const FALSE_TEXT = new Set(['false', 'f', 'no', 'n', '0']);
/** The separator a `list` uses when neither the entry nor the kind names one (§6). */
export const DEFAULT_LIST_SEPARATOR = ';';

/** A bare calendar date: no time, no zone, so no instant is involved. */
const BARE_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
/** A full UTC instant, which is how a workbook's time-only cell renders as text. `Z` only. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z$/;
const CLOCK = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;
const YEAR_MONTH = /^(\d{4})-(\d{1,2})$/;
/** A number as a spreadsheet writes one, including 3-digit grouping and exponents. */
const NUMERIC = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
/** The same with a decimal comma and `.` grouping: `1.234,5`. */
const NUMERIC_COMMA = /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?(?:[eE][+-]?\d+)?$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const fail = (code: 'CELL_FORMAT' | 'CELL_UNKNOWN_OPTION' | 'CELL_LIST_ITEM', error: string): CoerceOutcome => ({
  error,
  code,
});
const NONE: CoerceOutcome = { value: undefined };

/**
 * Number text as a number, or `null`. Matched against a shape: `Number()` reads `0x10` as 16,
 * and stripping commas first turns the plainly broken `1,2,3` into 123.
 */
function parseNumberText(text: string, decimal: '.' | ','): number | null {
  const canonical =
    decimal === ','
      ? NUMERIC_COMMA.test(text)
        ? text.replace(/\./g, '').replace(',', '.')
        : null
      : NUMERIC.test(text)
        ? text.replace(/,/g, '')
        : null;
  if (canonical === null) return null;
  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A calendar date, with no instant in sight. The ISO shape is read as text, because
 * `new Date('2024-03-07')` is UTC midnight and reads back a day early west of Greenwich.
 * Other spellings go through `Date`, which parses them as local time, so local parts are right
 * there. An impossible date such as `2024-02-30` is `null`, never rolled forward.
 */
function parseCalendarDate(text: string): { year: number; month: number; day: number } | null {
  const bare = BARE_DATE.exec(text);
  if (bare) {
    const year = Number(bare[1]);
    const month = Number(bare[2]);
    const day = Number(bare[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    const real = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
    return real ? { year, month, day } : null;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

/** A typed `Date` by its UTC parts: a spreadsheet stores a calendar date at UTC midnight. */
function typedDate(kind: ValueKind['kind'], raw: Date): CoerceOutcome | null {
  if (Number.isNaN(raw.getTime())) return fail('CELL_FORMAT', 'Cell is not a valid date');
  const ymd = `${raw.getUTCFullYear()}-${pad2(raw.getUTCMonth() + 1)}-${pad2(raw.getUTCDate())}`;
  switch (kind) {
    case 'date':
      return { value: ymd };
    case 'month':
      return { value: ymd.slice(0, 7) };
    case 'datetime':
      return { value: raw.toISOString() };
    case 'time':
      // A time-only cell is a fraction of a day against an epoch date, so its clock reading is in UTC.
      return { value: `${pad2(raw.getUTCHours())}:${pad2(raw.getUTCMinutes())}` };
    default:
      // Any other kind reads it as text, through cellText, never String().
      return null;
  }
}

function coerceNumber(kind: Extract<ValueKind, { kind: 'number' }>, raw: unknown, text: string, decimal: '.' | ','): CoerceOutcome {
  const value = typeof raw === 'number' ? raw : parseNumberText(text, decimal);
  if (value === null || !Number.isFinite(value)) return fail('CELL_FORMAT', `"${text}" is not a number`);
  // Whether 1.5 is a whole number does not depend on how the cell arrived.
  if (kind.integer && !Number.isInteger(value)) return fail('CELL_FORMAT', `"${text}" is not a whole number`);
  return { value };
}

function coerceEnum(kind: Extract<ValueKind, { kind: 'enum' }>, text: string): CoerceOutcome {
  const wanted = text.toLowerCase();
  const index = kind.values.findIndex(
    (value, i) => cellText(value).toLowerCase() === wanted || kind.labels?.[i]?.toLowerCase() === wanted,
  );
  if (index >= 0) return { value: kind.values[index] };
  const allowed = kind.values.map((value, i) => kind.labels?.[i] ?? cellText(value)).filter(Boolean);
  return fail('CELL_UNKNOWN_OPTION', `"${text}" is not one of: ${allowed.join(', ')}`);
}

function coerceList(kind: Extract<ValueKind, { kind: 'list' }>, raw: unknown, options: CoerceValueOptions): CoerceOutcome {
  // A typed cell — a number, a date, a boolean — is a one-item list (§6).
  const parts =
    typeof raw === 'string'
      ? raw
          .split(options.split ?? kind.separator ?? DEFAULT_LIST_SEPARATOR)
          .map(part => part.trim())
          .filter(Boolean)
      : [raw];
  const values: unknown[] = [];
  for (const [i, part] of parts.entries()) {
    // The separator belongs to this list, not to a list nested in it.
    const outcome = coerceValue(kind.of, part, { decimal: options.decimal });
    if ('error' in outcome) return fail('CELL_LIST_ITEM', `item ${i + 1}: ${outcome.error}`);
    if (outcome.value !== undefined) values.push(outcome.value);
  }
  return values.length ? { value: values } : NONE;
}

/**
 * Read one cell as `kind`. A cell that already has a type is read as that type before
 * anything is stringified; everything else is trimmed text.
 *
 * Throws for a `custom` kind: only the adapter can read one, so reaching here means the
 * adapter's `coerce` returned `null` for a kind it alone understands — an adapter bug (§7).
 */
export function coerceValue(kind: ValueKind, raw: unknown, options: CoerceValueOptions = {}): CoerceOutcome {
  if (kind.kind === 'custom') {
    throw new Error('A "custom" value kind must be read by the adapter\'s coerce; it returned null for one.');
  }
  if (raw === null || raw === undefined) return NONE;
  if (kind.kind === 'list') return typeof raw === 'string' && raw.trim() === '' ? NONE : coerceList(kind, raw, options);

  if (raw instanceof Date) {
    const typed = typedDate(kind.kind, raw);
    if (typed) return typed;
  }
  if (typeof raw === 'boolean' && kind.kind === 'boolean') return { value: raw };

  const text = cellText(raw).trim();
  if (text === '') return NONE;

  switch (kind.kind) {
    case 'string':
      return { value: text };
    case 'number':
      return coerceNumber(kind, raw, text, options.decimal ?? '.');
    case 'boolean': {
      const lower = text.toLowerCase();
      if (TRUE_TEXT.has(lower)) return { value: true };
      if (FALSE_TEXT.has(lower)) return { value: false };
      return fail('CELL_FORMAT', `"${text}" is not true or false`);
    }
    case 'date': {
      const parsed = parseCalendarDate(text);
      return parsed ? { value: `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}` } : fail('CELL_FORMAT', `"${text}" is not a date`);
    }
    // The one kind that genuinely is an instant, so it may go through `Date`.
    case 'datetime': {
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? fail('CELL_FORMAT', `"${text}" is not a date and time`) : { value: parsed.toISOString() };
    }
    case 'month': {
      const match = YEAR_MONTH.exec(text);
      if (match) {
        const month = Number(match[2]);
        return month >= 1 && month <= 12 ? { value: `${match[1]}-${pad2(month)}` } : fail('CELL_FORMAT', `"${text}" is not a month`);
      }
      const parsed = parseCalendarDate(text);
      return parsed ? { value: `${parsed.year}-${pad2(parsed.month)}` } : fail('CELL_FORMAT', `"${text}" is not a month and year`);
    }
    case 'time': {
      const match = CLOCK.exec(text) ?? UTC_INSTANT.exec(text);
      const hours = Number(match?.[1]);
      const minutes = Number(match?.[2]);
      if (!match || hours > 23 || minutes > 59) return fail('CELL_FORMAT', `"${text}" is not a time (HH:mm)`);
      return { value: `${pad2(hours)}:${match[2]}` };
    }
    case 'enum':
      return coerceEnum(kind, text);
  }
}
