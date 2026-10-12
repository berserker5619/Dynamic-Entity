# Dynamic Entity reads slash dates month first, without saying so

Status: open, found 2026-10-12. Not fixed. This note describes the behaviour, which releases
have it, and a proposed fix. The generic importer (`sheet-to-schema`) no longer has it; see
`docs/import-phase1-spec.md`, "Generic coercion".

## What happens

A `date` field's cell that is not written as `YYYY-MM-DD` is handed to JavaScript's `Date`
(`parseCalendarDate` in `packages/core/src/import-engine.ts`). `Date` reads a date written in
digits month first. So a sheet of day-first dates, which is how most of the world writes
them, imports like this:

| Cell | Meant (day first) | Imported as | Error? |
| --- | --- | --- | --- |
| `05/09/2026` | 5 September | `2026-05-09` (9 May) | none |
| `12/01/2026` | 12 January | `2026-12-01` (1 December) | none |
| `13/09/2026` | 13 September | nothing | `"13/09/2026" is not a date` |
| `31/09/2026` | not a real date | nothing | `"31/09/2026" is not a date` |

The first two rows are the problem. The record is saved with a wrong date and nothing tells
the user. The third row is what usually reveals it: in a day-first sheet, every date after the
12th of a month fails, and every date up to the 12th imports as a different day.

The same fallback is used by two other field types:

- `monthYear`: `05/09/2026` is stored as `2026-05`.
- `datetime`: `05/09/2026 10:30` is stored as 9 May, 10:30 local time.

Typed date cells from an `.xlsx` are not affected. They arrive as dates, not text, and are
read by their UTC parts. The problem is text: CSV files, and workbook cells formatted as text.

## Which releases

Every release that has the import engine: **1.14.0 through 2.4.1**, in the browser wizard and
on the server alike, since both call `coerceCell`.

- Checked by running `coerceCell` from the published 2.2.0 and 2.4.0 packages and from the
  2.4.1 build: all three return `2026-05-09` for `05/09/2026`.
- Releases from 1.14.0 up to 2.2.0 were checked in the source history, not run. The engine
  was added in `b1a0852`, and the fallback to `Date` has been there since.

The code comments treat this as intended for US-style input: "the other spellings a person
might type (`03/07/2024`, `March 7, 2024`)". It is correct for a month-first sheet. It is
silent and wrong for a day-first one, and the engine cannot tell which it has been given.

## Proposed fix

The same rule the generic importer now uses, brought into DE in two steps so that nothing
that works today breaks in a minor release.

1. **Next minor (additive).**
   - Add `dateOrder?: 'DMY' | 'MDY' | 'YMD'` to `CoerceOptions`, and so to `ApplyMappingOptions`,
     the server's import options and the local transport. With it set, `parseCalendarDate`
     reads a date written in digits in that order, and never through `Date`.
   - Have the preview (browser and server) infer the order per date column from the sample
     rows: a first part over 12 means day first, a second part over 12 means month first. The
     wizard shows what it found and lets the user change it.
   - With no `dateOrder`, keep today's month-first reading, so existing integrations import
     exactly as before.
2. **3.0, with the move to the generic engine (Phase 2).**
   - The order becomes per column: `MappingEntry.dateOrder` in a v2 plan.
   - With no order given, an ambiguous date (both parts 12 or less) becomes an error instead
     of a month-first guess. This is the breaking part, which is why it waits for a major.

Until step 1 ships, the only safe inputs for a DE date column are `YYYY-MM-DD` text or a
typed date cell.

## What to tell users now

Anyone who has imported a CSV whose dates are written day first should check the imported
records: dates on or before the 12th of a month will have day and month swapped. Rows whose
day was over 12 failed with an error at the time and were not imported.

## Not changed by the generic importer's fix

`entityFormConfigAdapter` reads cells with `coerceCell`, so a DE config imported through the
generic engine behaves exactly as DE 2.x does, including this. That is deliberate: the
adapter's contract is parity with 2.x, and changing a date's reading inside it would be a
silent behaviour change of its own.
