import { applyMapping, jsonSchemaAdapter, parseCsv, slotsFor, suggestMapping } from 'sheet-to-schema';
import { ImportError } from './errors';
import { GROUPING_NOT_STREAMED, previewSheet, runImport, type OnBatch } from './run-import';
import { chunked, collectedHeap, CSV_TEXT, EMPLOYEES, generatedCsv, HEADERS, PLAN, trackedStream } from './sheet.fixtures';

/** Collect what `onBatch` was handed, for the tests that are about the records themselves. */
function collector(): { onBatch: OnBatch; records: Record<string, unknown>[] } {
  const records: Record<string, unknown>[] = [];
  return {
    records,
    onBatch: batch => {
      records.push(...batch);
    },
  };
}

describe('client and server agree', () => {
  /**
   * The most important test here, and the reason the engine is in the main entry.
   *
   * The browser path is `parseCsv` then `applyMapping` — which is all `LocalImportTransport`
   * is, three lines of arrangement over the same two functions. The server path streams the
   * same bytes through `readSheet` and hands batches to the same `applyMapping`. The two must
   * produce deep-equal records, or "one engine, both sides" is a claim rather than a fact.
   */
  it('produces the same records as the in-browser path, for the same file and plan', async () => {
    const browser = applyMapping(parseCsv(CSV_TEXT).rows, PLAN, EMPLOYEES, undefined);

    const { onBatch, records } = collector();
    const server = await runImport({
      stream: chunked(CSV_TEXT, 5),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      onBatch,
    });

    expect(records).toEqual(browser.records);
    expect(server.imported).toBe(browser.records.length);
    expect(server.skipped).toBe(browser.skipped);
    expect(server.errors).toEqual(browser.errors);
  });

  it('agrees whatever size the bytes arrive in', async () => {
    const browser = applyMapping(parseCsv(CSV_TEXT).rows, PLAN, EMPLOYEES, undefined);

    for (const size of [1, 3, 17, 4096]) {
      const { onBatch, records } = collector();
      await runImport({
        stream: chunked(CSV_TEXT, size),
        plan: PLAN,
        adapter: EMPLOYEES,
        ctx: undefined,
        onBatch,
        limits: { batchSize: 2 },
      });
      expect({ size, records }).toEqual({ size, records: browser.records });
    }
  });

  it('agrees across a batch boundary, which is the seam the browser does not have', async () => {
    // Row numbers and blank-row skipping both have to survive being cut into batches. A
    // batchSize of 1 puts a boundary between every pair of rows, including the blank one.
    const browser = applyMapping(parseCsv(CSV_TEXT).rows, PLAN, EMPLOYEES, undefined);
    const { onBatch, records } = collector();
    const server = await runImport({
      stream: chunked(CSV_TEXT),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      onBatch,
      limits: { batchSize: 1 },
    });

    expect(records).toEqual(browser.records);
    expect(server.skipped).toBe(browser.skipped);
  });

  it('reports a failing row against the number the user sees in their spreadsheet', async () => {
    const text = `${HEADERS.join(',')}\r\nAlice,34,2024-03-07,true,Active\r\nBob,not-a-number,,,\r\n`;
    const server = await runImport({
      stream: chunked(text),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { batchSize: 1 },
    });

    expect(server.errors).toHaveLength(1);
    // Header is row 1, Alice is row 2, Bob is row 3 — and a batchSize of 1 must not reset that.
    expect(server.errors[0].row).toBe(3);
    expect(server.errors[0].ref).toBe('personal.age');
  });
});

