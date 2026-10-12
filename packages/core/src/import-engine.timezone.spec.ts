/**
 * Dates must not move with the timezone of the machine reading them.
 *
 * This file exists because of a defect the rest of the suite structurally could not catch.
 * `coerceCell` parsed a bare date with `new Date('2024-03-07')` — which ECMAScript reads as
 * **UTC midnight** — and then formatted it with local getters. Every date shifted back a day
 * for anyone at a negative UTC offset:
 *
 *     TZ=America/New_York  →  startDate "2024-03-07" imported as "2024-03-06"
 *
 * It passed every test, on the author's machine (UTC+5:30) and in CI (GitHub Actions runs
 * UTC), because both are at or ahead of Greenwich. The bug was only ever visible to users in
 * the Americas — the people least likely to be running this suite.
 *
 * **The zone is set by the process, not by this file.** Assigning `process.env.TZ` inside a
 * test looks like it works and does not: Jest hands each test file its own copy of
 * `process.env`, so the write never reaches the hook Node uses to invalidate its timezone
 * cache. The first draft of this file did exactly that and reported thirty passing zone cases
 * that had all silently run in one zone.
 *
 * `scripts/check-timezones.mjs` runs this file once per zone with `TZ` in the real
 * environment. Under a plain `npm test` it still runs, in whatever zone the machine is in.
 *
 * **The second half of this file is the same defect arriving through a different door.** The
 * cases above all pass *text*, and so did the gate — which is why a typed cell walked straight
 * past it. A spreadsheet reader hands back a JS `Date` for a date cell, `String(date)` renders
 * local time, and the day moved again. A gate only ever catches what it is given, so it is now
 * given typed values too.
 */

import { applyMapping, coerceCell } from './import-engine';
import type { EntityFormConfig, NestedFieldConfig } from './form-model.types';

const DATE_FIELD: NestedFieldConfig = { id: 'startDate', type: 'date', label: { en: 'Start' } };
const MONTH_FIELD: NestedFieldConfig = { id: 'period', type: 'monthYear', label: { en: 'Period' } };

const CONFIG: EntityFormConfig = {
  entity: 'dated',
  version: 1,
  tabs: [{ id: 'tab', label: { en: 'Tab' }, fields: [DATE_FIELD, MONTH_FIELD] }],
};

/** What the run is actually proving, named so a failure says where it happened. */
const ZONE = process.env['TZ'] ?? 'the machine default';
const OFFSET = new Date('2024-03-07T00:00:00Z').getTimezoneOffset();

describe(`a bare date carries no timezone (TZ=${ZONE}, offset ${OFFSET})`, () => {
  it('reads a date as the day it says, not the day before', () => {
    expect(coerceCell(DATE_FIELD, '2024-03-07')).toEqual({ value: '2024-03-07' });
    expect(coerceCell(DATE_FIELD, '2024-3-7')).toEqual({ value: '2024-03-07' });
  });

  it('holds the boundaries a day either side of which is a different month', () => {
    expect(coerceCell(DATE_FIELD, '2024-01-01')).toEqual({ value: '2024-01-01' });
    expect(coerceCell(DATE_FIELD, '2024-12-31')).toEqual({ value: '2024-12-31' });
    expect(coerceCell(DATE_FIELD, '2024-02-29')).toEqual({ value: '2024-02-29' });
  });

  it('does not let a date slip into the previous month', () => {
    expect(coerceCell(MONTH_FIELD, '2024-03-01')).toEqual({ value: '2024-03' });
    expect(coerceCell(MONTH_FIELD, '2024-03')).toEqual({ value: '2024-03' });
  });

  it('round-trips a full import unchanged', () => {
    const result = applyMapping(
      [['2024-03-07']],
      { entity: 'dated', entries: [{ ref: 'tab.startDate', column: 0 }] },
      CONFIG,
      { stamp: false },
    );

    expect(result.errors).toEqual([]);
    expect(result.records[0]).toEqual({ tab: { startDate: '2024-03-07' } });
  });

  it('still reads an instant as an instant', () => {
    // A datetime genuinely *is* a point in time, so it is expected to normalise to UTC. That
    // is the distinction the fix rests on, not an inconsistency with the cases above.
    const when: NestedFieldConfig = { id: 'at', type: 'datetime', label: { en: 'At' } };
    expect(coerceCell(when, '2024-03-07T09:30:00.000Z')).toEqual({
      value: '2024-03-07T09:30:00.000Z',
    });
  });

  it('agrees with a date built from parts in this zone', () => {
    // Sanity: whatever the zone, the seventh of March is the seventh of March.
    const local = new Date(2024, 2, 7);
    const asText = `${local.getFullYear()}-03-0${local.getDate()}`;
    expect(coerceCell(DATE_FIELD, asText)).toEqual({ value: '2024-03-07' });
  });
});

