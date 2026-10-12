/**
 * entityFormConfigAdapter: a config through sheet-to-schema's import engine.
 *
 * **Against 2.5.0, not against itself.** Since 3.0 `applyMapping` *is* the generic engine over
 * this adapter, so comparing the two would compare the new code with the new code. The record
 * of what 2.x did is `test-fixtures/import-golden-2.5.0.json`: the inputs, and what the
 * published `@dynamic-entity/core@2.5.0` made of them (`scripts/generate-import-golden.mjs`).
 * Every plan in it is a stored 2.x plan, written by 2.5.0's suggester or in its shape.
 *
 * Three differences from 2.5.0 are allowed, and each is stated where it is applied:
 * - every error carries a `code`;
 * - a required field whose cell could not be read is reported once, as unreadable, where 2.5.0
 *   also reported it as required (spec §5, reversed on 2026-10-12);
 * - a plan problem's message is sheet-to-schema's. Its level, code and path are 2.5.0's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMapping as applyGeneric,
  slotsFor,
  suggestMapping as suggestGeneric,
  type ImportResult as ImporterResult,
  type ImportRowError as ImporterRowError,
} from 'sheet-to-schema';

import { CORE_VERSION } from './constants';
import { entityFormConfigAdapter, type EntityFormConfigAdapterOptions } from './entity-form-config-adapter';
import type { EntityFormConfig, FormRule, NestedFieldConfig } from './form-model.types';
import { buildTemplateSpec, deriveImportColumns, upgradeLegacyRefs } from './import-columns';
import { applyMapping, suggestMapping, type ApplyMappingOptions } from './import-engine';
import type { ImportResult, ImportRowError, MappingPlanV1 } from './import-model.types';

const ROOT = join(__dirname, '..', '..', '..');
const SHIPPED = JSON.parse(readFileSync(join(ROOT, 'test_data.json'), 'utf8')) as EntityFormConfig[];

// ─── What 2.5.0 did ───────────────────────────────────────────────────────────

interface GoldenCase {
  name: string;
  shipped?: string;
  config?: EntityFormConfig;
  rows: unknown[][];
  plan: MappingPlanV1;
  options: ApplyMappingOptions;
  expected: { records: Record<string, unknown>[]; errors: ImportRowError[]; skipped: number; planProblems: { level: string; code?: string; path: string }[] };
}
interface GoldenSuggestion {
  shipped: string;
  headers: string[];
  arrayBound: number;
  entries: { ref: string; column: number; confidence: string }[];
}
const GOLDEN = JSON.parse(readFileSync(join(__dirname, '..', 'test-fixtures', 'import-golden-2.5.0.json'), 'utf8')) as {
  from: string;
  cases: GoldenCase[];
  suggestions: GoldenSuggestion[];
};

/** A typed cell, back from how the golden file had to write it. */
const decode = (cell: unknown): unknown =>
  cell !== null && typeof cell === 'object' && '$date' in cell ? new Date((cell as { $date: string | null }).$date ?? Number.NaN) : cell;
const configOf = (golden: { shipped?: string; config?: EntityFormConfig }): EntityFormConfig =>
  golden.config ?? (SHIPPED.find(config => config.entity === golden.shipped) as EntityFormConfig);
const caseNamed = (name: string): GoldenCase => {
  const found = GOLDEN.cases.find(golden => golden.name === name);
  if (!found) throw new Error(`The golden file has no case named "${name}".`);
  return found;
};

const shapeOfRef = (ref: string): string => ref.split('.').filter(segment => !/^\d+$/.test(segment)).join('.');

/**
 * 2.5.0's errors without the second report it makes of a field whose cell, on the same row,
 * it has already reported as unreadable. 2.5.0's errors carry no code, so the second report
 * is known by its shape: the same row and field as a cell error, and no column of its own.
 */
function withoutDoubleRequired(errors: readonly ImportRowError[]): ImportRowError[] {
  const unread = new Set(errors.filter(error => error.column !== undefined).map(error => `${error.row} ${shapeOfRef(error.ref)}`));
  return errors.filter(error => !(error.column === undefined && unread.has(`${error.row} ${shapeOfRef(error.ref)}`)));
}