describe('the plan is checked before a single row is read', () => {
  const broken = { entity: 'employee', entries: [{ ref: 'personal.nonsense', column: 0 }] };

  it('refuses without pulling the file', async () => {
    let pulled = false;
    async function* watched(): AsyncGenerator<Uint8Array> {
      pulled = true;
      yield Buffer.from(CSV_TEXT);
    }

    const result = await runImport({ stream: watched(), plan: broken, adapter: EMPLOYEES, ctx: undefined });

    expect(result.planProblems.some(p => p.level === 'error' && p.code === 'PLAN_UNKNOWN_REF')).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.rowsRead).toBe(0);
    expect(pulled).toBe(false);
    // And it does not report a format it never looked at. A guessed field is worse than a
    // missing one: it is indistinguishable from a measured one.
    expect(result.format).toBeUndefined();
  });

  it('closes the request body it decided not to read', async () => {
    const { stream, destroyed } = trackedStream(CSV_TEXT);
    await runImport({ stream, plan: broken, adapter: EMPLOYEES, ctx: undefined });
    expect(destroyed()).toBe(true);
  });

  it('never calls onBatch for a plan it refused', async () => {
    const { onBatch, records } = collector();
    await runImport({ stream: chunked(CSV_TEXT), plan: broken, adapter: EMPLOYEES, ctx: undefined, onBatch });
    expect(records).toEqual([]);
  });

  it('lets a warning through — an older config version is not a reason to import nothing', async () => {
    const stale = { ...PLAN, configVersion: 1 };
    const result = await runImport({
      stream: chunked(CSV_TEXT),
      plan: stale,
      adapter: EMPLOYEES,
      ctx: undefined,
    });
    expect(result.planProblems.every(p => p.level !== 'error')).toBe(true);
    expect(result.imported).toBeGreaterThan(0);
  });
});

describe('backpressure', () => {
  /**
   * The property that makes bounded memory true rather than merely likely.
   *
   * A consumer writing to a database is slower than a parser reading a file. If `onBatch` were
   * not awaited, the parser would race ahead and the pending writes would queue — bounded
   * memory turned into an unbounded queue, which is the same failure from the other side.
   */
  it('reads nothing at all while a slow consumer is still writing', async () => {
    // The directly observable form of the claim: between handing a batch over and getting it
    // back, the source must not be touched. A reader that did not await would run ahead here.
    const rows = 2000;
    let text = `${HEADERS.join(',')}\r\n`;
    for (let i = 0; i < rows; i++) text += `Name${i},34,2024-03-07,true,Active\r\n`;

    let pulledChunks = 0;
    let pulledRows = 0;
    let handedRows = 0;
    let worstLead = 0;
    const readAhead: number[] = [];

    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const chunk of chunked(text, 512)) {
        pulledChunks++;
        pulledRows += Buffer.from(chunk).toString('utf8').split(`\r\n`).length - 1;
        worstLead = Math.max(worstLead, pulledRows - handedRows);
        yield chunk;
      }
    }

    await runImport({
      stream: counted(),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { batchSize: 100 },
      onBatch: async records => {
        const at = pulledChunks;
        await new Promise(resolve => setTimeout(resolve, 2));
        readAhead.push(pulledChunks - at);
        handedRows += records.length;
      },
    });

    expect(readAhead.filter(n => n !== 0)).toEqual([]);
    expect(handedRows).toBe(rows);
    // One batch in flight plus the 512-byte chunk the reader is part-way through — nowhere
    // near the 2000 rows an unawaited reader would have queued.
    expect(worstLead).toBeLessThan(200);
  });

  it('hands over no more than batchSize records at a time', async () => {
    const sizes: number[] = [];
    await runImport({
      stream: generatedCsv(450),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { batchSize: 100 },
      onBatch: records => {
        sizes.push(records.length);
      },
    });
    expect(sizes).toEqual([100, 100, 100, 100, 50]);
  });

  it('tells a consumer where each batch sits in the file', async () => {
    const seen: { index: number; firstRow: number; imported: number }[] = [];
    await runImport({
      stream: generatedCsv(250),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { batchSize: 100 },
      onBatch: (_records, info) => {
        seen.push({ ...info });
      },
    });
    expect(seen).toEqual([
      { index: 0, firstRow: 2, imported: 0 },
      { index: 1, firstRow: 102, imported: 100 },
      { index: 2, firstRow: 202, imported: 200 },
    ]);
  });
});

