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