/** An error as 2.5.0 wrote it: no code. A typed `raw` is compared as the golden file holds it. */
const as2x = (errors: readonly ImportRowError[]): unknown[] =>
  errors.map(error => {
    const rest = Object.fromEntries(Object.entries(error).filter(([key]) => key !== 'code'));
    const raw: unknown = rest['raw'];
    const plain = raw instanceof Date ? { ...rest, raw: { $date: Number.isNaN(raw.getTime()) ? null : raw.toISOString() } } : rest;
    return JSON.parse(JSON.stringify(plain)) as unknown;
  });

describe('what 2.5.0 imported, the 3.x engine imports', () => {
  it('has a record of every shipped config and of the cases written by hand', () => {
    expect(GOLDEN.from).toBe('@dynamic-entity/core@2.5.0, the published package');
    expect(GOLDEN.cases).toHaveLength(31);
    expect(new Set(GOLDEN.cases.flatMap(golden => (golden.shipped ? [golden.shipped] : [])))).toEqual(new Set(SHIPPED.map(config => config.entity)));
  });

  describe.each(GOLDEN.cases.map(golden => [golden.name, golden] as const))('%s', (_name, golden) => {
    const config = configOf(golden);
    const rows = golden.rows.map(row => row.map(decode));
    const result = applyMapping(rows, golden.plan, config, golden.options);

    it('builds the same records, and skips the same rows', () => {
      expect(JSON.parse(JSON.stringify(result.records))).toEqual(golden.expected.records);
      expect(result.skipped).toBe(golden.expected.skipped);
    });

    it('reports the same errors, each now with a code, and an unreadable required field once', () => {
      expect(as2x(result.errors)).toEqual(withoutDoubleRequired(golden.expected.errors));
      expect(result.errors.filter(error => !error.code)).toEqual([]);
    });

    it('finds the same problems with the plan, at the same level, code and path', () => {
      const problem = (p: { level: string; code?: string; path: string }) => ({ level: p.level, code: p.code, path: p.path });
      expect(result.planProblems.map(problem)).toEqual(golden.expected.planProblems.map(problem));
    });
  });
});

describe.each(GOLDEN.suggestions.map(golden => [golden.shipped, golden] as const))('the suggestion 2.5.0 made for the %s template', (_entity, golden) => {
  const config = configOf(golden);
  const pairs = (entries: readonly { ref: string; column?: number; confidence?: string }[]) => entries.map(e => `${e.column} ${e.ref} ${e.confidence}`).sort();

  it('is the suggestion suggestMapping makes, as plan v2', () => {
    const columns = deriveImportColumns(config, { lang: 'en', maxArrayRows: golden.arrayBound }).columns;
    const plan = suggestMapping(golden.headers, columns, config.entity);
    expect(pairs(plan.entries)).toEqual(pairs(golden.entries));
    expect(plan).toMatchObject({ planVersion: 2, target: config.entity, sourceHeaders: golden.headers });
    expect(plan).not.toHaveProperty('entity');
  });

  it('is the suggestion the generic suggester makes over the adapter', () => {
    const adapter = entityFormConfigAdapter(config, { includeReadonly: false, includeSystemDefault: false });
    expect(pairs(suggestGeneric(golden.headers, adapter, { lang: 'en' }).entries)).toEqual(pairs(golden.entries));
  });
});

/**
 * A plan saved by a 3.0 wizard is v2, and a plan stored by 2.x is v1. For the same sheet and
 * the same mapping they have to import the same records, or upgrading the wizard would
 * change what a file imports.
 */
