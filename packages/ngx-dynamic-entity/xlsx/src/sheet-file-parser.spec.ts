/**
 * @jest-environment node
 */
/**
 * ngx-dynamic-entity/xlsx (docs/3.1-spec.md, A1): `sheetFileParser` reads what the server reads,
 * and `provideSheetFileParser()` puts it, and `.xlsx`, in the wizard. Node, not jsdom: a workbook
 * needs `DecompressionStream`, which jsdom lacks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injector } from '@angular/core';
import JSZip from 'jszip';
import * as browser from 'sheet-to-schema/browser';
import { readSheet } from 'sheet-to-schema/node';
import ts from 'typescript';
import { DEFAULT_SHEET_ACCEPT, LocalImportTransport, SHEET_ACCEPT, SHEET_PARSER } from 'ngx-dynamic-entity';
import { provideSheetFileParser, SHEET_FILE_ACCEPT, sheetFileParser } from './public-api';

const FIXTURES = join(__dirname, '../../../core/test-fixtures');
const WORKBOOKS = ['case1_1904_dates.xlsx', 'case2_numeric_identifiers.xlsx', 'case4_complex_sheet.xlsx', 'case5_non_latin.xlsx'];

const fileOf = (bytes: Uint8Array, name: string): File => new File([bytes as Uint8Array<ArrayBuffer>], name);

/** What the server's reader makes of the same bytes. It streams, so its rows are collected. */
async function serverGrid(bytes: Uint8Array, filename: string) {
  const sheet = await readSheet({ stream: Buffer.from(bytes), filename });
  const rows: unknown[][] = [];
  for await (const row of sheet.rows) rows.push(row);
  return { headers: sheet.headers, rows, ...(sheet.delimiter ? { delimiter: sheet.delimiter } : {}) };
}

describe('sheetFileParser', () => {
  it.each(WORKBOOKS)('reads %s to the grid the server reads', async name => {
    const bytes = readFileSync(join(FIXTURES, name));
    expect(await sheetFileParser(fileOf(bytes, name))).toEqual(await serverGrid(bytes, name));
  });

  it('reads a CSV and a TSV with their separators, as the server does', async () => {
    for (const [name, text, delimiter] of [['a.csv', 'Name;Price\nPen;1,5\n', ';'], ['a.tsv', 'Name\tPrice\nPen\t2\n', '\t']] as const) {
      const bytes = new TextEncoder().encode(text);
      const grid = await sheetFileParser(fileOf(bytes, name));
      expect(grid).toEqual(await serverGrid(bytes, name));
      expect(grid.delimiter).toBe(delimiter);
    }
  });

  it('reads a workbook by its bytes whatever it is called, and has no delimiter for one', async () => {
    const bytes = readFileSync(join(FIXTURES, WORKBOOKS[0]));
    const grid = await sheetFileParser(fileOf(bytes, 'export.csv'));
    expect(grid).toEqual(await serverGrid(bytes, 'export.csv'));
    expect(grid).not.toHaveProperty('delimiter');
  });

  it('refuses a .xls, a UTF-16 file and a .docx with sheet-to-schema codes', async () => {
    const docx = await new JSZip().file('word/document.xml', '<w/>').generateAsync({ type: 'uint8array' });
    const cases: [Uint8Array, string][] = [
      [Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'legacy.xls'],
      [Uint8Array.from([0xff, 0xfe, 0x61, 0x00]), 'utf16.csv'],
      [docx, 'letter.docx'],
    ];
    for (const [bytes, name] of cases) {
      await expect(sheetFileParser(fileOf(bytes, name))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    }
  });
});

describe('the parser EXTENDING.md documents', () => {
  /** The fenced block that defines `sheetFileParser`, run as CommonJS, as the server's documented-parser test runs it. */
  const documented = (): ((file: File) => Promise<unknown>) => {
    const markdown = readFileSync(join(__dirname, '../../../../EXTENDING.md'), 'utf8');
    const source = [...markdown.matchAll(/```typescript\r?\n([\s\S]*?)```/g)].map(m => m[1]).find(block => block.includes('export async function sheetFileParser'));
    if (!source) throw new Error('EXTENDING.md no longer documents sheetFileParser');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, unknown> = {};
    new Function('require', 'exports', js)((id: string) => ({ 'sheet-to-schema/browser': browser })[id], exports);
    return exports['sheetFileParser'] as (file: File) => Promise<unknown>;
  };

  it('is the parser this entry registers: the same grid for every fixture', async () => {
    const parse = documented();
    for (const name of [...WORKBOOKS, 'semicolon.csv']) {
      const bytes = name.endsWith('.csv') ? new TextEncoder().encode('Name;Price\nPen;1,5\n') : readFileSync(join(FIXTURES, name));
      expect(await parse(fileOf(bytes, name))).toEqual(await sheetFileParser(fileOf(bytes, name)));
    }
  });
});

describe('provideSheetFileParser', () => {
  const transportWith = (providers: unknown[]) =>
    Injector.create({ providers: [...(providers as never[]), { provide: LocalImportTransport }] }).get(LocalImportTransport);

  it('registers the parser, and the picker offers .xlsx with it', async () => {
    const transport = transportWith(provideSheetFileParser());
    expect(transport.accept).toBe(SHEET_FILE_ACCEPT);
    expect(SHEET_FILE_ACCEPT.split(',')).toEqual(['.csv', '.tsv', '.txt', '.xlsx']);
    const bytes = readFileSync(join(FIXTURES, 'case5_non_latin.xlsx'));
    const preview = await transport.preview(fileOf(bytes, 'people.xlsx'), { config: { entity: 'people', tabs: [] } });
    expect(preview.headers).toEqual((await serverGrid(bytes, 'people.xlsx')).headers);
  });

  it('wins over the SHEET_PARSER provideNgxDynamicEntity provides, when listed after it', () => {
    const injector = Injector.create({ providers: [{ provide: SHEET_PARSER, useValue: null }, ...provideSheetFileParser()] });
    expect(injector.get(SHEET_PARSER)).toBe(sheetFileParser);
  });

  it('leaves the built-in parser offering CSV only, and a parser of your own unrestricted', () => {
    expect(transportWith([]).accept).toBe(DEFAULT_SHEET_ACCEPT);
    expect(DEFAULT_SHEET_ACCEPT).not.toContain('.xlsx');
    expect(transportWith([{ provide: SHEET_PARSER, useValue: () => ({ headers: [], rows: [] }) }]).accept).toBeUndefined();
    expect(transportWith([{ provide: SHEET_PARSER, useValue: () => ({ headers: [], rows: [] }) }, { provide: SHEET_ACCEPT, useValue: '.ods' }]).accept).toBe('.ods');
  });
});
