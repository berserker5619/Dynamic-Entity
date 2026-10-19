/**
 * @jest-environment node
 */
/**
 * Every sheet-to-schema fixture, read in the browser as the server reads it (docs/3.1-spec.md, A).
 *
 * - The built-in parser (`readCsvFile`) reads every CSV and TSV fixture to the server's grid, and
 *   `LocalImportTransport` imports the same records, errors and warnings as the router, the
 *   decimal mark following the delimiter.
 * - With `provideSheetFileParser()`, the same holds for every fixture, workbooks included.
 *
 * The files and the config derived from each are `core/test-fixtures/sheet-to-schema-fixtures.ts`;
 * the server side is sheet-to-schema's router over DE's binding, which the server's own spec holds
 * DE's router to. Node, not jsdom: a workbook needs `DecompressionStream`.
 */
import { Injector } from '@angular/core';
import { caseOf, serverGrid, SHEET_TO_SCHEMA_FIXTURES } from '../../../../core/test-fixtures/sheet-to-schema-fixtures';
import { plain, viaImporterRouter, type Case, type SheetBytes } from '../../../../core/test-fixtures/grouping-cases';
import { sheetFileParser } from '../../../xlsx/src/public-api';
import { SHEET_PARSER } from '../tokens/injection-tokens';
import { defaultSheetParser } from './sheet-parser';
import { LocalImportTransport } from './local-import-transport';

const DELIMITED = SHEET_TO_SCHEMA_FIXTURES.filter(fixture => !fixture.workbook);
const fileOf = (file: SheetBytes): File => new File([file.bytes], file.name);

/** `LocalImportTransport` with the parser given (none: the built-in one), committing the case. */
async function browser(c: Case, file: SheetBytes, parser?: typeof sheetFileParser) {
  const providers = parser ? [{ provide: SHEET_PARSER, useValue: parser }] : [];
  const transport = Injector.create({ providers: [...providers, { provide: LocalImportTransport }] }).get(LocalImportTransport);
  const result = await transport.commit(fileOf(file), c.plan as never, { config: c.config, lang: 'en' });
  return plain({ records: result.records, errors: result.errors, warnings: result.warnings ?? [], planProblems: result.planProblems, imported: result.records.length, skipped: result.skipped });
}

it('covers every CSV, TSV and .xlsx fixture sheet-to-schema 1.3.0 has', () => {
  expect(SHEET_TO_SCHEMA_FIXTURES).toHaveLength(18);
  expect(DELIMITED.length).toBe(9);
  // A semicolon file, so the decimal mark is tested, and a header row the parser must not split.
  expect(DELIMITED.map(fixture => fixture.name)).toEqual(expect.arrayContaining(['case3_excel_semicolon.csv', 'header_commas.tsv']));
});

describe.each(DELIMITED.map(fixture => [fixture.file, fixture] as const))('the built-in parser: %s', (_, fixture) => {
  it("reads the server's grid", async () => {
    const grid = await defaultSheetParser(new File([fixture.bytes], fixture.name));
    expect(grid).toEqual(await serverGrid(fixture.bytes, fixture.name));
  });

  it('imports through LocalImportTransport what the router imports', async () => {
    const { case: c, file } = await caseOf(fixture);
    const local = await browser(c, file);
    expect(local).toEqual(await viaImporterRouter(c, file));
    expect(local.imported + local.errors.length).toBeGreaterThan(0);
  });
});

describe.each(SHEET_TO_SCHEMA_FIXTURES.map(fixture => [fixture.file, fixture] as const))('provideSheetFileParser: %s', (_, fixture) => {
  it("reads the server's grid", async () => {
    expect(await sheetFileParser(new File([fixture.bytes], fixture.name))).toEqual(await serverGrid(fixture.bytes, fixture.name));
  });

  it('imports through LocalImportTransport what the router imports', async () => {
    const { case: c, file } = await caseOf(fixture);
    expect(await browser(c, file, sheetFileParser)).toEqual(await viaImporterRouter(c, file));
  });
});
