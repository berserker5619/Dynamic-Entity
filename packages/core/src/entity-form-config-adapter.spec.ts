/**
 * entityFormConfigAdapter: a config through the generic import engine.
 *
 * The claim under test is parity. The same rows and the same stored plan go through 2.x's
 * `applyMapping` (this package) and through the importer's `applyMapping` over the adapter, and
 * must give the same records, the same errors and the same skips. Two differences are allowed:
 * - the importer adds a `code` to each error;
 * - 2.x reports a required field whose cell could not be read twice, once as unreadable and
 *   once as required. The generic engine reports it as unreadable only (spec §5, reversed on
 *   2026-10-12). `withoutDoubleRequired` takes exactly those second reports out of 2.x's list.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMapping as applyGeneric,
  readPlan,
  slotsFor,
  suggestMapping as suggestGeneric,
  validatePlan,
  type ImportRowError as GenericRowError,
} from 'sheet-to-schema';

import { arrayBoundFor } from './array-headers';
import { CORE_VERSION } from './constants';
import { entityFormConfigAdapter, type EntityFormConfigAdapterOptions } from './entity-form-config-adapter';
import { ratingScale, sliderBounds } from './field-values';
import type { EntityFormConfig, FormRule, NestedFieldConfig } from './form-model.types';
import { buildTemplateSpec, deriveImportColumns } from './import-columns';
import { applyMapping, suggestMapping, type ApplyMappingOptions, type ImportLookups } from './import-engine';
import type { ImportColumn, ImportRowError, MappingPlan } from './import-model.types';
import { lookupValuesToOptions, normalizeLookupValues } from './lookup-list';

const ROOT = join(__dirname, '..', '..', '..');
const SHIPPED = JSON.parse(readFileSync(join(ROOT, 'test_data.json'), 'utf8')) as EntityFormConfig[];

/** The real `clientTier` list, as `server/src/all-configs.spec.ts` resolves it. */
const LOOKUPS: ImportLookups = {
  clientTier: lookupValuesToOptions(
    normalizeLookupValues(
      JSON.parse(readFileSync(join(ROOT, 'packages', 'demo-angular', 'src', 'app', 'mock', 'client-tier-list.json'), 'utf8')),
    ),
  ),
};

/** `rules` rides on the JSON beside the config; `EntityFormConfig` does not declare it. */
const rulesOf = (config: EntityFormConfig): FormRule[] => {
  const raw = (config as unknown as Record<string, unknown>)['rules'];
  return Array.isArray(raw) ? (raw as FormRule[]) : [];
};

/** The 2.x result and the generic engine's, for the same rows, plan and options. */
function both(
  rows: unknown[][],
  plan: unknown,
  config: EntityFormConfig,
  options: ApplyMappingOptions = {},
  adapterOptions: EntityFormConfigAdapterOptions = {},
) {
  const { lang, decimal, stamp, rules, lookups } = options;
  const old = applyMapping(rows, plan as MappingPlan, config, options);
  const adapter = entityFormConfigAdapter(config, { rules, lookups, ...adapterOptions });
  const neu = applyGeneric(rows, plan, adapter, { lang, decimal, stamp });
  return { old, neu };
}

const withoutCode = (errors: readonly GenericRowError[]) =>
  errors.map(error => {
    const copy: Partial<GenericRowError> = { ...error };
    delete copy.code;
    return copy;
  });

const shapeOfRef = (ref: string): string => ref.split('.').filter(segment => !/^\d+$/.test(segment)).join('.');

/**
 * 2.x's errors without the "required" it adds for a field whose cell, on the same row, it
 * has already reported as unreadable. 2.x errors carry no code, so the second report is known
 * by its shape: no column, and the message validators give a missing value.
 */
function withoutDoubleRequired(errors: readonly ImportRowError[]): ImportRowError[] {
  const unread = new Set(errors.filter(error => error.column !== undefined).map(error => `${error.row} ${shapeOfRef(error.ref)}`));
  return errors.filter(
    error => !(error.column === undefined && / is required$/.test(error.message) && unread.has(`${error.row} ${shapeOfRef(error.ref)}`)),
  );
}

