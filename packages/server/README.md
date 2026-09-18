# @dynamic-entity/server

> Streaming spreadsheet import for [`@dynamic-entity/core`](https://www.npmjs.com/package/@dynamic-entity/core), with an Express adapter.

[![npm](https://img.shields.io/npm/v/@dynamic-entity/server.svg)](https://www.npmjs.com/package/@dynamic-entity/server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

The import wizard in `ngx-dynamic-entity` works with **no backend at all** — it reads the file
in the browser and runs the whole import there. This package exists for the one case that
makes that wrong: a fifty-thousand-row workbook, which a browser has nowhere to put.

It re-decides nothing. The mapping, the coercion, the validation and the record shape all come
from `@dynamic-entity/core` — the same functions the browser runs. **A server-side import is
meant to be indistinguishable from a client-side one**, and anywhere this package decided
something core already decides would be a defect rather than an optimisation.

---

## Install

```bash
npm install @dynamic-entity/server @dynamic-entity/core express
```

`express` is an optional peer: it is needed only for the adapter, which lives behind its own
entry point. Node 20 or newer.

---

## The Express adapter

```ts
import express from 'express';
import { createImportRouter } from '@dynamic-entity/server/express';
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';

// Your own — a config you authored, the rules you render the form with, your database.
declare const employeeConfig: EntityFormConfig;
declare const employeeRules: FormRule[];
declare const db: { insertMany(entity: string, records: Record<string, unknown>[]): Promise<void> };

const app = express();

app.use(
  '/api/import',
  createImportRouter({
    configs: { employee: employeeConfig },
    rules: { employee: employeeRules },
    // Every `listName` any config mentions. A server has no LOOKUP_REGISTRY, and the router
    // refuses to start if one is missing — see "Lookups" below.
    lookups: { statuses: [{ en: 'Active' }, { en: 'Inactive' }] },
    async onImport(records, { entity, request }) {
      await db.insertMany(entity, records);
    },
  }),
);
```

| Route | Does |
|---|---|
| `GET /:entity/template?fields=&format=` | Streams a CSV or xlsx template. No `fields` means every column |
| `POST /:entity/preview` | multipart → headers, a sample, a suggested mapping, a row count |
| `POST /:entity/validate` | The identical import pipeline with **no** writing — every error, nothing stored. Answers `written: false` |
| `POST /:entity/import` | multipart + a `plan` field → runs the import, calling `onImport` per batch. Answers `written: true` |

`configs` may be a **function** rather than a map, so an app that keeps its configs in a
database does not need a restart to add an entity. The map key is a **route segment and nothing
else** — mount `{ employees: employeeConfig }` and the route is `/employees/…` while the
download is still named from `config.entity`.

`/validate` and `/import` answer with the same body shape. `imported` counts records the run
*produced*; `written` says whether they were stored. Read them together — on `/validate`,
`imported` is what would have been written.

The counts reconcile: **`imported + skipped + failed === rowsRead`**. `failed` is rows, counted
exactly; `errorCount` is *problems*, and `errors` is a sample of them capped at
`maxReportedErrors`. Do not count the distinct rows in `errors` — that answers how many rows
fitted inside the cap, which on a thousand-row file with two hundred failures is seven.

### The client half

```typescript
// app.config.ts
import { provideNgxDynamicEntity, provideHttpImportTransport } from 'ngx-dynamic-entity';

export const providers = [
  provideNgxDynamicEntity({}),
  provideHttpImportTransport({ baseUrl: '/api/import' }),
];
```

The wizard components do not change: they already talk to an `ImportTransport`, which is what
the seam was for.

---

## Without Express

The package root exports the whole engine with no framework in it. A Fastify, Nest or Next
route wires it in the same few lines the Express adapter does — the adapter is one caller, not
the shape of the package.

```ts
import { runImport } from '@dynamic-entity/server';
import type { EntityFormConfig, ImportLookups, MappingPlan } from '@dynamic-entity/core';
import type { Readable } from 'node:stream';

declare const body: Readable;   // anything you can `for await` bytes out of
declare const plan: MappingPlan;
declare const config: EntityFormConfig;
declare const lookups: ImportLookups;
declare const db: { insertMany(records: Record<string, unknown>[]): Promise<void> };

const result = await runImport({
  stream: body,
  plan,
  config,
  lookups,
  limits: { batchSize: 500 },
  onBatch: async records => {
    await db.insertMany(records);   // awaited — this is the backpressure
  },
});

console.log(`imported ${result.imported}, skipped ${result.skipped}`);
```

`runImport` pulls rows off the reader in batches, hands each batch to core's `applyMapping`,
**awaits** `onBatch`, and drops the batch. Peak memory is a function of `batchSize`, not of the
file's size — which is the entire reason this package exists.

---

## Four things to know before you deploy this

### 1. An import is not transactional

**A failure part-way through leaves the rows before it written.** There is no rollback: the
package does not own your database and cannot own your transaction. `POST /:entity/validate`
is the answer — it runs the identical pipeline with no writing, so a user can see every problem
in the file before anything at all is stored.

**`onImport` must be idempotent.** A stream that fails at row 30,000 has written 29,999
records, and over HTTP a retry is *likely* rather than possible — a client, a proxy or a user
will send the same file again. Deduplication is yours: an `EntityFormConfig` has no natural-key
concept for this package to deduplicate on.

### 2. Lookups are checked at startup

A `listName` field resolves against a named list. The browser has `LOOKUP_REGISTRY`; a server
has nothing, so an unsupplied list means the raw cell text is stored — a value that renders
correctly and matches nothing, in every rule and every option comparison that names it.

So `createImportRouter` **throws at construction** when a config mentions a list you did not
supply, naming the list. A silent wrong value found in a database next quarter is the expensive
failure; an app that will not boot is the cheap one.

### 3. Authentication, authorization and concurrency are yours

The router is mounted inside your app, behind your middleware. Nothing here checks who is
asking, and nothing here limits how many imports run at once. See [SECURITY.md](../../SECURITY.md).

### 4. The file is uploaded twice

Preview reads it, import reads it again. Server-side staging with a token would fix that and
bring a temp-file lifecycle, a TTL, cleanup and an unbounded-storage surface with it — a worse
trade for a first slice. Slicing a prefix for the preview does not work either: a zip's central
directory is at the *end* of the file.

---

## Limits

Every limit has a **finite default**, and each is enforced *during* streaming rather than after
— a guard that runs once the file is in memory has already lost. Raise one where you need to;
nobody has to know it exists to be protected by it.

```ts
import { createImportRouter } from '@dynamic-entity/server/express';
import type { ImportRouterOptions } from '@dynamic-entity/server/express';

declare const options: ImportRouterOptions;

createImportRouter({ ...options, limits: { maxBytes: 50 * 1024 * 1024, batchSize: 1000 } });
```

| Limit | Default | Bounds |
|---|---|---|
| `maxBytes` | 10 MB | The upload, counted as bytes arrive |
| `maxRows` / `maxColumns` / `maxCellLength` | 200,000 / 512 / 32,768 | The sheet |
| `maxUncompressedBytes` | 200 MB | What an `.xlsx` inflates to, checked *as it inflates* |
| `maxCompressionRatio` / `maxZipEntries` | 200 / 512 | Zip bombs |
| `batchSize` | 500 | Rows in memory at once |
| `maxReportedErrors` | 200 | Error objects **retained**. `errorCount` and `failed` stay exact |
| `maxFields` / `maxFieldBytes` / `maxFieldNameBytes` / `maxFiles` | 16 / 1 MB / 200 / 1 | Multipart abuse |
| `idleTimeoutMs` / `totalTimeoutMs` | 30 s / 10 min | Stalled and never-ending uploads |

`maxCellLength` is doing double duty: `validators.pattern` is a config-supplied regex that runs
against cell text, and on a server that text is attacker-chosen. Bounding the input bounds a
catastrophic backtrack. See [SECURITY.md](../../SECURITY.md).

---

## What it holds in memory

Stated rather than left to be discovered:

- **CSV streams properly.** Rows are read incrementally and never accumulated.
- **Exactly one worksheet is read** — the lowest-numbered `sheetN.xml`, not whichever the
  archive happens to list first. True tab order lives in `workbook.xml` and is not parsed; the
  sheet number is what exceljs matches on and is a great deal closer than byte order.
- **An `.xlsx` holds the archive, compressed** — bounded by `maxBytes`, so a few megabytes for
  a fifty-thousand-row workbook. The archive is read and rebuilt before the parser sees it, for
  two reasons: the only place its inflated size is knowable early is there, and exceljs's
  streaming reader loses entries when a worksheet precedes the shared strings. The inflated
  sheet XML is never held.
- **Errors are capped** at `maxReportedErrors`. The response carries the retained sample plus a
  true `errorCount` and a `truncated` flag, so a report never quietly reads as complete.

---

## Formats

Decided by the file's **first bytes**, never by its name — an attacker who wants a zip parsed
will name their zip `.csv`.

- **CSV** — through core's dependency-free incremental parser. UTF-8, with or without a BOM.
- **`.xlsx`** — through `exceljs`. Cells keep their types: a date cell arrives as a `Date` at
  UTC midnight and is read as the calendar date it is, in every timezone.
- A pre-2007 `.xls` and a UTF-16 file are **named** rather than parsed into nonsense.

---

## Licence

MIT © Nizamudeen
