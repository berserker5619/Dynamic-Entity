/**
 * cell-text.ts — one cell as text, the same way everywhere.
 *
 * A sheet cell is not always a string: a workbook hands over numbers, booleans and `Date`s.
 * Wherever a cell has to become text — a preview sample, a group key, a typed cell given to a
 * text field — it goes through here, so the browser and the server render a cell identically.
 *
 * The same rule as Dynamic Entity 2.4's `cellText` (`core/src/cell-text.ts`), copied rather
 * than imported: the importer depends on nothing in Dynamic Entity.
 */

const DAY_MS = 86_400_000;

/**
 * The text a cell stands for. A `Date` at UTC midnight is the calendar date a spreadsheet
 * stores it as (`YYYY-MM-DD`); any other instant keeps its full ISO form. `String(date)` would
 * render local time, a day early west of Greenwich.
 */
export function cellText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return '';
    const iso = raw.toISOString();
    return raw.getTime() % DAY_MS === 0 ? iso.slice(0, 10) : iso;
  }
  return typeof raw === 'string' ? raw : String(raw);
}
