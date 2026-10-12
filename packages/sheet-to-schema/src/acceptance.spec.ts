/**
 * The Phase 1 acceptance test (docs/import-phase1-spec.md, "Acceptance criteria", "Adapters"):
 * the engine against the prototype's own run, on the prototype's own schema and sheet.
 *
 * The fixtures under `test/fixtures` are the prototype's inputs and what it built from them;
 * each folder's README says where every file came from. Three things are held:
 *
 * 1. `suggestMapping`, from the headers and the sheet's rows, reproduces the prototype's
 *    column bindings, its list modes and its group key.
 * 2. A record with no errors equals the prototype's record exactly.
 * 3. A record that fails is compared by its problems, not its output: the prototype keeps a
 *    failed record with the bad value left raw, and the engine does not return one. Each
 *    problem is compared by code, path and rows. The prototype has messages, not codes, so
 *    `CODE_OF` says which code each of its messages means.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SchemaAdapter } from './adapter.types';
import { applyMapping } from './apply-mapping';
import { exampleJsonAdapter } from './example-json-adapter';
import { jsonSchemaAdapter } from './json-schema-adapter';
import type { NormalizedPlan } from './plan.types';
import { slotOf } from './plan-slots';
import type { ImportRowError } from './result.types';
import { suggestMapping } from './suggest';

interface PrototypeIssue {
  path: string;
  msg: string;
  rows: number[];
  warn?: boolean;
}
interface PrototypeRun {
  groupBy: string;
  arrays: Record<string, { mode: 'indexed' | 'split' | 'rows'; slots: number; delim: string }>;
  bindings: Record<string, string>;
  records: { label: string; rows: number[]; issues: PrototypeIssue[] }[];
}

const FIXTURES = join(__dirname, '..', 'test', 'fixtures');

function load(name: string) {
  const file = (leaf: string): string => readFileSync(join(FIXTURES, name, leaf), 'utf8');
  const [headers, ...rows] = file('sample.csv').trim().split(/\r?\n/).map(line => line.split(','));
  return {
    file,
    headers,
    rows,
    expected: JSON.parse(file('expected-output.json')) as Record<string, unknown>[],
    run: JSON.parse(file('run.json')) as PrototypeRun,
  };
}

/** The prototype's `customer.phones[0].type` and `items[*].sku` as the engine's refs. */
const toRef = (path: string): string => path.replace(/\[\*?\]/g, '').replace(/\[(\d+)\]/g, '.$1');
/** A ref with its slot or item index taken out, which is how the prototype names a problem's path. */
const shape = (ref: string): string => ref.split('.').filter(segment => !/^\d+$/.test(segment)).join('.');