/** Assert the two engines agree, and hand both results back for anything more specific. */
function expectParity(...args: Parameters<typeof both>) {
  const { old, neu } = both(...args);
  expect(neu.records).toEqual(old.records);
  expect(withoutCode(neu.errors)).toEqual(withoutDoubleRequired(old.errors));
  expect(neu.skipped).toBe(old.skipped);
  expect(neu.planProblems.map(p => `${p.level} ${p.code}`).sort()).toEqual(old.planProblems.map(p => `${p.level} ${p.code}`).sort());
  // Every error the generic engine reports says why, in a code.
  expect(neu.errors.filter(error => !error.code)).toEqual([]);
  return { old, neu };
}

// ─── A row for any config ─────────────────────────────────────────────────────

const PATTERN_CANDIDATES = ['ada@example.com', 'AB123456C', 'ABC-123', 'REF-0001', '123-45-6789', 'AST-00042', '12345', 'A1', 'Sample'];

/** A cell the field accepts, as text. A compact form of the server's `config-rows.fixtures.ts`. */
function cellFor(column: ImportColumn): string {
  const field = column.field;
  const validators = field.validators ?? {};
  switch (field.type) {
    case 'dropdown':
    case 'radio':
    case 'multiSelect': {
      const fromList = field.listName ? LOOKUPS[field.listName]?.[0] : undefined;
      return column.enumValues?.[0] ?? (fromList ? String((fromList as Record<string, unknown>)['en'] ?? '') : '') ?? '';
    }
    case 'boolean':
    case 'checkbox':
      return 'true';
    case 'number':
    case 'currency':
      return String(Math.min(Math.max(42, validators.min ?? 42), validators.max ?? 42));
    case 'date':
      return '2024-03-07';
    case 'datetime':
      return '2024-03-07T09:30:00.000Z';
    case 'monthYear':
      return '2024-03';
    case 'time':
      return '09:30';
    case 'url':
      return 'https://example.com/profile';
    case 'phone':
      return '+1 555 555 0123';
    case 'color':
      return '#336699';
    case 'tags':
      return 'alpha;beta';
    case 'slider':
      return String(sliderBounds(field).min);
    case 'rating':
      return String(ratingScale(field));
    default: {
      if (validators.pattern) {
        const regex = new RegExp(validators.pattern);
        return PATTERN_CANDIDATES.find(candidate => regex.test(candidate)) ?? '';
      }
      if (validators.email) return 'ada@example.com';
      let text = `Sample ${field.id}`;
      if (typeof validators.minLength === 'number') text = text.padEnd(validators.minLength, 'x');
      if (typeof validators.maxLength === 'number') text = text.slice(0, validators.maxLength);
      return text;
    }
  }
}

/** The typed cell an xlsx would carry for the field, where it has one. */
function typedCellFor(column: ImportColumn): unknown {
  switch (column.field.type) {
    case 'boolean':
    case 'checkbox':
      return true;
    case 'number':
    case 'currency':
    case 'slider':
    case 'rating':
      return Number(cellFor(column));
    case 'date':
    case 'monthYear':
      return new Date(Date.UTC(2024, 2, 7));
    case 'datetime':
      return new Date(Date.UTC(2024, 2, 7, 9, 30));
    case 'time':
      return new Date(Date.UTC(1899, 11, 30, 9, 30));
    default:
      return cellFor(column);
  }
}

// ─── Every shipped config ─────────────────────────────────────────────────────

