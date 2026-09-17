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