/** Which engine code each of the prototype's issue messages means. */
const CODE_OF: [RegExp, string][] = [
  [/^Not a valid email/, 'RECORD_FORMAT'],
  [/^Doesn't match/, 'RECORD_FORMAT'],
  [/^Not a whole number|^Not a number|^Not a real date|^Expected yes or no/, 'CELL_FORMAT'],
  [/isn't one of:/, 'CELL_UNKNOWN_OPTION'],
  [/^Missing required value/, 'RECORD_REQUIRED'],
  [/^Rows disagree|^Rows in this group disagree/, 'RECORD_GROUP_CONFLICT'],
];
function codeOf(issue: PrototypeIssue): string {
  const found = CODE_OF.find(([pattern]) => pattern.test(issue.msg));
  if (!found) throw new Error(`acceptance.spec: no code is mapped for the prototype's issue "${issue.msg}"`);
  return found[1];
}

const sorted = <T>(items: T[]): T[] => [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const problemOf = (problem: ImportRowError) => ({ code: problem.code, path: shape(problem.ref), rows: problem.rows });
const issueOf = (issue: PrototypeIssue) => ({ code: codeOf(issue), path: toRef(issue.path), rows: issue.rows });

/** The list modes a plan implies, in the prototype's terms. */
function modesOf(plan: NormalizedPlan, adapter: SchemaAdapter): Record<string, { mode: string; slots?: number }> {
  const modes: Record<string, { mode: string; slots?: number }> = {};
  for (const ref of plan.group?.collect ?? []) modes[ref] = { mode: 'rows' };
  for (const entry of plan.entries) {
    const at = slotOf(entry.ref);
    if (at) modes[at.arrayRef] = { mode: 'indexed', slots: Math.max(modes[at.arrayRef]?.slots ?? 0, at.slot + 1) };
  }
  for (const target of adapter.targets({ slots: {} }).targets) {
    if (target.value.kind === 'list' && plan.entries.some(entry => entry.ref === target.ref)) modes[target.ref] = { mode: 'split' };
  }
  return modes;
}

/**
 * `prepare` stands for what a person does in the mapper before importing. It is the identity
 * unless the sheet leaves something only they can say.
 */
function accept(name: string, makeAdapter: (file: (leaf: string) => string) => SchemaAdapter, prepare: (plan: NormalizedPlan) => NormalizedPlan = plan => plan) {
  const { file, headers, rows, expected, run } = load(name);
  const adapter = makeAdapter(file);
  const suggested = suggestMapping(headers, adapter, { sample: rows });
  const result = applyMapping(rows, prepare(suggested), adapter, undefined);
  const failed = run.records.filter(record => record.issues.some(issue => !issue.warn));
  const clean = run.records.filter(record => !failed.includes(record));

  describe('the suggestion, from the headers and the rows', () => {
    it("binds every column the prototype bound, to the same field", () => {
      const ours = Object.fromEntries(suggested.entries.map(entry => [entry.header, entry.ref]));
      const theirs = Object.fromEntries(Object.entries(run.bindings).map(([path, header]) => [header, toRef(path)]));
      expect(ours).toEqual(theirs);
      expect(Object.keys(ours)).toHaveLength(headers.length);
    });

    it("groups by the prototype's key", () => {
      expect(suggested.group?.key).toEqual([headers.indexOf(run.groupBy)]);
    });

    it("fills each list the way the prototype did: numbered columns, a split cell, or one item per row", () => {
      const theirs = Object.fromEntries(
        Object.entries(run.arrays).map(([path, list]) => [toRef(path), list.mode === 'indexed' ? { mode: 'indexed', slots: list.slots } : { mode: list.mode }]),
      );
      expect(modesOf(suggested, adapter)).toEqual(theirs);
      // The prototype split on ";", which is the engine's default: no entry needs to say so.
      expect(Object.values(run.arrays).every(list => list.delim === ';')).toBe(true);
      expect(suggested.entries.every(entry => entry.split === undefined)).toBe(true);
    });
  });

  describe('the import', () => {
    it('reads the plan with nothing to report', () => {
      expect(result.planProblems).toEqual([]);
    });

    it("builds each record that has no errors exactly as the prototype did", () => {
      expect(clean.length).toBeGreaterThan(0);
      expect(result.records).toEqual(clean.map(record => expected[run.records.indexOf(record)]));
    });

    it("reports each failed record's problems by the prototype's code, path and rows", () => {
      expect(failed.length).toBeGreaterThan(0);
      for (const record of failed) {
        const ours = result.errors.filter(error => (error.rows ?? []).every(row => record.rows.includes(row)));
        expect({ record: record.label, problems: sorted(ours.map(problemOf)) }).toEqual({
          record: record.label,
          problems: sorted(record.issues.filter(issue => !issue.warn).map(issueOf)),
        });
      }
      // Nothing is reported against a record the prototype found clean.
      const failedRows = failed.flatMap(record => record.rows);
      expect(result.errors.filter(error => !(error.rows ?? []).every(row => failedRows.includes(row)))).toEqual([]);
    });

    it("warns where the prototype warned, on the same field", () => {
      const theirs = run.records.flatMap(record => record.issues.filter(issue => issue.warn).map(issue => ({ ...issueOf(issue), within: record.rows })));
      expect(sorted((result.warnings ?? []).map(warning => ({ code: warning.code, path: shape(warning.ref) })))).toEqual(
        sorted(theirs.map(({ code, path }) => ({ code, path }))),
      );
      // The rows differ, and are not compared: the prototype names the row that disagreed, and
      // the engine names every row of the record (spec §5, left open on 2026-10-12).
      for (const warning of result.warnings ?? []) {
        const theirWarning = theirs.find(issue => issue.path === shape(warning.ref));
        expect(warning.rows).toEqual(theirWarning?.within);
        expect(theirWarning?.rows.every(row => warning.rows?.includes(row))).toBe(true);
      }
    });

    it('counts every sheet row once: imported, failed or skipped', () => {
      expect(result).toMatchObject({
        rowsRead: rows.length,
        imported: clean.length,
        rowsInImported: clean.flatMap(record => record.rows).length,
        failed: failed.flatMap(record => record.rows).length,
        skipped: 0,
      });
    });
  });

  return { suggested, result, run };
}

describe("jsonSchemaAdapter on the prototype's order schema and sheet", () => {
  const { suggested } = accept('order', file => jsonSchemaAdapter(JSON.parse(file('schema.json')), { id: 'order' }));

  it('reads the date column day first, from the one date that can only be that', () => {
    // Every other date in the sheet reads two ways. 31/09/2026 does not, though no such day exists.
    expect(suggested.entries.find(entry => entry.ref === 'orderDate')?.dateOrder).toBe('DMY');
  });
});

describe("exampleJsonAdapter on the prototype's student example and sheet", () => {
  /**
   * The sheet's dates, 01/06/2026 and 02/06/2026, read two ways and nothing in the sample says
   * which, so the suggestion sets no order and the import would refuse them (spec §8). The
   * prototype assumed day first. Here that is said, as a person would say it in the mapper.
   */
  const dayFirst = (plan: NormalizedPlan): NormalizedPlan => ({
    ...plan,
    entries: plan.entries.map(entry => (entry.ref === 'enrolledOn' ? { ...entry, dateOrder: 'DMY' as const } : entry)),
  });
  const { suggested } = accept('student', file => exampleJsonAdapter(JSON.parse(file('example.json'))), dayFirst);

  it('sets no date order where the sheet shows none, and refuses those dates until one is set', () => {
    const { headers, rows } = load('student');
    expect(suggested.entries.find(entry => entry.ref === 'enrolledOn')).not.toHaveProperty('dateOrder');
    const adapter = exampleJsonAdapter(JSON.parse(load('student').file('example.json')));
    const refused = applyMapping(rows, suggestMapping(headers, adapter, { sample: rows }), adapter, undefined);
    expect(refused.records).toEqual([]);
    expect(refused.errors.filter(error => error.ref === 'enrolledOn').map(error => [error.code, error.rows])).toEqual([
      ['CELL_FORMAT', [2, 3]],
      ['CELL_FORMAT', [4, 5]],
    ]);
  });
});