describe.each(SHIPPED.map(config => [config.entity, config] as const))('parity on the shipped config %s', (_entity, config) => {
  const spec = buildTemplateSpec(config, { lang: 'en' });
  const headers = spec.columns.map(column => column.header);
  const plan = suggestMapping(headers, deriveImportColumns(config, { lang: 'en' }).columns, config.entity);
  const options = { lang: 'en', lookups: LOOKUPS, rules: rulesOf(config) };
  const adapter = entityFormConfigAdapter(config, options);

  it('reads its stored v1 plan without errors, as planVersion 2', () => {
    const { plan: read, problems } = readPlan(JSON.parse(JSON.stringify({ ...plan, configVersion: config.version })));
    expect(problems.filter(problem => problem.level === 'error')).toEqual([]);
    expect(read).toMatchObject({ planVersion: 2, target: config.entity, schemaVersion: config.version });
    expect(validatePlan(read!, adapter)).toEqual([]);
  });

  it('imports a valid row, as text and as typed cells, into the same record', () => {
    const text = spec.columns.map(cellFor);
    const typed = spec.columns.map(typedCellFor);
    const { neu } = expectParity([text, typed], plan, config, options);
    expect(neu.errors).toEqual([]);
    expect(neu.records).toHaveLength(2);
  });

  it('reports the same errors for a row of cells nothing can read, and skips the same blanks', () => {
    const garbage = spec.columns.map(() => '???');
    const blank = spec.columns.map(() => '');
    const { neu } = expectParity([garbage, blank, [], garbage], plan, config, options);
    expect(neu.skipped).toBe(2);
    // A config of plain text fields reads anything, so only the count is fixed here.
    expect(neu.records.length + new Set(neu.errors.map(error => error.row)).size).toBe(2);
  });

  it('offers the targets deriveImportColumns derives, for the slots asked', () => {
    const set = adapter.targets({ slots: Object.fromEntries(adapter.targets({ slots: {} }).arrays.map(a => [a.ref, 3])), lang: 'en' });
    const derived = deriveImportColumns(config, { lang: 'en', maxArrayRows: 3, includeReadonly: true, includeSystemDefault: true });
    expect(set.targets.map(t => [t.ref, t.header, t.required, t.arrayRef, t.arrayIndex])).toEqual(
      derived.columns.map(c => [c.ref, c.header, c.required, c.arrayRef, c.arrayIndex]),
    );
    expect(set.unsupported).toEqual(derived.unsupported.map(({ ref, reason }) => ({ ref, reason })));
    expect(set.targets.every(t => t.value.kind === 'custom')).toBe(true);
  });

  it('suggests the mapping 2.x suggests for its own template', () => {
    const suggested = suggestGeneric(headers, entityFormConfigAdapter(config, { includeReadonly: false, includeSystemDefault: false }), { lang: 'en' });
    const bound = arrayBoundFor(headers, config, undefined, 'en');
    const old = suggestMapping(headers, deriveImportColumns(config, { lang: 'en', maxArrayRows: bound }).columns, config.entity);
    const pairs = (entries: readonly { ref: string; column?: number; confidence?: string }[]) =>
      entries.map(e => `${e.column} ${e.ref} ${e.confidence}`).sort();
    expect(pairs(suggested.entries)).toEqual(pairs(old.entries));
    expect(suggested.target).toBe(config.entity);
  });
});

// ─── Hand-written cases ───────────────────────────────────────────────────────

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

