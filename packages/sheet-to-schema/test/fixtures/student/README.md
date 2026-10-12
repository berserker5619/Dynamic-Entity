# Prototype student fixture

Reference fixture for the `exampleJsonAdapter` acceptance item: a structure given as an
example record, not as a JSON Schema.

## Where it came from

The same prototype as the order fixture: `../order/schema-mapper.html`, built on 10 Oct 2026
and never committed to the repo before these fixtures. See `../order/README.md`.

- `example.json`: the prototype's `SAMPLE_JSON`, verbatim. One example student.
- `sample.csv`: the prototype's `SAMPLE_JSON_CSV`, verbatim (4 rows).
- `expected-output.json`: the 2 records the prototype builds from them.
- `run.json`: the same run in full: auto-detected group key, list modes, column bindings,
  and per-record issues with source rows (1-based, header = row 1).

`expected-output.json` and `run.json` were produced on 12 Oct 2026 by running the prototype's
own code (applySchema on the example, then autoMap, then buildRecords) headlessly in Node.
Nothing was written by hand.

## What the run shows

- The structure is read as "example JSON": kinds come from the example's values.
- Group key: `Student ID`, so 4 rows become 2 students.
- `guardians`: numbered columns, 2 slots, though the example has one guardian. The second
  slot comes from the sheet's `Guardian 2 …` headers.
- `subjects`: one per row. `clubs`: split on `;`.
- One seeded error:

| Student | Path | Issue | Rows |
|---|---|---|---|
| S-205 | subjects[].marks | not a whole number ("sixty") | 5 |

So S-204 is the only clean record.

## Caveats when comparing

As for the order fixture, the prototype is a reference, not a contract:
- Dates are read as DD/MM/YYYY and output as ISO `YYYY-MM-DD`.
- `yes`/`no` become booleans.
- A value that fails conversion is kept raw in the output: `marks: "sixty"`.
- The prototype reads `marks: 91` in the example as an integer. `exampleJsonAdapter` reads a
  number, never an integer, since one example is not a bound.