describe('bounded error retention', () => {
  /** Every row fails: `age` is required to be a number and every row says otherwise. */
  const allBad = (rows: number): AsyncGenerator<Uint8Array> =>
    (async function* () {
      yield Buffer.from(`${HEADERS.join(',')}\r\n`, 'utf8');
      let buffer = '';
      for (let i = 0; i < rows; i++) {
        buffer += `Name${i},not-a-number,,,\r\n`;
        if (buffer.length > 32 * 1024) {
          yield Buffer.from(buffer, 'utf8');
          buffer = '';
        }
      }
      if (buffer) yield Buffer.from(buffer, 'utf8');
    })();

  it('caps what it keeps, counts what it saw, and says which', async () => {
    // 50,000 retained error objects is the same unbounded growth as holding the file.
    const result = await runImport({
      stream: allBad(50_000),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { maxReportedErrors: 200, batchSize: 1000 },
    });

    expect(result.errors).toHaveLength(200);
    expect(result.errorCount).toBe(50_000);
    expect(result.truncated).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.rowsRead).toBe(50_000);
  });

  it('does not claim truncation when nothing was truncated', async () => {
    const result = await runImport({
      stream: allBad(5),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { maxReportedErrors: 200 },
    });
    expect(result.errorCount).toBe(5);
    expect(result.errors).toHaveLength(5);
    expect(result.truncated).toBe(false);
  });

  it('counts failing rows exactly, however few of their reasons it kept', async () => {
    // The defect this closes: the wizard reported the distinct rows in the *sample*, which is
    // how a run of a thousand rows with two hundred failures told the user seven.
    const rows = 1000;
    let text = `${HEADERS.join(',')}\r\n`;
    for (let i = 0; i < rows; i++) {
      if (i % 10 === 9) text += '\r\n';
      else if (i % 5 === 0) text += `,not-a-number,nonsense-date,true,Active\r\n`;
      else text += `Name${i},34,2024-03-07,true,Active\r\n`;
    }

    const result = await runImport({
      stream: chunked(text, 8192),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { maxReportedErrors: 20, batchSize: 100 },
      onBatch: () => undefined,
    });

    expect(result.failed).toBe(200);
    expect(result.truncated).toBe(true);
    // What counting the sample would have answered instead.
    expect(new Set(result.errors.map(error => error.row)).size).toBeLessThan(20);
    // And the counts now reconcile, which is the point of reporting them at all.
    expect(result.imported + result.skipped + result.failed).toBe(result.rowsRead);
  });

  it('counts a row that fails twice over as one row to go and fix', async () => {
    const text =
      `${HEADERS.join(',')}\r\n` +
      `,not-a-number,nonsense-date,true,Active\r\n`;
    const result = await runImport({
      stream: chunked(text),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
    });

    expect(result.errorCount).toBeGreaterThan(1);
    expect(result.failed).toBe(1);
  });

  it('keeps the first errors, which are the ones a user can act on', async () => {
    const result = await runImport({
      stream: allBad(10),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { maxReportedErrors: 3, batchSize: 2 },
    });
    expect(result.errors.map(e => e.row)).toEqual([2, 3, 4]);
  });
});

describe('memory is bounded by batchSize, not by file size', () => {
  /**
   * Without this, "streaming" is a claim about the shape of the code.
   *
   * Two things make the measurement mean something. The heap is collected before it is read,
   * so what is measured is what the run is *holding* rather than what it has not got round to
   * dropping — an uncollected heap grows past 60 MB on this file however the code is written,
   * which is a number that would pass whatever it was asserting. And the file is ~10 MB of
   * text, so a run that buffered it would retain the string, the row arrays and the strings
   * inside them: tens of megabytes, against a streaming run's handful.
   */
  const collect = collectedHeap;

  /** ~10 MB: 50,000 rows whose first cell is 200 characters wide. */
  async function* wideCsv(rows: number): AsyncGenerator<Uint8Array> {
    yield Buffer.from(`${HEADERS.join(',')}\r\n`, 'utf8');
    let buffer = '';
    for (let i = 0; i < rows; i++) {
      buffer += `${String(i).padStart(200, 'x')},34,2024-03-07,true,Active\r\n`;
      if (buffer.length >= 256 * 1024) {
        yield Buffer.from(buffer, 'utf8');
        buffer = '';
      }
    }
    if (buffer) yield Buffer.from(buffer, 'utf8');
  }

  it('holds a handful of megabytes while streaming a ten-megabyte file', async () => {
    const before = collect();
    let peak = 0;
    let batches = 0;

    const result = await runImport({
      stream: wideCsv(50_000),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { batchSize: 500, maxBytes: 32 * 1024 * 1024 },
      onBatch: () => {
        // Every twentieth batch: collecting on all hundred of them measures the collector.
        if (batches++ % 20 === 0) peak = Math.max(peak, collect() - before);
      },
    });

    expect(result.imported).toBe(50_000);
    expect(peak).toBeLessThan(24 * 1024 * 1024);
  });
});

