/**
 * The browser `.xlsx` parser EXTENDING.md documents, held to the server path, file by file.
 *
 * The parser is not copied here: it is read out of EXTENDING.md, transpiled and run, so the
 * example a consumer copies is the code this test runs. From 3.1 it is `sheetFileParser`, the
 * parser `provideSheetFileParser()` from `ngx-dynamic-entity/xlsx` registers, over
 * sheet-to-schema/browser's `readSheetFile` (the entry's own spec holds the two to the same
 * grids). Each workbook is then imported twice with the same config and plan: through the
 * documented parser and `applyMapping` (what `LocalImportTransport` does with a `sheetParser`),
 * and through the server's `runImport`. The records must be the same.
 *
 * `case5_non_latin.xlsx` is the one that matters most. It was written by openpyxl, which stores
 * text as numeric character references, and SheetJS 0.20.3, a parser this document once
 * showed, decodes a reference above U+FFFF to its low 16 bits: 📦 and 🎉 vanished in the browser
 * while the server read them correctly (docs/rc-feedback.md, R3-1).
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import JSZip from 'jszip';
import * as browser from 'sheet-to-schema/browser';
import * as core from '@dynamic-entity/core';
import { applyMapping, type EntityFormConfig, type MappingPlan, type SheetGrid } from '@dynamic-entity/core';
import { runImport } from './run-import';
import { readSheet } from './read-sheet';
import { chunked } from './sheet.fixtures';

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURES = path.join(ROOT, 'packages/core/test-fixtures');

/** The fenced block in EXTENDING.md that defines `sheetFileParser`, run as CommonJS. */
function documentedParser(): (file: File) => Promise<SheetGrid> {
  const markdown = fs.readFileSync(path.join(ROOT, 'EXTENDING.md'), 'utf8');
  const blocks = [...markdown.matchAll(/```typescript\r?\n([\s\S]*?)```/g)].map(m => m[1]);
  const source = blocks.find(block => block.includes('export async function sheetFileParser'));
  if (!source) throw new Error('EXTENDING.md no longer documents sheetFileParser');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const modules: Record<string, unknown> = {
    'sheet-to-schema/browser': browser,
    '@dynamic-entity/core': core,
  };
  const exports: Record<string, unknown> = {};
  const load = (id: string): unknown => {
    if (!(id in modules)) throw new Error(`the documented parser imports "${id}", which this test does not provide`);
    return modules[id];
  };
  new Function('require', 'exports', js)(load, exports);
  return exports['sheetFileParser'] as (file: File) => Promise<SheetGrid>;
}

const flat = (entity: string, fields: [string, string][]): EntityFormConfig => ({
  entity,
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: fields.map(([id, type]) => ({ id, type, label: { en: id } })) as EntityFormConfig['tabs'][number]['fields'] }],
});
const planOf = (target: string, refs: string[]): MappingPlan =>
  ({ planVersion: 2, target, entries: refs.map((ref, column) => ({ ref, column })).filter(entry => entry.ref) }) as MappingPlan;

const CASES: { file: string; config: EntityFormConfig; plan: MappingPlan }[] = [
  {
    file: 'case5_non_latin.xlsx',
    config: flat('unicodedata', [['name', 'text'], ['email', 'text'], ['orderId', 'text'], ['amount', 'number'], ['status', 'text']]),
    plan: planOf('unicodedata', ['name', 'email', 'orderId', 'amount', 'status']),
  },
  {
    file: 'case1_1904_dates.xlsx',
    config: flat('people', [['name', 'text'], ['birthDate', 'date'], ['joinDate', 'date']]),
    plan: planOf('people', ['name', 'birthDate', 'joinDate']),
  },
  {
    file: 'case2_numeric_identifiers.xlsx',
    config: flat('records', [['name', 'text'], ['phone', 'text'], ['nationalId', 'text'], ['postalCode', 'text'], ['itemCount', 'number']]),
    plan: planOf('records', ['name', 'phone', 'nationalId', 'postalCode', 'itemCount']),
  },
  {
    file: 'case4_complex_sheet.xlsx',
    config: flat('sales', [['customer', 'text'], ['region', 'text'], ['qty', 'integer'], ['price', 'number'], ['total', 'number'], ['secret', 'text'], ['status', 'text']]),
    plan: planOf('sales', ['customer', 'region', 'qty', 'price', 'total', 'secret', 'status']),
  },
];

const strip = (records: Record<string, unknown>[]) =>
  records.map(record => Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_'))));
const errorKeys = (errors: { row: number; ref?: string; code?: string }[]) => errors.map(e => `${e.row}:${e.ref}:${e.code}`).sort();

describe('the browser .xlsx parser EXTENDING.md documents', () => {
  const parse = documentedParser();

  it.each(CASES)('$file: imports the same records in the browser as on the server', async ({ file, config, plan }) => {
    const bytes = fs.readFileSync(path.join(FIXTURES, file));

    const grid = await parse(new File([bytes], file));
    const browser = applyMapping(grid.rows, plan, config, { lang: 'en' });

    const server = await readSheet({ stream: chunked(bytes, 1024), filename: file });
    const serverRecords: Record<string, unknown>[] = [];
    const result = await runImport({
      stream: chunked(bytes, 1024),
      filename: file,
      plan,
      config,
      lang: 'en',
      onBatch: batch => {
        serverRecords.push(...batch);
      },
    });

    expect(grid.headers).toEqual(server.headers);
    expect(strip(browser.records)).toEqual(strip(serverRecords));
    expect(errorKeys(browser.errors)).toEqual(errorKeys(result.errors));
    expect(browser.records.length).toBeGreaterThan(0);
  });

  it('keeps characters above U+FFFF that a workbook stores as character references', async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES, 'case5_non_latin.xlsx'));
    // The fixture really is stored that way; without it this test would prove nothing.
    const sheetXml = await (await JSZip.loadAsync(bytes)).file('xl/worksheets/sheet1.xml')?.async('string');
    expect(sheetXml).toContain('&#128230;');
    const { headers, rows } = await parse(new File([bytes], 'case5_non_latin.xlsx'));
    expect(headers).toEqual(['பெயர்', 'மின்னஞ்சல்', '📦 ஆர்டர் எண்', '💰 தொகை', '🚀 நிலை']);
    expect(rows[2][0]).toBe('Rajesh Kumar 🎉');
  });
});