describe.each(SHIPPED.map(config => [config.entity, config] as const))('a v2 suggestion and the equivalent stored v1 plan, for %s', (_entity, config) => {
  const golden = caseNamed(`${config.entity}: a valid row, as text and as typed cells`);
  const rows = golden.rows.map(row => row.map(decode));
  const headers = buildTemplateSpec(config, { lang: 'en' }).columns.map(column => column.header);
  const suggested = suggestMapping(headers, deriveImportColumns(config, { lang: 'en' }).columns, config.entity);

  it('map the same columns to the same fields', () => {
    const byColumn = (entries: readonly { ref: string; column?: number }[]) => entries.map(entry => `${entry.column} ${entry.ref}`).sort();
    expect(suggested).toMatchObject({ planVersion: 2, target: config.entity });
    expect(golden.plan).toMatchObject({ entity: config.entity });
    expect(golden.plan).not.toHaveProperty('planVersion');
    expect(byColumn(suggested.entries)).toEqual(byColumn(golden.plan.entries));
  });

  it('import the same records through the adapter, with nothing to report about either plan', () => {
    const adapter = entityFormConfigAdapter(config, { rules: golden.options.rules, lookups: golden.options.lookups });
    const fromV2 = applyGeneric(rows, suggested, adapter, { lang: 'en' });
    const fromV1 = applyGeneric(rows, golden.plan, adapter, { lang: 'en' });
    expect(fromV2.planProblems).toEqual([]);
    expect(fromV1.planProblems).toEqual([]);
    expect(fromV2.records.length).toBeGreaterThan(0);
    expect(fromV2.records).toEqual(fromV1.records);
    expect(fromV2.errors).toEqual(fromV1.errors);
    expect(fromV2.skipped).toBe(fromV1.skipped);
    // And both are what 2.5.0 built from the stored plan.
    expect(JSON.parse(JSON.stringify(fromV2.records))).toEqual(golden.expected.records);
  });
});

// ─── The adapter itself ───────────────────────────────────────────────────────

const text = (id: string, label: string, extra: Partial<NestedFieldConfig> = {}): NestedFieldConfig => ({ id, type: 'text', label: { en: label }, ...extra });
const phones = (extra: Partial<NestedFieldConfig> = {}): NestedFieldConfig => ({
  id: 'phones',
  type: 'array',
  label: { en: 'Phone' },
  children: [text('number', 'Number'), text('kind', 'Kind')],
  ...extra,
});
const configWith = (...fields: NestedFieldConfig[]): EntityFormConfig => ({
  entity: 'people',
  version: 4,
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [text('name', 'Name'), ...fields] }],
});
const planFor = (refs: string[], extra: Record<string, unknown> = {}) => ({
  entity: 'people',
  entries: refs.map((ref, column) => ({ ref, column })),
  ...extra,
});

describe('entityFormConfigAdapter', () => {
  it('is the config: its entity, its version, and this package as the implementation', () => {
    const adapter = entityFormConfigAdapter(configWith());
    expect([adapter.id, adapter.version, adapter.adapterVersion]).toEqual(['people', 4, CORE_VERSION]);
    expect(entityFormConfigAdapter({ entity: 'x', tabs: [] }).version).toBeUndefined();
  });

  it('lists each array once, by its record address, and never as positional', () => {
    const config = configWith(
      phones({ refererField: 'contact.phones', validators: { required: true } }),
      { id: 'kids', type: 'array', label: {}, children: [text('name', ''), { id: 'toys', type: 'array', label: { en: 'Toys' }, children: [text('toy', 'Toy')] }] },
    );
    const set = entityFormConfigAdapter(config).targets({ slots: { 'contact.phones': 2 } });
    expect(set.arrays).toEqual([
      { ref: 'contact.phones', label: 'Phone', itemKind: 'object', required: true, positional: false },
      { ref: 'kids', label: 'kids', itemKind: 'object', required: false, positional: false },
    ]);
    // Per array: two phone slots, and none of an array the caller did not ask for.
    expect(set.targets.map(t => t.ref)).toEqual(['name', 'contact.phones.0.number', 'contact.phones.1.number', 'contact.phones.0.kind', 'contact.phones.1.kind']);
    expect(set.targets[2]).toMatchObject({ shapeRef: 'contact.phones.number', arrayRef: 'contact.phones', arrayLabel: 'Phone', arrayIndex: 1, matchKeys: ['Number', 'number'] });
    expect(set.unsupported.map(u => u.ref)).toEqual(['kids.toys.toy']);
  });

  it('offers the targets deriveImportColumns derives, for the slots asked, on every shipped config', () => {
    for (const config of SHIPPED) {
      const adapter = entityFormConfigAdapter(config);
      const set = adapter.targets({ slots: Object.fromEntries(adapter.targets({ slots: {} }).arrays.map(a => [a.ref, 3])), lang: 'en' });
      const derived = deriveImportColumns(config, { lang: 'en', maxArrayRows: 3, includeReadonly: true, includeSystemDefault: true });
      expect(set.targets.map(t => [t.ref, t.header, t.required, t.arrayRef, t.arrayIndex])).toEqual(
        derived.columns.map(c => [c.ref, c.header, c.required, c.arrayRef, c.arrayIndex]),
      );
      expect(set.unsupported).toEqual(derived.unsupported.map(({ ref, reason }) => ({ ref, reason })));
      expect(set.targets.every(t => t.value.kind === 'custom')).toBe(true);
    }
  });

  it('matches a field with no label by its id alone', () => {
    const set = entityFormConfigAdapter(configWith(text('code', ''))).targets({ slots: {} });
    expect(set.targets.find(t => t.ref === 'code')?.matchKeys).toEqual(['code']);
  });

  it('leaves readonly and systemDefault fields out when a template asks', () => {
    const config = configWith(text('locked', 'Locked', { readonly: true }), text('auto', 'Auto', { systemDefault: true }));
    const refs = (options: EntityFormConfigAdapterOptions) => entityFormConfigAdapter(config, options).targets({ slots: {} }).targets.map(t => t.ref);
    expect(refs({})).toEqual(['name', 'locked', 'auto']);
    expect(refs({ includeReadonly: false, includeSystemDefault: false })).toEqual(['name']);
  });

  it('sizes slots per array from the headers, where 2.x sized every array alike', () => {
    const config = configWith(phones(), { id: 'guardians', type: 'array', label: { en: 'Guardian' }, children: [text('name', 'Name')] });
    const headers = ['Name', ...[1, 2, 3, 4, 5, 6].map(n => `Phone ${n} Number`), 'Guardian 2 Name'];
    expect(slotsFor(headers, entityFormConfigAdapter(config))).toEqual({ phones: 6, guardians: 3 });
  });
});

