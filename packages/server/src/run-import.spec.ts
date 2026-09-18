import {
  applyMapping,
  coerceCell,
  deriveImportColumns,
  parseCsv,
  suggestMapping,
  type NestedFieldConfig,
} from '@dynamic-entity/core';
import { sampleText } from './cell-text';
import { previewSheet, runImport, type OnBatch } from './run-import';
import {
  chunked,
  collectedHeap,
  CONFIG,
  CSV_TEXT,
  generatedCsv,
  HEADERS,
  LOOKUPS,
  PLAN,
  trackedStream,
} from './sheet.fixtures';

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
   * The most important test here, and the reason the engine is in core.
   *
   * The browser path is `parseCsv` then `applyMapping` — which is all `LocalImportTransport`
   * is, three lines of arrangement over the same two functions. The server path streams the
   * same bytes through `readSheet` and hands batches to the same `applyMapping`. The two must
   * produce deep-equal records, or "one engine, both sides" is a claim rather than a fact.
   */
  it('produces the same records as the in-browser path, for the same file and plan', async () => {
    const browser = applyMapping(parseCsv(CSV_TEXT).rows, PLAN, CONFIG, { lookups: LOOKUPS });

    const { onBatch, records } = collector();
    const server = await runImport({
      stream: chunked(CSV_TEXT, 5),
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
      onBatch,
    });

    expect(records).toEqual(browser.records);
    expect(server.imported).toBe(browser.records.length);
    expect(server.skipped).toBe(browser.skipped);
    expect(server.errors).toEqual(browser.errors);
  });

  it('agrees whatever size the bytes arrive in', async () => {
    const browser = applyMapping(parseCsv(CSV_TEXT).rows, PLAN, CONFIG, { lookups: LOOKUPS });

    for (const size of [1, 3, 17, 4096]) {
      const { onBatch, records } = collector();
      await runImport({
        stream: chunked(CSV_TEXT, size),
        plan: PLAN,
        config: CONFIG,
        lookups: LOOKUPS,
        onBatch,
        limits: { batchSize: 2 },
      });
      expect({ size, records }).toEqual({ size, records: browser.records });
    }
  });

  it('agrees across a batch boundary, which is the seam the browser does not have', async () => {
    // Row numbers and blank-row skipping both have to survive being cut into batches. A
    // batchSize of 1 puts a boundary between every pair of rows, including the blank one.
    const browser = applyMapping(parseCsv(CSV_TEXT).rows, PLAN, CONFIG, { lookups: LOOKUPS });
    const { onBatch, records } = collector();
    const server = await runImport({
      stream: chunked(CSV_TEXT),
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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

    const result = await runImport({ stream: watched(), plan: broken, config: CONFIG });

    expect(result.planProblems.some(p => p.level === 'error')).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.rowsRead).toBe(0);
    expect(pulled).toBe(false);
    // And it does not report a format it never looked at. A guessed field is worse than a
    // missing one: it is indistinguishable from a measured one.
    expect(result.format).toBeUndefined();
  });

  it('closes the request body it decided not to read', async () => {
    const { stream, destroyed } = trackedStream(CSV_TEXT);
    await runImport({ stream, plan: broken, config: CONFIG });
    expect(destroyed()).toBe(true);
  });

  it('never calls onBatch for a plan it refused', async () => {
    const { onBatch, records } = collector();
    await runImport({ stream: chunked(CSV_TEXT), plan: broken, config: CONFIG, onBatch });
    expect(records).toEqual([]);
  });

  it('lets a warning through — an older config version is not a reason to import nothing', async () => {
    const stale = { ...PLAN, configVersion: 1 };
    const result = await runImport({
      stream: chunked(CSV_TEXT),
      plan: stale,
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
    });

    expect(result.errorCount).toBeGreaterThan(1);
    expect(result.failed).toBe(1);
  });

  it('keeps the first errors, which are the ones a user can act on', async () => {
    const result = await runImport({
      stream: allBad(10),
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
        config: CONFIG,
        lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
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
      config: CONFIG,
      lookups: LOOKUPS,
      onBatch: () => undefined,
    });
    const withoutWrite = await runImport({
      stream: chunked(CSV_TEXT),
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
    });

    expect(withoutWrite).toEqual(withWrite);
  });
});