describe('onBatch throwing', () => {
  it('aborts the import and says the run was not transactional', async () => {
    const failure = new Error('ECONNREFUSED 10.0.0.4:5432');
    await expect(
      runImport({
        stream: generatedCsv(500),
        plan: PLAN,
        adapter: EMPLOYEES,
        ctx: undefined,
        limits: { batchSize: 100 },
        onBatch: records => {
          if (records.length) throw failure;
        },
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_FAILED' });
  });

  it('keeps the consumer real error for their logger and off the wire', async () => {
    const failure = new Error('ECONNREFUSED 10.0.0.4:5432');
    const caught = await runImport({
      stream: generatedCsv(100),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      onBatch: () => {
        throw failure;
      },
    }).catch(error => error);

    expect((caught as { cause?: unknown }).cause).toBe(failure);
    expect((caught as Error).message).not.toContain('ECONNREFUSED');
    expect((caught as Error).message).toMatch(/not transactional/);
  });

  it('closes the request body rather than leaving the upload half-read', async () => {
    const { stream, destroyed } = trackedStream(CSV_TEXT);
    await runImport({
      stream,
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { batchSize: 1 },
      onBatch: () => {
        throw new Error('nope');
      },
    }).catch(() => undefined);

    expect(destroyed()).toBe(true);
  });

  it('stops pulling rows once it has failed', async () => {
    let chunks = 0;
    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const chunk of generatedCsv(20_000)) {
        chunks++;
        yield chunk;
      }
    }

    await runImport({
      stream: counted(),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      limits: { batchSize: 10 },
      onBatch: () => {
        throw new Error('nope');
      },
    }).catch(() => undefined);

    // The header chunk and the first chunk of rows — the batch built from it threw. A
    // 20,000-row file is ten times that many chunks, and none of the rest were asked for.
    expect(chunks).toBeLessThanOrEqual(3);
  });
});

describe('validating without writing', () => {
  it('is the identical pipeline with no onBatch, and stores nothing', async () => {
    const withWrite = await runImport({
      stream: chunked(CSV_TEXT),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
      onBatch: () => undefined,
    });
    const withoutWrite = await runImport({
      stream: chunked(CSV_TEXT),
      plan: PLAN,
      adapter: EMPLOYEES,
      ctx: undefined,
    });

    expect(withoutWrite).toEqual(withWrite);
  });
});

describe('previewSheet', () => {
  it('returns headers, a sample and a suggestion', async () => {
    const preview = await previewSheet({ stream: chunked(CSV_TEXT), adapter: EMPLOYEES });

    expect(preview.headers).toEqual(HEADERS);
    expect(preview.rowCount).toBe(4);
    expect(preview.sample[0]).toEqual(['Alice', '34', '2024-03-07', 'true', 'Active']);
    expect(preview.suggestion).toMatchObject({ planVersion: 2, target: 'employee', schemaVersion: 3 });
    expect(preview.format).toBe('csv');
    // The schema has no arrays, so there are no slots to size.
    expect(preview.slots).toEqual({});
    expect(preview.suggestion.entries.map(e => e.ref)).toEqual(
      PLAN.entries.map(e => e.ref),
    );
  });

  it('suggests exactly what the browser transport suggests for the same headers', async () => {
    // Both suggest from the same headers over the same adapter. Asserted rather than assumed:
    // a suggestion that differed by side would put the same column into a different field
    // depending on where the file was uploaded.
    const browser = suggestMapping(parseCsv(CSV_TEXT).headers, EMPLOYEES);
    const preview = await previewSheet({ stream: chunked(CSV_TEXT), adapter: EMPLOYEES });
    expect(preview.suggestion).toEqual(browser);
  });

  it('caps the sample without capping the count', async () => {
    const preview = await previewSheet({
      stream: generatedCsv(1000),
      adapter: EMPLOYEES,
      limits: { sampleRows: 2 },
    });
    expect(preview.sample).toHaveLength(2);
    expect(preview.rowCount).toBe(1000);
  });

  it('applies the same limits an import applies', async () => {
    // A preview endpoint that skipped the limits would be the cheapest way in.
    await expect(
      previewSheet({ stream: generatedCsv(100), adapter: EMPLOYEES, limits: { maxRows: 10 } }),
    ).rejects.toMatchObject({ code: 'SHEET_TOO_LARGE' });
  });

  it('closes the request body when a limit refuses the file', async () => {
    const { stream, destroyed } = trackedStream(CSV_TEXT);
    await expect(
      previewSheet({ stream, adapter: EMPLOYEES, limits: { maxRows: 1 } }),
    ).rejects.toThrow();
    expect(destroyed()).toBe(true);
  });
});

/**
 * A separator other than a comma, detected from the header line (`readSheet`), and what it
 * says about the numbers: a `;` file writes `1,5` for one and a half. Fed a byte at a time, so
 * the held header line is split at every boundary.
 */
describe('delimited text that is not comma-separated', () => {
  const AMOUNTS = jsonSchemaAdapter({ $id: 'claims', type: 'object', properties: { name: { type: 'string', title: 'Name' }, amount: { type: 'number', title: 'Amount' } } });
  const PLAN_AMOUNTS = {
    entity: 'claims',
    entries: [
      { ref: 'name', column: 0 },
      { ref: 'amount', column: 1 },
    ],
  };
  const SEMICOLON = 'Name;Amount\r\n"Rao; Jr.";1,500\r\nAda;1.234,5\r\n';

  it('previews a semicolon file in its own columns and says how it was split', async () => {
    const preview = await previewSheet({ stream: chunked(SEMICOLON, 1), adapter: AMOUNTS });
    expect(preview.headers).toEqual(['Name', 'Amount']);
    expect(preview.sample[0]).toEqual(['Rao; Jr.', '1,500']);
    expect(preview.delimiter).toBe(';');
  });

  it('imports it with a decimal comma, so 1,500 is one and a half', async () => {
    const records: Record<string, unknown>[] = [];
    const result = await runImport({
      stream: chunked(SEMICOLON, 1),
      plan: PLAN_AMOUNTS,
      adapter: AMOUNTS,
      ctx: undefined,
      onBatch: batch => {
        records.push(...batch);
      },
    });
    expect(result.errors).toEqual([]);
    expect(records.map(({ name, amount }) => ({ name, amount }))).toEqual([
      { name: 'Rao; Jr.', amount: 1.5 },
      { name: 'Ada', amount: 1234.5 },
    ]);
  });

  it('reads a tab-separated upload by its tabs', async () => {
    const preview = await previewSheet({ stream: chunked('Name\tAmount\nAda\t2\n', 3), adapter: AMOUNTS });
    expect(preview.delimiter).toBe('\t');
    expect(preview.sample).toEqual([['Ada', '2']]);
  });

  it('refuses a header line longer than any row may be, rather than buffering it', async () => {
    const endless = 'x'.repeat(200);
    await expect(
      previewSheet({
        stream: chunked(endless, 16),
        adapter: AMOUNTS,
        limits: { maxCellLength: 10, maxColumns: 5 },
      }),
    ).rejects.toMatchObject({ code: 'SHEET_TOO_LARGE' });
  });

  it('reads a comma file with a decimal comma when the caller says so, and a semicolon file with a point', async () => {
    const amounts = async (text: string, decimal: '.' | ',') => {
      const records: Record<string, unknown>[] = [];
      const result = await runImport({ stream: chunked(text), plan: PLAN_AMOUNTS, adapter: AMOUNTS, ctx: undefined, decimal, onBatch: batch => void records.push(...batch) });
      return { amounts: records.map(record => record['amount']), errors: result.errors.map(error => error.code) };
    };
    expect(await amounts('Name,Amount\r\nAda,"1,5"\r\n', ',')).toEqual({ amounts: [1.5], errors: [] });
    expect(await amounts('Name;Amount\r\nAda;1.5\r\n', '.')).toEqual({ amounts: [1.5], errors: [] });
    // Left to the delimiter, a point-decimal number in a semicolon file is refused, not guessed.
    expect((await runImport({ stream: chunked('Name;Amount\r\nAda;1.5\r\n'), plan: PLAN_AMOUNTS, adapter: AMOUNTS, ctx: undefined })).errors.map(e => e.code)).toEqual(['CELL_FORMAT']);
  });
});

/**
 * Grouping needs an open group carried across a batch boundary, which is Phase 3 (spec §5).
 * Until then a grouped plan is refused, never ignored: ignoring it would import one record
 * per row and report success.
 */
describe('a plan that groups rows', () => {
  const ORDERS = jsonSchemaAdapter({
    $id: 'order',
    type: 'object',
    properties: { orderId: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } } } } },
  });
  const grouped = {
    planVersion: 2,
    target: 'order',
    entries: [{ ref: 'orderId', column: 0 }, { ref: 'items.sku', column: 1 }],
    group: { key: [0], collect: ['items'] },
  };
  const SHEET = 'orderId,sku\r\nA,S1\r\nA,S2\r\n';

  it('is refused as INVALID_PLAN with a PLAN_GROUP problem that says where grouping does work', async () => {
    const failure = await runImport({ stream: chunked(SHEET), plan: grouped, adapter: ORDERS, ctx: undefined }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ImportError);
    expect(failure).toMatchObject({ code: 'INVALID_PLAN', status: 400 });
    expect((failure as ImportError).message).toBe(GROUPING_NOT_STREAMED);
    expect((failure as ImportError).details).toEqual([{ level: 'error', code: 'PLAN_GROUP', path: 'group', message: GROUPING_NOT_STREAMED }]);
    expect(GROUPING_NOT_STREAMED).toContain('does not group rows into records yet');
    expect(GROUPING_NOT_STREAMED).toContain('browser import does');
  });

  it('is refused before a row is read, and the request body is closed', async () => {
    let pulled = false;
    async function* watched(): AsyncGenerator<Uint8Array> {
      pulled = true;
      yield Buffer.from(SHEET);
    }
    await expect(runImport({ stream: watched(), plan: grouped, adapter: ORDERS, ctx: undefined })).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    expect(pulled).toBe(false);

    const { stream, destroyed } = trackedStream(SHEET);
    const written: unknown[] = [];
    await expect(runImport({ stream, plan: grouped, adapter: ORDERS, ctx: undefined, onBatch: batch => void written.push(...batch) })).rejects.toThrow();
    expect(destroyed()).toBe(true);
    expect(written).toEqual([]);
  });

  it('carries the plan\'s own warnings with the refusal', async () => {
    const failure = await runImport({ stream: chunked(SHEET), plan: { ...grouped, target: 'orders' }, adapter: ORDERS, ctx: undefined }).catch((error: unknown) => error);
    expect(((failure as ImportError).details as { code: string }[]).map(problem => problem.code)).toEqual(['PLAN_TARGET_MISMATCH', 'PLAN_GROUP']);
  });

  it('is what the in-memory engine does do, with the same plan', () => {
    const result = applyMapping(parseCsv(SHEET).rows, grouped, ORDERS, undefined);
    expect(result.records).toEqual([{ orderId: 'A', items: [{ sku: 'S1' }, { sku: 'S2' }] }]);
  });

  it('still reads a v2 plan that does not group: split lists and the rest work', async () => {
    const tagged = jsonSchemaAdapter({ $id: 'order', type: 'object', properties: { orderId: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } });
    const records: Record<string, unknown>[] = [];
    const plan = { planVersion: 2, target: 'order', entries: [{ ref: 'orderId', column: 0 }, { ref: 'tags', column: 1, split: '|' }] };
    const result = await runImport({ stream: chunked('orderId,tags\r\nA,x|y\r\n'), plan, adapter: tagged, ctx: undefined, onBatch: batch => void records.push(...batch) });
    expect(result.planProblems).toEqual([]);
    expect(records).toEqual([{ orderId: 'A', tags: ['x', 'y'] }]);
  });
});