describe('entityFormConfigAdapter — what plan v2 adds for a Dynamic Entity config', () => {
  it('cannot keep empty slots in place: compact false is a plan error', () => {
    const adapter = entityFormConfigAdapter(configWith(phones()));
    const plan = { planVersion: 2, target: 'people', entries: [{ ref: 'phones.1.number', column: 0 }], lists: { phones: { compact: false } } };
    const result = applyGeneric([['222']], plan, adapter, {});
    expect(result.planProblems).toContainEqual(expect.objectContaining({ level: 'error', code: 'PLAN_LIST_OPTION' }));
    expect(result.records).toEqual([]);
  });

  it('collects one array item per row of a group, through applyMapping, which 2.x could not', () => {
    const plan = {
      planVersion: 2 as const,
      target: 'people',
      entries: [{ ref: 'name', column: 0 }, { ref: 'phones.number', column: 1 }, { ref: 'phones.kind', column: 2 }],
      group: { key: [0], collect: ['phones'] },
    };
    const result = applyMapping([['Ada', '111', 'home'], ['Ada', '222', 'work'], ['Bo', '333', 'cell']], plan, configWith(phones()), { stamp: false });
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { name: 'Ada', phones: [{ number: '111', kind: 'home' }, { number: '222', kind: 'work' }] },
      { name: 'Bo', phones: [{ number: '333', kind: 'cell' }] },
    ]);
    // A 2.x result had no `warnings`, and has none still when there is nothing to warn about.
    expect(result).not.toHaveProperty('warnings');
  });

  it('warns, and still imports, when rows of a group disagree', () => {
    const config = configWith(text('city', 'City'), phones());
    const plan = {
      planVersion: 2 as const,
      target: 'people',
      entries: [{ ref: 'name', column: 0 }, { ref: 'city', column: 1 }, { ref: 'phones.number', column: 2 }],
      group: { key: [0], collect: ['phones'] },
    };
    const result = applyMapping([['Ada', 'Paris', '111'], ['Ada', 'Rome', '222']], plan, config, { stamp: false });
    expect(result.records).toEqual([{ name: 'Ada', city: 'Paris', phones: [{ number: '111' }, { number: '222' }] }]);
    expect(result.warnings).toEqual([expect.objectContaining({ row: 2, rows: [2, 3], ref: 'city', code: 'RECORD_GROUP_CONFLICT' })]);
  });

  /**
   * A v2 plan states the order per column (spec §3). The adapter reads its own cells, so it is
   * handed the resolved order as `coerce`'s fourth argument: the entry's, else the run's.
   */
  it("reads each date column in the order its plan entry states, and the rest in the run's", () => {
    const config = configWith({ id: 'born', type: 'date', label: { en: 'Born' } }, { id: 'joined', type: 'date', label: { en: 'Joined' } });
    const adapter = entityFormConfigAdapter(config);
    const plan = (born?: string, joined?: string) => ({
      planVersion: 2,
      target: 'people',
      entries: [
        { ref: 'name', column: 0 },
        { ref: 'born', column: 1, ...(born ? { dateOrder: born } : {}) },
        { ref: 'joined', column: 2, ...(joined ? { dateOrder: joined } : {}) },
      ],
    });
    const rows = [['Ada', '05/09/2026', '05/09/2026']];
    const dates = (result: ImporterResult) => result.records.map(({ born, joined }) => [born, joined]);

    // Two columns of one sheet, written two ways.
    expect(dates(applyGeneric(rows, plan('DMY', 'MDY'), adapter, { stamp: false }))).toEqual([['2026-09-05', '2026-05-09']]);
    // The run's order, from the context as 2.5.0 has it, is the default for a column that states none.
    expect(dates(applyGeneric(rows, plan('DMY'), adapter, { stamp: false, dateOrder: 'MDY' }))).toEqual([['2026-09-05', '2026-05-09']]);
    // The engine's own run option is the same default.
    expect(dates(applyGeneric(rows, plan(), adapter, { stamp: false }, { dateOrder: 'DMY' }))).toEqual([['2026-09-05', '2026-09-05']]);
    // An entry beats both.
    expect(dates(applyGeneric(rows, plan('DMY', 'DMY'), adapter, { stamp: false, dateOrder: 'MDY' }, { dateOrder: 'MDY' }))).toEqual([['2026-09-05', '2026-09-05']]);
    // With none anywhere the date is refused, as DE 2.5.0 refuses it.
    const refused = applyGeneric(rows, plan(), adapter, { stamp: false });
    expect(refused.records).toEqual([]);
    expect(refused.errors.map(e => [e.ref, e.code])).toEqual([['born', 'CELL_FORMAT'], ['joined', 'CELL_FORMAT']]);
  });

  it('reads a number with the decimal mark the run states, from the engine or from the context', () => {
    const adapter = entityFormConfigAdapter(configWith({ id: 'price', type: 'currency', label: { en: 'Price' } }));
    const plan = planFor(['name', 'price']);
    expect(applyGeneric([['Ada', '1,5']], plan, adapter, { stamp: false }, { decimal: ',' }).records[0]['price']).toBe(1.5);
    expect(applyGeneric([['Ada', '1,5']], plan, adapter, { stamp: false, decimal: ',' }).records[0]['price']).toBe(1.5);
  });

  it('says why each cell and each record failed, in a code', () => {
    const golden = caseNamed('each kind of cell and record failure');
    const result = applyMapping(golden.rows.map(row => row.map(decode)), golden.plan, configOf(golden), golden.options);
    expect(result.errors.map(e => [e.row, e.ref, e.code])).toEqual([
      [3, 'age', 'CELL_FORMAT'],
      [3, 'tier', 'CELL_UNKNOWN_OPTION'],
      [3, 'born', 'CELL_FORMAT'],
      [3, 'kinds', 'CELL_UNKNOWN_OPTION'],
      [3, 'email', 'RECORD_FORMAT'],
      // A broken date cell in an option field is unreadable, not an unknown option.
      [4, 'tier', 'CELL_FORMAT'],
      [4, 'age', 'RECORD_RANGE'],
    ]);
  });

  it('says a rule raised an error, and that a field was required', () => {
    const golden = caseNamed('a rule hides a required field, and a rule raises an error');
    const result = applyMapping(golden.rows, golden.plan, configOf(golden), { ...golden.options, rules: golden.options.rules as FormRule[] });
    expect(result.errors.map(e => [e.row, e.ref, e.code])).toEqual([
      [3, 'reason', 'RECORD_REQUIRED'],
      [4, 'note', 'RECORD_RULE'],
    ]);
  });
});

