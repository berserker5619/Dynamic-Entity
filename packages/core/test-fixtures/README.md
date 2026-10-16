# Test Fixtures

Real-world spreadsheet workbooks and golden files used for cross-platform and cross-engine testing.

## Files

- `case1_1904_dates.xlsx`: Mac Excel 1904 epoch date test (`date1904="1"`). Asserts dates before 1970 and modern dates do not drift by 1462 days.
- `case2_numeric_identifiers.xlsx`: Numeric cells (`<c t="n">`) holding phone numbers, postal codes, safe 16-digit IDs, and unsafe integer IDs mapped to string fields.
- `case4_complex_sheet.xlsx`: Workbook with merged header range (`A1:B1`), hidden column (`F`), calculated formula cells (`Total`), duplicate header names (`Status`), multiple sheets (`Sales`, `Instructions`), and trailing empty styled rows.
- `xlsx-parity.ts`: Helper constructing synthetic workbooks for browser vs server parity tests.
- `preview-parity.ts` / `problem-fixtures.ts`: Golden schema and error fixtures.

## Regeneration

To regenerate `case1`, `case2`, and `case4`:

```bash
node packages/core/test-fixtures/generate-fixtures.mjs
```

All test suites (`real-world-fixtures.spec.ts` in `packages/ngx-dynamic-entity` and `packages/server`) run against these files.