describe('entityFormConfigAdapter — parity, case by case', () => {
  it('reads a 2.2 ref of a moved array as slot 0, with the 2.3 warning', () => {
    const config = configWith(phones({ refererField: 'contact.phones' }));
    const { old, neu } = expectParity([['Ada', '111']], planFor(['name', 'phones.number']), config, { stamp: false });
    expect(neu.records[0]['contact']).toEqual({ phones: [{ number: '111' }] });
    const warning = (problems: readonly { code?: string }[]) => problems.filter(p => p.code === 'PLAN_LEGACY_REF');
    expect(warning(neu.planProblems)).toEqual(warning(old.planProblems));
    expect(warning(neu.planProblems)).toHaveLength(1);
  });

  it('writes a moved group at its override and at its position, as the form saves it', () => {
    const config = configWith({ id: 'addr', type: 'group', label: { en: 'Address' }, refererField: 'customer.address', children: [text('city', 'City')] });
    const { neu } = expectParity([['Ada', 'Paris']], planFor(['name', 'addr.city']), config, { stamp: false });
    expect(neu.records[0]).toEqual({ name: 'Ada', customer: { address: { city: 'Paris' } }, addr: { city: 'Paris' } });
  });

  it('refuses an old ref mapped alongside its new one', () => {
    const config = configWith(phones({ refererField: 'contact.phones' }));
    const { neu } = expectParity([['111', '222']], planFor(['phones.number', 'contact.phones.0.number']), config);
    expect(neu.planProblems).toContainEqual(expect.objectContaining({ level: 'error', code: 'PLAN_DUPLICATE_REF' }));
    expect(neu.records).toEqual([]);
  });

  it('refuses a ref the config does not have', () => {
    const { neu } = expectParity([['x']], planFor(['nope']), configWith());
    expect(neu.planProblems).toContainEqual(expect.objectContaining({ level: 'error', code: 'PLAN_UNKNOWN_REF' }));
  });

  it('warns about a plan for another entity or another config version', () => {
    const plan = { ...planFor(['name']), entity: 'pets', configVersion: 3 };
    const { neu } = expectParity([['Ada']], plan, configWith());
    expect(neu.planProblems.map(p => p.code)).toEqual(['PLAN_TARGET_MISMATCH', 'PLAN_TARGET_MISMATCH']);
    expect(neu.records).toHaveLength(1);
  });

  it('compacts a sparse array and stamps the record', () => {
    const { neu } = expectParity([['Ada', '', '', '222', 'cell']], planFor(['name', 'phones.0.number', 'phones.0.kind', 'phones.1.number', 'phones.1.kind']), configWith(phones()));
    expect(neu.records[0]).toEqual({ name: 'Ada', phones: [{ number: '222', kind: 'cell' }], _configVersion: 4 });
  });

  it('cannot keep empty slots in place: compact false is a plan error', () => {
    const adapter = entityFormConfigAdapter(configWith(phones()));
    const plan = { planVersion: 2, target: 'people', entries: [{ ref: 'phones.1.number', column: 0 }], lists: { phones: { compact: false } } };
    const result = applyGeneric([['222']], plan, adapter, {});
    expect(result.planProblems).toContainEqual(expect.objectContaining({ level: 'error', code: 'PLAN_LIST_OPTION' }));
    expect(result.records).toEqual([]);
  });

  it('collects one array item per row of a group, which 2.x could not', () => {
    const adapter = entityFormConfigAdapter(configWith(phones()));
    const plan = {
      planVersion: 2,
      target: 'people',
      entries: [{ ref: 'name', column: 0 }, { ref: 'phones.number', column: 1 }],
      group: { key: [0], collect: ['phones'] },
    };
    const result = applyGeneric([['Ada', '111'], ['Ada', '222'], ['Bo', '333']], plan, adapter, { stamp: false });
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { name: 'Ada', phones: [{ number: '111' }, { number: '222' }] },
      { name: 'Bo', phones: [{ number: '333' }] },
    ]);
  });

  it('hides what a rule hides, shows what it shows, and raises what it raises', () => {
    const rule = (value: string, action: FormRule['action'], target: string): FormRule => ({
      formConfigId: 'people',
      fieldId: 'name',
      conditions: [{ operator: 'EQUAL', value, compareType: 'value' }],
      action,
      targets: [{ id: target, type: 'field' }],
      enabled: true,
      priority: 0,
    });
    const config = configWith(text('reason', 'Reason', { validators: { required: true } }), text('note', 'Note'));
    const rules = [
      rule('skip', { type: 'visibility', value: false }, 'reason'),
      rule('bad', { type: 'validation', value: 'Not allowed' } as FormRule['action'], 'note'),
    ];
    const { neu } = expectParity([['skip', '', ''], ['Ada', '', ''], ['bad', 'r', 'n']], planFor(['name', 'reason', 'note']), config, { rules, stamp: false });
    expect(neu.records).toEqual([{ name: 'skip' }]);
    expect(neu.errors.map(e => [e.row, e.ref, e.code])).toEqual([
      [3, 'reason', 'RECORD_REQUIRED'],
      [4, 'note', 'RECORD_RULE'],
    ]);
  });

  it('says why each cell and each record failed, in a code', () => {
    const config = configWith(
      { id: 'age', type: 'number', label: { en: 'Age' }, validators: { min: 18 } },
      { id: 'tier', type: 'dropdown', label: { en: 'Tier' }, options: [{ en: 'Gold' }, { en: 'Silver' }] },
      text('email', 'Email', { validators: { email: true } }),
      { id: 'born', type: 'date', label: { en: 'Born' } },
      { id: 'kinds', type: 'multiSelect', label: { en: 'Kinds' }, listName: 'kinds' },
    );
    const plan = planFor(['name', 'age', 'tier', 'email', 'born', 'kinds']);
    const options = { stamp: false, lookups: { kinds: [{ en: 'A' }, { en: 'B' }] } };
    const { neu } = expectParity(
      [
        ['Ada', '30', 'Gold', 'ada@example.com', '2024-03-07', 'A; B'],
        ['Bo', 'x', 'Bronze', 'nope', 'never', 'C'],
        ['Cy', '7', new Date(Number.NaN), '', '', ''],
      ],
      plan,
      config,
      options,
    );
    expect(neu.records).toEqual([{ name: 'Ada', age: 30, tier: { en: 'Gold' }, email: 'ada@example.com', born: '2024-03-07', kinds: [{ en: 'A' }, { en: 'B' }] }]);
    expect(neu.errors.map(e => [e.row, e.ref, e.code])).toEqual([
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

  it('reads a decimal comma when the run says so, and error text in the run\'s language', () => {
    const config = configWith({ id: 'price', type: 'currency', label: { en: 'Price', de: 'Preis' }, validators: { required: true } });
    const plan = planFor(['name', 'price']);
    expect(expectParity([['Ada', '1,5']], plan, config, { decimal: ',', stamp: false }).neu.records[0]['price']).toBe(1.5);
    expect(expectParity([['Ada', '']], plan, config, { lang: 'de' }).neu.errors[0].message).toBe('Preis is required');
  });

  it('keeps the form\'s email rule, which takes an address the generic rule refuses', () => {
    // Angular's Validators.email, which the form applies, needs no dot in the domain. The
    // generic engine holds `format: 'email'` to ajv-formats' rule and refuses this address.
    const config = configWith(text('email', 'Email', { validators: { email: true } }));
    const { neu } = expectParity([['Rahul', 'rahul.k@example'], ['Ada', 'ada@']], planFor(['name', 'email']), config, { stamp: false });
    expect(neu.records).toEqual([{ name: 'Rahul', email: 'rahul.k@example' }]);
    expect(neu.errors.map(e => [e.row, e.ref, e.code])).toEqual([[3, 'email', 'RECORD_FORMAT']]);
  });

  it('reports a required field whose cell could not be read once, where 2.x reports it twice', () => {
    const config = configWith({ id: 'age', type: 'number', label: { en: 'Age' }, validators: { required: true } }, text('city', 'City', { validators: { required: true } }));
    const { old, neu } = expectParity([['Ada', 'old', '']], planFor(['name', 'age', 'city']), config, { stamp: false });
    expect(old.errors.map(e => e.ref)).toEqual(['age', 'age', 'city']);
    expect(neu.errors.map(e => [e.ref, e.code])).toEqual([
      ['age', 'CELL_FORMAT'],
      // Nothing was typed for the city, which is what required means.
      ['city', 'RECORD_REQUIRED'],
    ]);
  });

  it('takes a typed constant as it is, and a text one through the field', () => {
    const config = configWith({ id: 'active', type: 'boolean', label: { en: 'Active' } }, { id: 'tier', type: 'dropdown', label: { en: 'Tier' }, options: [{ en: 'Gold' }] });
    const plan = { entity: 'people', entries: [{ ref: 'name', column: 0 }, { ref: 'active', constant: 'yes' }, { ref: 'tier', constant: { en: 'Gold' } }] };
    const { neu } = expectParity([['Ada'], ['']], plan, config, { stamp: false });
    expect(neu.records).toEqual([{ name: 'Ada', active: true, tier: { en: 'Gold' } }]);
    expect(neu.skipped).toBe(1);
  });
});