describe('what the run reports', () => {
  it('counts the rows its records came from, and reconciles every row read', async () => {
    const result = await runImport({ stream: chunked(CSV_TEXT), plan: PLAN, adapter: EMPLOYEES, ctx: undefined, limits: { batchSize: 2 } });
    expect(result).toMatchObject({ imported: 3, rowsInImported: 3, skipped: 1, failed: 0, rowsRead: 4, warnings: [], warningCount: 0 });
    expect(result.rowsInImported + result.skipped + result.failed).toBe(result.rowsRead);
  });

  it('sizes the slots of a numbered array from the headers, and reports them', async () => {
    const people = jsonSchemaAdapter({
      $id: 'people',
      type: 'object',
      properties: { name: { type: 'string' }, phones: { type: 'array', title: 'Phone', items: { type: 'object', properties: { number: { type: 'string', title: 'Number' } } } } },
    });
    const headers = ['name', ...[1, 2, 3, 4, 5].map(n => `Phone ${n} Number`)];
    const preview = await previewSheet({ stream: chunked(`${headers.join(',')}\r\nAda,1,2,3,4,5\r\n`), adapter: people });
    expect(preview.slots).toEqual(slotsFor(headers, people));
    expect(preview.slots).toEqual({ phones: 5 });
    expect(preview.suggestion.entries.map(entry => entry.ref)).toEqual(['name', ...[0, 1, 2, 3, 4].map(n => `phones.${n}.number`)]);
  });

  it('suggests from the headers alone, so it never proposes a group this runner would refuse', async () => {
    const orders = jsonSchemaAdapter({
      $id: 'order',
      type: 'object',
      properties: { orderId: { type: 'string', title: 'Order ID' }, items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string', title: 'SKU' } } } } },
    });
    const preview = await previewSheet({ stream: chunked('Order ID,SKU\r\nA,S1\r\nA,S2\r\n'), adapter: orders });
    expect(preview.suggestion).not.toHaveProperty('group');
    // And the suggestion it does make is one this runner imports.
    const result = await runImport({ stream: chunked('Order ID,SKU\r\nA,S1\r\nA,S2\r\n'), plan: preview.suggestion, adapter: orders, ctx: undefined });
    expect(result.planProblems.filter(problem => problem.level === 'error')).toEqual([]);
    expect(result.imported).toBe(2);
  });
});

describe('the run\'s date order', () => {
  const EVENTS = jsonSchemaAdapter({ $id: 'events', type: 'object', properties: { name: { type: 'string' }, starts: { type: 'string', format: 'date' }, ends: { type: 'string', format: 'date' } } });
  const SHEET = 'name,starts,ends\r\nLaunch,05/09/2026,06/09/2026\r\n';
  const dates = async (plan: unknown, dateOrder?: 'DMY' | 'MDY' | 'YMD') => {
    const records: Record<string, unknown>[] = [];
    const result = await runImport({ stream: chunked(SHEET), plan, adapter: EVENTS, ctx: undefined, ...(dateOrder ? { dateOrder } : {}), onBatch: batch => void records.push(...batch) });
    return { records: records.map(({ starts, ends }) => [starts, ends]), errors: result.errors.map(error => [error.ref, error.code]) };
  };
  const plan = (startsOrder?: string) => ({
    planVersion: 2,
    target: 'events',
    entries: [{ ref: 'name', column: 0 }, { ref: 'starts', column: 1, ...(startsOrder ? { dateOrder: startsOrder } : {}) }, { ref: 'ends', column: 2 }],
  });

  it('is the default for every entry that states none', async () => {
    expect(await dates(plan(), 'DMY')).toEqual({ records: [['2026-09-05', '2026-09-06']], errors: [] });
    expect(await dates(plan(), 'MDY')).toEqual({ records: [['2026-05-09', '2026-06-09']], errors: [] });
  });

  it('gives way to an entry that states its own', async () => {
    expect(await dates(plan('DMY'), 'MDY')).toEqual({ records: [['2026-09-05', '2026-06-09']], errors: [] });
  });

  it('is not assumed: with none anywhere, a date that reads two ways is refused', async () => {
    expect(await dates(plan())).toEqual({ records: [], errors: [['starts', 'CELL_FORMAT'], ['ends', 'CELL_FORMAT']] });
    expect(await dates(plan('DMY'))).toEqual({ records: [], errors: [['ends', 'CELL_FORMAT']] });
  });
});
