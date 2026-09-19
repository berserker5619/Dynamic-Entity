/**
 * stress.spec.ts — the size and the shape the package was actually built for.
 *
 * The motivating case was a fifty-thousand-row *workbook*, and the largest automated import
 * until now was fifty thousand rows of a five-column config — a file whose rows are five cells
 * wide, all text, and whose records are flat. `insuranceClaims` is thirty-five columns across
 * four nesting levels with a repeating `lineItems` array, dates, times, currency bounds and a
 * `listName` dropdown. Width is where a per-row cost turns into a per-cell one, and nothing
 * measured it.
 *
 * These run on every `npm test`. A stress test behind a flag is a stress test that runs on
 * somebody's laptop once and never in CI, and the point of measuring the heap is to find out
 * on the day a change starts holding the file — not the next time someone remembers to ask.
 *
 * ~30-60s all told, which is the price of the claim the package exists to make.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTemplateSpec,
  deriveImportColumns,
  lookupValuesToOptions,
  normalizeLookupValues,
  suggestMapping,
  type EntityFormConfig,
  type ImportColumn,
  type ImportLookups,
} from '@dynamic-entity/core';
import { csvChunks, synthesiseTypedRow } from './config-rows.fixtures';
import { runImport } from './run-import';
import { chunked, collectedHeap } from './sheet.fixtures';
import { streamedWorkbookOf } from './workbook.fixtures';

const ROOT = join(__dirname, '..', '..', '..');
const ROWS = 50_000;

/**
 * Raised deliberately, and only here.
 *
 * `DEFAULT_LIMITS.maxBytes` is 10 MB — sized for "a large legitimate export", and the guard a
 * real deployment wants. This file is about what the *reader* holds at width, so the byte
 * limit is lifted out of the way rather than being the thing under test. `limits.spec.ts` is
 * where the default is the subject.
 */
const HEADROOM = { maxBytes: 96 * 1024 * 1024, maxUncompressedBytes: 512 * 1024 * 1024 };

const CONFIG: EntityFormConfig = (
  JSON.parse(readFileSync(join(ROOT, 'test_data.json'), 'utf8')) as EntityFormConfig[]
).find(config => config.entity === 'insuranceClaims')!;

const LOOKUPS: ImportLookups = {
  clientTier: lookupValuesToOptions(
    normalizeLookupValues(
      JSON.parse(
        readFileSync(
          join(ROOT, 'packages', 'demo-angular', 'src', 'app', 'mock', 'client-tier-list.json'),
          'utf8',
        ),
      ),
    ),
  ),
};

const SPEC = buildTemplateSpec(CONFIG, { lang: 'en' });
const COLUMNS: ImportColumn[] = SPEC.columns;
const HEADERS = COLUMNS.map(column => column.header);
const PLAN = suggestMapping(HEADERS, deriveImportColumns(CONFIG, { lang: 'en' }).columns, CONFIG.entity);
const SYNTH = { lang: 'en', lookups: LOOKUPS, entity: CONFIG.entity };

/** The typed row a workbook carries, generated once and yielded `count` times. */
function* typedRows(count: number): Generator<readonly unknown[]> {
  const row = synthesiseTypedRow(COLUMNS, SYNTH);
  for (let i = 0; i < count; i++) yield row;
}

