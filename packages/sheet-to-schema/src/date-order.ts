/**
 * date-order.ts — a date written in digits, read in a stated order or not at all (spec §8).
 *
 * `05/09/2026` is 5 September to most of the world and 9 May to the rest, and nothing in the
 * cell says which. `Date` reads it month first, without an error, so a sheet of day-first
 * dates imported as the wrong days. Here such a date is read in the order its entry gives
 * (`MappingEntry.dateOrder`), or in the only order that fits it, and is otherwise refused.
 *
 * - A four-digit first part is the year: `2026-09-05`, `2026/9/5`. Always year first.
 * - Otherwise the year is the last part, and must be four digits: no century is guessed.
 * - With no order given, a first part over 12 is a day and a second part over 12 is a day.
 *   When both are 12 or less the date is ambiguous.
 */
import { cellText } from './cell-text';

/** The order of the parts in a date written in digits. */
export type DateOrder = 'DMY' | 'MDY' | 'YMD';
export const DATE_ORDERS: readonly DateOrder[] = ['DMY', 'MDY', 'YMD'];

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Three runs of digits with `/`, `-` or `.` between them. */
const NUMERIC_DATE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/;

/** The date, when that day exists. Built in UTC only to check it; no local time is consulted. */
function real(year: number, month: number, day: number): CalendarDate | null {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day ? { year, month, day } : null;
}

/**
 * Read `text` as a date written in digits.
 *
 * `undefined` when it is not written that way at all, `null` when it is but names no date,
 * and `'ambiguous'` when it reads two ways and `order` does not say which.
 */
export function readNumericDate(text: string, order?: DateOrder): CalendarDate | 'ambiguous' | null | undefined {
  const match = NUMERIC_DATE.exec(text);
  if (!match) return undefined;
  const [, first, second, third] = match;
  if (first.length === 4) return third.length <= 2 ? real(Number(first), Number(second), Number(third)) : null;
  if (first.length > 2 || third.length !== 4 || order === 'YMD') return null;

  const a = Number(first);
  const b = Number(second);
  const found = order ?? (a > 12 && b <= 12 ? 'DMY' : b > 12 && a <= 12 ? 'MDY' : a <= 12 && b <= 12 ? null : undefined);
  if (found === null) return 'ambiguous';
  if (found === undefined) return null;
  return found === 'DMY' ? real(Number(third), b, a) : real(Number(third), a, b);
}

/**
 * The order one column's dates are written in, from sample cells, or `undefined` when they
 * do not say or do not agree (spec §8, `suggestMapping`).
 *
 * A four-digit first part is year first, a first part over 12 is day first, and a second
 * part over 12 is month first. Only text is evidence: a typed date cell has no order. A cell
 * may hold several dates (a split list) or a date and a time.
 */
export function inferDateOrder(cells: readonly unknown[], split = ';'): DateOrder | undefined {
  const seen = new Set<DateOrder>();
  for (const cell of cells) {
    if (typeof cell !== 'string') continue;
    for (const part of cellText(cell).split(split)) {
      const match = NUMERIC_DATE.exec(part.trim().split(/[ T]/)[0]);
      if (!match) continue;
      if (match[1].length === 4) seen.add('YMD');
      else if (Number(match[1]) > 12) seen.add('DMY');
      else if (Number(match[2]) > 12) seen.add('MDY');
    }
  }
  return seen.size === 1 ? [...seen][0] : undefined;
}