describe(`a typed date cell carries no timezone either (TZ=${ZONE}, offset ${OFFSET})`, () => {
  /**
   * What a spreadsheet reader actually hands back for `2024-03-07` in a date-formatted cell:
   * UTC midnight, because an Excel date is a calendar date with no zone and that is how one
   * is represented without inventing an offset.
   */
  const cell = (iso: string): Date => new Date(iso);

  it('reads a UTC-midnight date cell as the day it says', () => {
    // Verified to fail before `coerceTypedCell` existed: `String(raw)` rendered local time,
    // so this returned 2024-03-06 at every negative offset.
    expect(coerceCell(DATE_FIELD, cell('2024-03-07T00:00:00.000Z'))).toEqual({
      value: '2024-03-07',
    });
  });

  it('holds the boundaries a typed cell is most likely to fall off', () => {
    expect(coerceCell(DATE_FIELD, cell('2024-01-01T00:00:00.000Z'))).toEqual({
      value: '2024-01-01',
    });
    expect(coerceCell(DATE_FIELD, cell('2024-12-31T00:00:00.000Z'))).toEqual({
      value: '2024-12-31',
    });
    expect(coerceCell(DATE_FIELD, cell('2024-02-29T00:00:00.000Z'))).toEqual({
      value: '2024-02-29',
    });
  });

  it('does not let a typed cell slip into the previous month', () => {
    expect(coerceCell(MONTH_FIELD, cell('2024-03-01T00:00:00.000Z'))).toEqual({ value: '2024-03' });
    expect(coerceCell(MONTH_FIELD, cell('2024-01-01T00:00:00.000Z'))).toEqual({ value: '2024-01' });
  });

  it('agrees with the text spelling of the same cell, in every zone', () => {
    // The whole parity claim in one line: a file read as CSV and the same file read as xlsx
    // must produce the same record.
    expect(coerceCell(DATE_FIELD, cell('2024-03-07T00:00:00.000Z'))).toEqual(
      coerceCell(DATE_FIELD, '2024-03-07'),
    );
  });

  it('still reads a typed instant as an instant', () => {
    const when: NestedFieldConfig = { id: 'at', type: 'datetime', label: { en: 'At' } };
    expect(coerceCell(when, cell('2024-03-07T09:30:00.000Z'))).toEqual({
      value: '2024-03-07T09:30:00.000Z',
    });
  });

  it("reads a time-only cell by its clock reading, not the machine's", () => {
    const at: NestedFieldConfig = { id: 'at', type: 'time', label: { en: 'At' } };
    // Excel stores a time as a fraction of a day against an epoch date.
    expect(coerceCell(at, new Date('1899-12-30T09:05:00.000Z'))).toEqual({ value: '09:05' });
  });

  it('reads a time-only cell the same whether it arrives typed or as text', () => {
    // A spreadsheet's time cell renders to text as a full ISO instant, and a preview sends it
    // that way. The two paths agreeing is what stops a review screen reporting an error for a
    // row the import stores fine — and both read the UTC clock, so neither moves with the zone.
    const at: NestedFieldConfig = { id: 'at', type: 'time', label: { en: 'At' } };
    const cell = new Date('1899-12-30T09:05:00.000Z');

    expect(coerceCell(at, cell)).toEqual({ value: '09:05' });
    expect(coerceCell(at, cell.toISOString())).toEqual(coerceCell(at, cell));
  });

  it('refuses a time carrying an offset rather than guessing which clock was meant', () => {
    // `09:30+05:00` in a field that stores no zone is ambiguous between the clock the author
    // read and the clock UTC would show. Guessing is how a time moves.
    const at: NestedFieldConfig = { id: 'at', type: 'time', label: { en: 'At' } };
    expect(coerceCell(at, '2024-03-07T09:30:00+05:00')).toEqual({
      error: '"2024-03-07T09:30:00+05:00" is not a time (HH:mm)',
    });
  });

  it('gives a non-temporal field the calendar date rather than a local rendering', () => {
    const note: NestedFieldConfig = { id: 'note', type: 'text', label: { en: 'Note' } };
    expect(coerceCell(note, cell('2024-03-07T00:00:00.000Z'))).toEqual({ value: '2024-03-07' });
    // Not midnight, so nothing can be dropped without losing information.
    expect(coerceCell(note, cell('2024-03-07T09:30:00.000Z'))).toEqual({
      value: '2024-03-07T09:30:00.000Z',
    });
  });

  it('rejects an invalid date cell instead of rendering "Invalid Date"', () => {
    expect(coerceCell(DATE_FIELD, new Date('nonsense'))).toEqual({
      error: 'Cell is not a valid date',
    });
  });

  it('round-trips a typed cell through a full import unchanged', () => {
    const result = applyMapping(
      [[cell('2024-03-07T00:00:00.000Z')]],
      { entity: 'dated', entries: [{ ref: 'tab.startDate', column: 0 }] },
      CONFIG,
      { stamp: false },
    );

    expect(result.errors).toEqual([]);
    expect(result.records[0]).toEqual({ tab: { startDate: '2024-03-07' } });
  });
});