describe('fifty thousand rows of the widest config in the repository', () => {
  it('imports them all from a CSV without ever holding the file', async () => {
    const before = collectedHeap();
    let peak = 0;
    let batches = 0;

    const result = await runImport({
      stream: csvChunks(COLUMNS, ROWS, SYNTH),
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
      lang: 'en',
      limits: { ...HEADROOM, batchSize: 500 },
      onBatch: () => {
        // Every twentieth batch: collecting on all hundred of them measures the collector.
        if (batches++ % 20 === 0) peak = Math.max(peak, collectedHeap() - before);
      },
    });

    expect(result.imported).toBe(ROWS);
    expect(result.errorCount).toBe(0);
    expect(result.skipped).toBe(0);

    /**
     * The claim, at width.
     *
     * The file is ~19 MB of text and each row becomes a four-level record with a
     * three-element array in it. A run that buffered the file, or that accumulated records,
     * would retain tens of megabytes; a streaming one holds one batch. The bound is checked
     * against a collected heap because an uncollected one grows past this however the code is
     * written — a number that would pass whatever it was asserting.
     *
     * **The bound is set to discriminate, not to be comfortable.** Measured: 2.7 MB as
     * written, 163 MB with the per-batch flush removed. 16 MB is six times the former and a
     * tenth of the latter, so a regression that started holding the file fails here rather
     * than sliding under a generous ceiling.
     */
    expect(peak).toBeLessThan(16 * 1024 * 1024);
  });

  it('imports them all from a typed workbook', async () => {
    const book = await streamedWorkbookOf(HEADERS, typedRows(ROWS));

    let imported = 0;
    const result = await runImport({
      stream: chunked(book, 256 * 1024),
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
      lang: 'en',
      limits: { ...HEADROOM, batchSize: 500 },
      onBatch: records => {
        imported += records.length;
      },
    });

    expect(result.format).toBe('xlsx');
    expect(result.errorCount).toBe(0);
    expect(result.imported).toBe(ROWS);
    expect(imported).toBe(ROWS);
  });

  /**
   * Backpressure, asserted at width rather than at five columns.
   *
   * A consumer writing to a database is slower than a parser reading a file. If `onBatch` were
   * not awaited the parser would run ahead and the pending writes would queue — bounded memory
   * turned into an unbounded queue, the same failure from the other side. The directly
   * observable form: between handing a batch over and getting it back, the source is not
   * touched.
   */
  it('reads nothing at all while a slow consumer is still writing', async () => {
    const rows = 4000;
    let pulled = 0;
    const readAhead: number[] = [];

    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const chunk of csvChunks(COLUMNS, rows, SYNTH)) {
        pulled++;
        yield chunk;
      }
    }

    const result = await runImport({
      stream: counted(),
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
      lang: 'en',
      limits: { ...HEADROOM, batchSize: 200 },
      onBatch: async () => {
        const at = pulled;
        await new Promise(resolve => setTimeout(resolve, 2));
        readAhead.push(pulled - at);
      },
    });

    expect(result.imported).toBe(rows);
    expect(readAhead.filter(count => count !== 0)).toEqual([]);
  });

  /**
   * A file where every row fails, at the scale that makes retention the problem.
   *
   * Fifty thousand retained error objects is the same unbounded growth as holding the file,
   * reached from the other direction. The *counts* stay exact, because the number a user acts
   * on is "which rows do I fix" — losing reasons is acceptable, losing the tally is not.
   */
  it('counts every failure exactly while keeping only a sample of the reasons', async () => {
    // `claimRef` is required with `minLength: 4`, and `sumInsured` is a required currency.
    // A row of the word "no" in every cell fails both, and every date, time and number
    // besides — so the error count is a multiple of the row count, not equal to it.
    const bad = COLUMNS.map(() => 'no').join(',');

    async function* allBad(): AsyncGenerator<Uint8Array> {
      yield Buffer.from(`${HEADERS.join(',')}\r\n`, 'utf8');
      let buffer = '';
      for (let i = 0; i < ROWS; i++) {
        buffer += `${bad}\r\n`;
        if (buffer.length >= 64 * 1024) {
          yield Buffer.from(buffer, 'utf8');
          buffer = '';
        }
      }
      if (buffer) yield Buffer.from(buffer, 'utf8');
    }

    const result = await runImport({
      stream: allBad(),
      plan: PLAN,
      config: CONFIG,
      lookups: LOOKUPS,
      lang: 'en',
      limits: { ...HEADROOM, batchSize: 1000, maxReportedErrors: 200 },
    });

    expect(result.rowsRead).toBe(ROWS);
    expect(result.imported).toBe(0);
    // Exact, and not derived from the sample — which is the whole distinction.
    expect(result.failed).toBe(ROWS);
    expect(result.errorCount).toBeGreaterThan(ROWS);
    expect(result.errors).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });
});
