/**
 * sheet-to-schema-fixtures.ts — sheet-to-schema's own fixtures, as Dynamic Entity imports them
 * (docs/3.1-spec.md, A: "every sheet-to-schema 1.1 CSV and xlsx fixture").
 *
 * The files are in `sheet-to-schema/`, copied byte for byte from its v1.3.0 tag. For each, a flat
 * config is derived from what the server reads in it: a column is `date` where every value is a
 * `Date`, `number` where every value reads as one (a decimal comma counts, so a semicolon file
 * tests the decimal mark), and `text` otherwise. The plan maps column i to field i. Then the
 * browser and the server must agree on the grid and on the records, errors and warnings: in
 * ngx's `sheet-to-schema-fixtures.spec.ts` (LocalImportTransport, each parser) and the server's
 * (DE's router), each against sheet-to-schema's router over DE's binding (`viaImporterRouter`).
 *
 * Not under `src/`: neither published nor counted by coverage. Imported by relative path.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { readSheet } from 'sheet-to-schema/node';
import type { EntityFormConfig, MappingPlan, NestedFieldConfig } from '../src/index';
import type { Case, SheetBytes } from './grouping-cases';

const DIR = join(__dirname, 'sheet-to-schema');

/** Every fixture: its name as uploaded, its bytes, and whether it is a workbook. */
export const SHEET_TO_SCHEMA_FIXTURES = readdirSync(DIR)
  .filter(name => /\.(csv|tsv|xlsx)$/.test(name))
  .sort()
  .map(file => ({ file, name: file.split('__')[1], bytes: new Uint8Array(readFileSync(join(DIR, file))) as Uint8Array<ArrayBuffer>, workbook: file.endsWith('.xlsx') }));

/** What the server's reader makes of the bytes, its rows collected. */
export async function serverGrid(bytes: Uint8Array, filename: string) {
  const sheet = await readSheet({ stream: Readable.from([Buffer.from(bytes)]), filename });
  const rows: unknown[][] = [];
  for await (const row of sheet.rows) rows.push(row);
  return { headers: sheet.headers, rows, ...(sheet.delimiter ? { delimiter: sheet.delimiter } : {}) };
}

const NUMBER = /^-?\d+(?:[.,]\d+)?$/;
const kindOf = (values: unknown[]): NestedFieldConfig['type'] => {
  const present = values.filter(value => value !== '' && value !== null && value !== undefined);
  if (present.length && present.every(value => value instanceof Date)) return 'date';
  if (present.length && present.every(value => typeof value === 'number' || (typeof value === 'string' && NUMBER.test(value.trim())))) return 'number';
  return 'text';
};

/** A fixture as a case `viaImporterRouter` and the browser paths take: a derived config and plan. */
export async function caseOf(fixture: (typeof SHEET_TO_SCHEMA_FIXTURES)[number]): Promise<{ case: Case; file: SheetBytes }> {
  const { headers, rows } = await serverGrid(fixture.bytes, fixture.name);
  const fields: NestedFieldConfig[] = headers.map((header, i) => ({ id: `c${i}`, type: kindOf(rows.map(row => row[i])), label: { en: header || `Column ${i + 1}` } }));
  const config: EntityFormConfig = { entity: 'fixture', version: 1, tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields }] };
  const plan: MappingPlan = { planVersion: 2, target: 'fixture', entries: fields.map((field, column) => ({ ref: field.id, column })) };
  return {
    case: { name: fixture.file, config, headers, rows: [], plan: plan as unknown as Record<string, unknown>, check: () => undefined },
    file: { name: fixture.name, bytes: fixture.bytes },
  };
}
