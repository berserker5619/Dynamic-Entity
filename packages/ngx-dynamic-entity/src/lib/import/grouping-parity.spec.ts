/**
 * @jest-environment node
 */
/**
 * Feature B's adapter cases (docs/3.1-spec.md, B1): a grouped plan over a Dynamic Entity config,
 * imported in the browser and on a server, must give the same records, errors, warnings and
 * counts.
 *
 * - The browser path is `LocalImportTransport` itself, reading a CSV with the default parser and
 *   a workbook with `sheet-to-schema/browser`'s `readSheetFile` registered as `SHEET_PARSER`.
 * - The server path is sheet-to-schema's router with `grouping: true`, called directly with the
 *   binding Dynamic Entity's router builds (`viaImporterRouter`). DE's own router runs the
 *   same cases against it in the server's `grouping.spec.ts` (B2).
 *
 * The cases are `core/test-fixtures/grouping-cases.ts`, which every path shares.
 * Each case runs as CSV and as `.xlsx`. Node, not jsdom: the router, `readSheetFile` and the
 * workbook need Node's streams and `DecompressionStream`, and the transport needs only DI.
 */
import { Injector } from '@angular/core';
import type { ImportResult } from '@dynamic-entity/core';
import { readSheetFile } from 'sheet-to-schema/browser';
import { CASES, plain, sheetFile, viaImporterRouter, type Case, type Imported, type SheetBytes } from '../../../../core/test-fixtures/grouping-cases';
import { SHEET_PARSER } from '../tokens/injection-tokens';
import type { ImportContext } from './import-contracts';
import { LocalImportTransport } from './local-import-transport';

/** `LocalImportTransport` itself, with `readSheetFile` registered for a workbook. */
async function browserPath(c: Case, file: SheetBytes): Promise<Imported> {
  const providers = file.name.endsWith('.xlsx')
    ? [{ provide: SHEET_PARSER, useValue: (f: File) => readSheetFile(f, { filename: f.name }) }]
    : [];
  const transport = Injector.create({ providers: [...providers, { provide: LocalImportTransport }] }).get(LocalImportTransport);
  const context: ImportContext = { config: c.config, lang: 'en', rules: c.rules, lookups: c.lookups };
  const result: ImportResult = await transport.commit(new File([file.bytes], file.name), c.plan as never, context);
  return plain({
    records: result.records,
    errors: result.errors,
    warnings: result.warnings ?? [],
    planProblems: result.planProblems,
    imported: result.records.length,
    skipped: result.skipped,
  });
}

describe.each(['csv', 'xlsx'] as const)('a grouped plan over a Dynamic Entity config, as %s', format => {
  const run = async (c: Case) => {
    const file = await sheetFile(format, c.headers, c.rows);
    const browser = await browserPath(c, file);
    const server = await viaImporterRouter(c, file);
    expect(server).toEqual(browser);
    c.check(browser);
  };
  it.each(CASES.map(c => [c.name, c] as const))('%s: the same through LocalImportTransport and the router', (_, c) => run(c));
});