/**
 * A date written in digits, such as 05/09/2026.
 *
 * Until 2.5.0 anything that was not YYYY-MM-DD went to `Date`, which reads month first. A
 * sheet of day-first dates imported as the wrong days, with no error (docs/de-date-order-issue.md).
 * A date that reads two ways is now refused unless the import states its order.
 *
 * "Exactly as before" is held against `before2_5`, which is what the engine did: `Date`, then
 * local parts. It is computed in the zone the test runs in, so it is proven in each.
 */
describe(`a date written in digits is read in a stated order, or not at all (TZ=${ZONE})`, () => {
  const DATETIME_FIELD: NestedFieldConfig = { id: 'at', type: 'datetime', label: { en: 'At' } };
  const pad = (n: number): string => String(n).padStart(2, '0');
  /** What 2.4.1 and every release before it made of a date cell that was not YYYY-MM-DD. */
  const before2_5 = (text: string): { value: string } | { error: string } => {
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return { error: `"${text}" is not a date` };
    return { value: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` };
  };
  const refused = { error: expect.stringContaining('date order') };

  it('no longer reads a date that could be either month first', () => {
    for (const text of ['05/09/2026', '5/9/2026', '5-9-2026', '05.09.2026', '12/12/2026', '01/01/2026', '5/9/26']) {
      expect(coerceCell(DATE_FIELD, text)).toEqual(refused);
    }
    expect(coerceCell(MONTH_FIELD, '05/09/2026')).toEqual(refused);
    expect(coerceCell(DATETIME_FIELD, '05/09/2026')).toEqual(refused);
    expect(coerceCell(DATETIME_FIELD, '05/09/2026 10:30')).toEqual(refused);
    expect(coerceCell(DATETIME_FIELD, '05/09/2026, 10:30 PM')).toEqual(refused);
  });

  it('reads it in the order the import states', () => {
    expect(coerceCell(DATE_FIELD, '05/09/2026', { dateOrder: 'DMY' })).toEqual({ value: '2026-09-05' });
    expect(coerceCell(DATE_FIELD, '05/09/2026', { dateOrder: 'MDY' })).toEqual({ value: '2026-05-09' });
    expect(coerceCell(DATE_FIELD, '5.9.2026', { dateOrder: 'DMY' })).toEqual({ value: '2026-09-05' });
    expect(coerceCell(DATE_FIELD, '13/09/2026', { dateOrder: 'DMY' })).toEqual({ value: '2026-09-13' });
    expect(coerceCell(MONTH_FIELD, '05/09/2026', { dateOrder: 'DMY' })).toEqual({ value: '2026-09' });
    expect(coerceCell(MONTH_FIELD, '05/09/2026', { dateOrder: 'MDY' })).toEqual({ value: '2026-05' });
  });

  it('reads a date and time in the stated order, as local time, as a date and time always was', () => {
    // Built from local parts, so the expectation is the same instant in whichever zone this runs.
    expect(coerceCell(DATETIME_FIELD, '05/09/2026 10:30', { dateOrder: 'DMY' })).toEqual({ value: new Date(2026, 8, 5, 10, 30).toISOString() });
    expect(coerceCell(DATETIME_FIELD, '05/09/2026 10:30', { dateOrder: 'MDY' })).toEqual({ value: new Date(2026, 4, 9, 10, 30).toISOString() });
    expect(coerceCell(DATETIME_FIELD, '05/09/2026', { dateOrder: 'DMY' })).toEqual({ value: new Date(2026, 8, 5).toISOString() });
    expect(coerceCell(DATETIME_FIELD, '05/09/2026, 10:30 PM', { dateOrder: 'DMY' })).toEqual({ value: new Date(2026, 8, 5, 22, 30).toISOString() });
    // Stating month first gives exactly what was read before.
    expect(coerceCell(DATETIME_FIELD, '05/09/2026 10:30', { dateOrder: 'MDY' })).toEqual({ value: new Date('05/09/2026 10:30').toISOString() });
  });

  it('refuses, in a stated order, a date that does not exist or that the order does not fit', () => {
    expect(coerceCell(DATE_FIELD, '31/09/2026', { dateOrder: 'DMY' })).toEqual({ error: '"31/09/2026" is not a date' });
    expect(coerceCell(DATE_FIELD, '09/31/2026', { dateOrder: 'DMY' })).toEqual({ error: '"09/31/2026" is not a date' });
    expect(coerceCell(DATE_FIELD, '13/09/2026', { dateOrder: 'MDY' })).toEqual({ error: '"13/09/2026" is not a date' });
    expect(coerceCell(DATE_FIELD, '05/09/2026', { dateOrder: 'YMD' })).toEqual({ error: '"05/09/2026" is not a date' });
    // No century is chosen for the sheet either.
    expect(coerceCell(DATE_FIELD, '5/9/26', { dateOrder: 'DMY' })).toEqual({ error: '"5/9/26" is not a date' });
    expect(coerceCell(DATETIME_FIELD, '31/09/2026 10:30', { dateOrder: 'DMY' })).toEqual({ error: '"31/09/2026 10:30" is not a date and time' });
    expect(coerceCell(MONTH_FIELD, '31/09/2026', { dateOrder: 'DMY' })).toEqual({ error: '"31/09/2026" is not a month and year' });
  });

  it.each([
    '09/13/2026',
    '9-13-2026',
    '13/09/2026',
    '31/09/2026',
    '2026/09/05',
    '2026.09.05',
    'March 7, 2024',
    '7 Mar 2024',
    'Sep 5 2026',
    '13/13/2026',
    'not a date',
  ])('reads %s, which is not ambiguous, exactly as before', text => {
    expect(coerceCell(DATE_FIELD, text)).toEqual(before2_5(text));
  });

  it('reads an ISO date exactly as before, whatever order is stated', () => {
    for (const dateOrder of [undefined, 'DMY', 'MDY', 'YMD'] as const) {
      expect(coerceCell(DATE_FIELD, '2026-09-05', { dateOrder })).toEqual({ value: '2026-09-05' });
      expect(coerceCell(DATE_FIELD, '2026-9-5', { dateOrder })).toEqual({ value: '2026-09-05' });
      expect(coerceCell(DATE_FIELD, '2026-02-30', { dateOrder })).toEqual({ error: '"2026-02-30" is not a date' });
      expect(coerceCell(MONTH_FIELD, '2026-09', { dateOrder })).toEqual({ value: '2026-09' });
      expect(coerceCell(DATETIME_FIELD, '2026-09-05T10:30:00Z', { dateOrder })).toEqual({ value: '2026-09-05T10:30:00.000Z' });
      // Year first with slashes was never ambiguous, and still goes the way it went.
      expect(coerceCell(DATE_FIELD, '2026/09/05', { dateOrder })).toEqual(before2_5('2026/09/05'));
    }
  });

  it('reads a typed date cell exactly as before, whatever order is stated', () => {
    const cell = new Date(Date.UTC(2026, 8, 5));
    for (const dateOrder of [undefined, 'DMY', 'MDY', 'YMD'] as const) {
      expect(coerceCell(DATE_FIELD, cell, { dateOrder })).toEqual({ value: '2026-09-05' });
      expect(coerceCell(MONTH_FIELD, cell, { dateOrder })).toEqual({ value: '2026-09' });
    }
  });

  it('carries the order from applyMapping to every row, and fails a row it would have had to guess', () => {
    const plan = { entity: 'dated', entries: [{ ref: 'tab.startDate', column: 0 }] };
    const rows = [['05/09/2026'], ['2026-09-06'], ['13/09/2026']];
    const stated = applyMapping(rows, plan, CONFIG, { dateOrder: 'DMY', stamp: false });
    expect(stated.errors).toEqual([]);
    expect(stated.records).toEqual([{ tab: { startDate: '2026-09-05' } }, { tab: { startDate: '2026-09-06' } }, { tab: { startDate: '2026-09-13' } }]);

    const unstated = applyMapping(rows, plan, CONFIG, { stamp: false });
    expect(unstated.records).toEqual([{ tab: { startDate: '2026-09-06' } }]);
    expect(unstated.errors.map(error => [error.row, error.ref])).toEqual([
      [2, 'tab.startDate'],
      [4, 'tab.startDate'],
    ]);
    expect(unstated.errors[0].message).toContain('date order');
    // Row 4 was never readable month first, and fails with the message it always had.
    expect(unstated.errors[1].message).toBe('"13/09/2026" is not a date');
  });
});
