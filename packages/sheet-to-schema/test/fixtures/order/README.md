# Prototype order fixture

Reference fixture for the `jsonSchemaAdapter` acceptance item.

## Where it came from

The prototype is `schema-mapper.html`, built on 10 Oct 2026 in the claude.ai chat
"Building packages for Angular and Node.js". It was never committed to the repo.

- `schema-mapper.html`: the prototype, rebuilt from that chat, including its final
  fix (identical issues across grouped rows are merged).
- `schema.json`: the prototype's `SAMPLE_SCHEMA`, verbatim.
- `sample.csv`: the prototype's `SAMPLE_CSV`, verbatim (7 rows).
- `expected-output.json`: the 4 records the prototype builds from them.
- `run.json`: the same run in full: auto-detected group key, list modes, column
  bindings, and per-record issues with source rows (1-based, header = row 1).

`expected-output.json` and `run.json` were produced on 11 Oct 2026 by running the
prototype's own code (autoMap, then buildRecords) headlessly in Node on its sample.
Nothing was written by hand.

## What the run shows

- Group key: `Order ID`, so 7 rows become 4 orders.
- `customer.phones`: numbered columns, 2 slots. `tags`: split on `;`. `items`: one per row.
- The sample is seeded with errors on purpose:

| Order | Path | Issue | Rows |
|---|---|---|---|
| NF-1002 | customer.email | not a valid email | 4 |
| NF-1003 | customer.address.pincode | doesn't match `^\d{6}$` | 5, 6 |
| NF-1003 | items[].qty | not a whole number ("one") | 6 |
| NF-1004 | orderDate | not a real date (31/09) | 7, 8 |
| NF-1004 | payment.method | "Paytm" not in upi/cod/card | 7, 8 |
| NF-1004 | customer.email | warning: grouped rows disagree, first kept | 8 |

So `expected-output.json` is **not** valid against the schema for NF-1002, NF-1003
and NF-1004. That is intended. NF-1001 is the only clean record.

## Caveats when comparing

The prototype predates the spec, so its behaviour is a reference, not a contract:
- Dates are read as DD/MM/YYYY and output as ISO `YYYY-MM-DD`.
- `Yes`/`No` become booleans, and enum values are lower-cased (`UPI` becomes `upi`).
- Values that fail conversion are kept raw in the output: `qty: "one"`,
  `orderDate: "31/09/2026"`, `method: "Paytm"`.
- Its issue messages and row numbering won't match the engine's problem codes.
  Compare paths and rows, not message text.

## In this repository

Committed on 12 Oct 2026 from the folder `order-fixture/order/`, with two files renamed:
`order.schema.json` to `schema.json`, and `orders.csv` to `sample.csv`. Before the commit,
the prototype's code was run again headlessly and reproduced `expected-output.json` and
`run.json` exactly, and `schema.json` and `sample.csv` were checked equal to the
`SAMPLE_SCHEMA` and `SAMPLE_CSV` inside `schema-mapper.html`.

Read by `src/acceptance.spec.ts`. Nothing under `test/` is published: the package's `files`
is `dist` only.