describe('a plan that names no target', () => {
  const config = configWith();
  const entries = [{ ref: 'name', column: 0 }];

  it('is read against the config in hand when it is a 2.x plan, as 2.x read it', () => {
    const result = applyMapping([['Ada']], { entries } as unknown as MappingPlanV1, config, { stamp: false });
    expect(result.planProblems).toEqual([]);
    expect(result.records).toEqual([{ name: 'Ada' }]);
    expect(applyMapping([['Ada']], { entity: '', entries }, config, { stamp: false }).records).toEqual([{ name: 'Ada' }]);
  });

  it('is refused when it is plan v2, which must name one', () => {
    const result = applyMapping([['Ada']], { planVersion: 2, entries } as never, config, { stamp: false });
    expect(result.records).toEqual([]);
    expect(result.planProblems.filter(problem => problem.level === 'error').map(problem => problem.path)).toEqual(['target']);
  });

  it('is let through as plan v2 only with the empty target suggestMapping writes when given no entity', () => {
    const suggested = suggestMapping(['Name'], deriveImportColumns(config).columns);
    expect(suggested).toMatchObject({ planVersion: 2, target: '' });
    const result = applyMapping([['Ada']], suggested, config, { stamp: false });
    expect(result.planProblems).toEqual([]);
    expect(result.records).toEqual([{ name: 'Ada' }]);
  });
});