describe('sampleText', () => {
  const field = (type: string): NestedFieldConfig =>
    ({ id: 'f', type, label: { en: 'F' } }) as NestedFieldConfig;

  /**
   * The parity the preview rests on: what the sample shows is what the import will store.
   *
   * A preview sample crosses the wire as text and the browser coerces that text. If the two
   * disagreed, the preview would be wrong about the one thing it exists to show.
   *
   * **Table-driven over every type `coerceTypedCell` special-cases, on purpose.** The first
   * version of this test hand-picked four of them, and the one it skipped — `time` — was the
   * one that diverged: the review screen showed `1899-12-30T09:05:00.000Z` and "is not a time",
   * for a cell the import stored as `09:05`. A parity claim checked against a selection is a
   * claim about the selection.
   */
  const CASES: { type: string; raw: unknown; expected: unknown }[] = [
    { type: 'date', raw: new Date('2024-03-07T00:00:00.000Z'), expected: '2024-03-07' },
    { type: 'date', raw: new Date('2024-01-01T00:00:00.000Z'), expected: '2024-01-01' },
    { type: 'datetime', raw: new Date('2024-03-07T09:30:00.000Z'), expected: '2024-03-07T09:30:00.000Z' },
    { type: 'monthYear', raw: new Date('2024-03-01T00:00:00.000Z'), expected: '2024-03' },
    // What a spreadsheet hands back for a time-only cell: a clock reading on an epoch date.
    { type: 'time', raw: new Date('1899-12-30T09:05:00.000Z'), expected: '09:05' },
    { type: 'time', raw: new Date('1899-12-30T23:59:00.000Z'), expected: '23:59' },
    { type: 'number', raw: 42, expected: 42 },
    { type: 'number', raw: -1.5, expected: -1.5 },
    { type: 'currency', raw: 1234.56, expected: 1234.56 },
    { type: 'checkbox', raw: true, expected: true },
    { type: 'checkbox', raw: false, expected: false },
    { type: 'boolean', raw: true, expected: true },
    { type: 'text', raw: new Date('2024-03-07T00:00:00.000Z'), expected: '2024-03-07' },
    { type: 'text', raw: 'plain', expected: 'plain' },
  ];

  it.each(CASES)('agrees typed and as text for a $type cell', ({ type, raw, expected }) => {
    const typed = coerceCell(field(type), raw);
    const asText = coerceCell(field(type), sampleText(raw));

    expect(typed).toEqual({ value: expected });
    expect(asText).toEqual(typed);
  });

  it('covers every type the typed-cell path special-cases', () => {
    // The guard on the guard. A type added to `coerceTypedCell` without a row above would
    // otherwise be exactly as unchecked as `time` was.
    const covered = new Set(CASES.map(entry => entry.type));
    for (const type of ['date', 'datetime', 'monthYear', 'time', 'number', 'currency', 'boolean', 'checkbox']) {
      expect({ type, covered: covered.has(type) }).toEqual({ type, covered: true });
    }
  });

  it('shows a date cell as the calendar date it is', () => {
    expect(sampleText(new Date('2024-03-07T00:00:00.000Z'))).toBe('2024-03-07');
  });

  it('keeps the time on a cell that has one', () => {
    expect(sampleText(new Date('2024-03-07T09:30:00.000Z'))).toBe('2024-03-07T09:30:00.000Z');
  });

  it('shows an empty cell as empty rather than as "null"', () => {
    expect(sampleText(null)).toBe('');
    expect(sampleText(undefined)).toBe('');
    expect(sampleText(new Date('nonsense'))).toBe('');
  });

  it('passes text through untouched', () => {
    expect(sampleText('  spaced  ')).toBe('  spaced  ');
  });
});

describe('previewSheet', () => {
  it('returns headers, a sample and a suggestion', async () => {
    const preview = await previewSheet({ stream: chunked(CSV_TEXT), config: CONFIG });

    expect(preview.headers).toEqual(HEADERS);
    expect(preview.rowCount).toBe(4);
    expect(preview.sample[0]).toEqual(['Alice', '34', '2024-03-07', 'true', 'Active']);
    expect(preview.suggestion.entity).toBe('employee');
    expect(preview.suggestion.entries.map(e => e.ref)).toEqual(
      PLAN.entries.map(e => e.ref),
    );
  });

  it('suggests exactly what the browser transport suggests for the same headers', async () => {
    // Both derive columns the same way and suggest from the same headers. Asserted rather
    // than assumed: a suggestion that differed by side would put the same column into a
    // different field depending on where the file was uploaded.
    const browser = suggestMapping(
      parseCsv(CSV_TEXT).headers,
      deriveImportColumns(CONFIG).columns,
      CONFIG.entity,
    );
    const preview = await previewSheet({ stream: chunked(CSV_TEXT), config: CONFIG });
    expect(preview.suggestion).toEqual(browser);
  });

  it('caps the sample without capping the count', async () => {
    const preview = await previewSheet({
      stream: generatedCsv(1000),
      config: CONFIG,
      limits: { sampleRows: 2 },
    });
    expect(preview.sample).toHaveLength(2);
    expect(preview.rowCount).toBe(1000);
  });

  it('applies the same limits an import applies', async () => {
    // A preview endpoint that skipped the limits would be the cheapest way in.
    await expect(
      previewSheet({ stream: generatedCsv(100), config: CONFIG, limits: { maxRows: 10 } }),
    ).rejects.toMatchObject({ code: 'SHEET_TOO_LARGE' });
  });

  it('closes the request body when a limit refuses the file', async () => {
    const { stream, destroyed } = trackedStream(CSV_TEXT);
    await expect(
      previewSheet({ stream, config: CONFIG, limits: { maxRows: 1 } }),
    ).rejects.toThrow();
    expect(destroyed()).toBe(true);
  });
});