/**
 * Dynamic Entity keeps its own result types: its plan problems are `ConfigProblem`s, whose
 * `code` is optional, where the importer's require one. What the engine returns has to fit
 * them, so `applyMapping` can hand it back. Checked by the compiler: this file does not
 * compile if the importer's types stop being assignable to Dynamic Entity's.
 */
describe('the result types', () => {
  it("take whatever sheet-to-schema's engine returns", () => {
    const fromEngine: ImporterResult = { records: [], errors: [], skipped: 0, planProblems: [] };
    const rowFromEngine: ImporterRowError = { row: 2, rows: [2, 3], ref: 'name', code: 'CELL_FORMAT', message: 'x' };
    const asDynamicEntity: ImportResult = fromEngine;
    const rowAsDynamicEntity: ImportRowError = rowFromEngine;
    expect(asDynamicEntity).toBe(fromEngine);
    expect(rowAsDynamicEntity).toBe(rowFromEngine);
  });
});

/**
 * `upgradeLegacyRefs` is public, and the mapper and the preview screen call it to show what a
 * 2.2 ref means now. The engine no longer calls it, since the plan reader resolves the alias
 * itself, so it is held here directly.
 */
describe('upgradeLegacyRefs', () => {
  const moved = configWith(phones({ refererField: 'contact.phones' }));

  it('rewrites a 2.2 ref of a moved array to the slot it means now, and keeps the rest of the plan', () => {
    const plan = { entity: 'people', configVersion: 4, entries: [{ ref: 'name', column: 0 }, { ref: 'phones.number', column: 1, header: 'Phone' }] };
    expect(upgradeLegacyRefs(plan, moved)).toEqual({
      entity: 'people',
      configVersion: 4,
      entries: [{ ref: 'name', column: 0 }, { ref: 'contact.phones.0.number', column: 1, header: 'Phone' }],
    });
  });

  it('leaves an entry that is not an entry where it is, for the plan reader to report', () => {
    const entries = [null, { ref: 'phones.number', column: 1 }] as unknown as MappingPlanV1['entries'];
    expect(upgradeLegacyRefs({ entity: 'people', entries }, moved).entries).toEqual([null, { ref: 'contact.phones.0.number', column: 1 }]);
  });

  it('returns the same plan when nothing in the config moved, and what is not a plan as it is', () => {
    const plan = planFor(['name', 'phones.0.number']);
    expect(upgradeLegacyRefs(plan, configWith(phones()))).toBe(plan);
    expect(upgradeLegacyRefs(null as never, moved)).toBeNull();
  });
});
