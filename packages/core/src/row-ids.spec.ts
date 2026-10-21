/**
 * Stable row identity: `$rowId` on every object row of an `array` field, what the migration
 * gives rows saved before 3.2, and the places it must never show up.
 */
import type { EntityFormConfig, NestedFieldConfig } from './form-model.types';
import { buildTemplateSpec, deriveImportColumns } from './import-columns';
import { applyMapping, suggestMapping } from './import-engine';
import { compactArrays, validateImportedRecord } from './import-internals';
import { applyRowIds, migrateRecord, rowIdMigration } from './migration';
import { LEGACY_ROW_ID_PREFIX, ROW_ID_KEY, newRowId, stampNewRowIds } from './row-ids';
import { validateConfig } from './validate-config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const text = (id: string, extra: Partial<NestedFieldConfig> = {}): NestedFieldConfig =>
  ({ id, type: 'text', label: { en: id }, ...extra }) as NestedFieldConfig;
const array = (id: string, children: NestedFieldConfig[] | undefined, extra: Partial<NestedFieldConfig> = {}): NestedFieldConfig =>
  ({ id, type: 'array', label: { en: id }, ...(children ? { children } : {}), ...extra }) as NestedFieldConfig;
const group = (id: string, children: NestedFieldConfig[]): NestedFieldConfig =>
  ({ id, type: 'group', label: { en: id }, children }) as NestedFieldConfig;

const PHONES = array('phones', [text('number')]);
const CONFIG: EntityFormConfig = {
  entity: 'person',
  version: 2,
  tabs: [{ id: 'main', label: { en: 'Main' }, fields: [text('name'), PHONES, array('tags', undefined)] }],
} as EntityFormConfig;

/** A record as 3.1 saved it: rows with no ids. */
const RECORD_31 = () => ({
  main: { name: 'Ada', phones: [{ number: '111' }, { number: '222' }, { number: '333' }], tags: ['a', 'b'] },
});

describe('newRowId', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  });
  const withCrypto = (value: unknown) => Object.defineProperty(globalThis, 'crypto', { value, configurable: true });

  it('uses crypto.randomUUID when it exists', () => {
    withCrypto({ randomUUID: () => 'from-random-uuid' });
    expect(newRowId()).toBe('from-random-uuid');
  });

  it('works outside a secure context, where randomUUID is missing', () => {
    withCrypto({ getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
    expect(newRowId()).toMatch(UUID);
  });

  it('works with no crypto at all', () => {
    withCrypto(undefined);
    const ids = new Set(Array.from({ length: 50 }, () => newRowId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID);
  });

  it('gives a different id every call', () => {
    expect(newRowId()).not.toBe(newRowId());
  });
});

describe('applyRowIds', () => {
  it('gives each row of a 3.1 record a positional legacy id', () => {
    const out = applyRowIds(RECORD_31(), CONFIG);
    expect(out['main'].phones.map((row: Record<string, unknown>) => row[ROW_ID_KEY])).toEqual([
      'legacy-1',
      'legacy-2',
      'legacy-3',
    ]);
    expect(out['main'].phones[0].number).toBe('111');
  });

  it('gives a 3.1 record migrated twice identical ids', () => {
    const once = applyRowIds(RECORD_31(), CONFIG);
    expect(applyRowIds(RECORD_31(), CONFIG)).toEqual(once);
    expect(applyRowIds(once, CONFIG)).toEqual(once);
  });

  it('never changes an existing id, and skips legacy numbers already in use', () => {
    const record = {
      main: { phones: [{ number: '1' }, { [ROW_ID_KEY]: 'legacy-2', number: '2' }, { [ROW_ID_KEY]: 'abc', number: '3' }, { number: '4' }] },
    };
    const ids = applyRowIds(record, CONFIG)['main'].phones.map((row: Record<string, unknown>) => row[ROW_ID_KEY]);
    expect(ids).toEqual(['legacy-1', 'legacy-2', 'abc', 'legacy-3']);
  });

  it('leaves an array of plain values alone', () => {
    expect(applyRowIds(RECORD_31(), CONFIG)['main'].tags).toEqual(['a', 'b']);
  });

  it('leaves an array field with no children alone, even when its rows are objects', () => {
    const record = { main: { tags: [{ x: 1 }] } };
    expect(applyRowIds(record, CONFIG)['main'].tags).toEqual([{ x: 1 }]);
  });

  it('does not mutate its input', () => {
    const record = RECORD_31();
    applyRowIds(record, CONFIG);
    expect(record).toEqual(RECORD_31());
  });

  it('reaches a nested array inside a group inside a tab, and the rows of an array inside a row', () => {
    const config = {
      entity: 'e',
      tabs: [
        {
          id: 'outer',
          label: { en: 'Outer' },
          fields: [],
          children: [
            {
              id: 'inner',
              label: { en: 'Inner' },
              fields: [group('address', [array('lines', [text('line'), array('notes', [text('note')])])])],
            },
          ],
        },
      ],
    } as unknown as EntityFormConfig;
    const record = {
      outer: { inner: { address: { lines: [{ line: 'a', notes: [{ note: 'x' }, { note: 'y' }] }, { line: 'b' }] } } },
    };

    const lines = applyRowIds(record, config)['outer'].inner.address.lines;
    expect(lines.map((row: Record<string, unknown>) => row[ROW_ID_KEY])).toEqual(['legacy-1', 'legacy-2']);
    expect(lines[0].notes.map((row: Record<string, unknown>) => row[ROW_ID_KEY])).toEqual(['legacy-1', 'legacy-2']);
  });

  it('reads a flatData tab at its parent level', () => {
    const config = {
      entity: 'e',
      tabs: [{ id: 'flat', label: { en: 'Flat' }, flatData: true, fields: [PHONES] }],
    } as unknown as EntityFormConfig;
    const out = applyRowIds({ phones: [{ number: '1' }] }, config);
    expect(out['phones'][0][ROW_ID_KEY]).toBe('legacy-1');
    expect(out['flat']).toBeUndefined();
  });

  it('gives a moved array the same ids at its refererField as at its position', () => {
    const config = {
      entity: 'e',
      tabs: [{ id: 'main', label: { en: 'Main' }, fields: [array('phones', [text('number')], { refererField: 'contact.phones' })] }],
    } as unknown as EntityFormConfig;
    const record = { main: { phones: [{ number: '1' }] }, contact: { phones: [{ number: '1' }] } };
    const out = applyRowIds(record, config);
    expect(out['contact'].phones[0][ROW_ID_KEY]).toBe('legacy-1');
    expect(out['main'].phones[0][ROW_ID_KEY]).toBe('legacy-1');
  });

  it('returns a non-object unchanged', () => {
    expect(applyRowIds(null as never, CONFIG)).toBeNull();
  });
});

describe('rowIdMigration', () => {
  it('runs as a migration step into the config version', () => {
    const step = rowIdMigration(CONFIG);
    expect(step).toMatchObject({ from: 1, to: 2 });

    const result = migrateRecord({ ...RECORD_31(), _configVersion: 1 }, CONFIG, [step]);
    expect(result.applied).toEqual([2]);
    expect(result.record['main'].phones[2][ROW_ID_KEY]).toBe(`${LEGACY_ROW_ID_PREFIX}3`);
  });

  it('takes explicit versions', () => {
    expect(rowIdMigration(CONFIG, { from: 4, to: 7 })).toMatchObject({ from: 4, to: 7 });
  });
});

describe('validateConfig and the $ prefix', () => {
  it('refuses a field id starting with $', () => {
    const config = { entity: 'e', tabs: [{ id: 'main', label: { en: 'Main' }, fields: [text('$rowId')] }] } as EntityFormConfig;
    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'error', code: 'CONFIG_RESERVED_FIELD_ID', path: 'tabs[0].fields[0].id' })]),
    );
  });

  it('refuses it inside an array row too, where it would collide with the row id', () => {
    const config = { entity: 'e', tabs: [{ id: 'main', label: { en: 'Main' }, fields: [array('rows', [text('$anything')])] }] } as EntityFormConfig;
    expect(validateConfig(config).map(problem => problem.code)).toContain('CONFIG_RESERVED_FIELD_ID');
  });

  it('accepts an id with $ elsewhere in it as before', () => {
    const config = { entity: 'e', tabs: [{ id: 'main', label: { en: 'Main' }, fields: [text('price$')] }] } as EntityFormConfig;
    expect(validateConfig(config).map(problem => problem.code)).not.toContain('CONFIG_RESERVED_FIELD_ID');
  });
});

describe('import and $rowId', () => {
  const headers = ['name', 'phones 1 number', 'phones 2 number'];
  const columns = deriveImportColumns(CONFIG).columns;

  it('is never a column, a template header or a suggested mapping', () => {
    expect(columns.map(column => column.ref).join(' ')).not.toContain(ROW_ID_KEY);
    const spec = buildTemplateSpec(CONFIG);
    expect(JSON.stringify(spec)).not.toContain(ROW_ID_KEY);
    // Even a sheet with a "$rowId" header maps nothing to it: there is no column to map to.
    const plan = suggestMapping([...headers, ROW_ID_KEY, `phones 1 ${ROW_ID_KEY}`], columns, 'person');
    expect(plan.entries.map(entry => entry.ref)).toEqual(['main.name', 'main.phones.0.number', 'main.phones.1.number']);
  });

  it('leaves the engine output free of ids, so an import stays deterministic', () => {
    const plan = suggestMapping(headers, columns, 'person');
    const run = () => applyMapping([['Ada', '111', '222']], plan, CONFIG, { stamp: false }).records;
    expect(run()).toEqual(run());
    expect(JSON.stringify(run())).not.toContain(ROW_ID_KEY);
  });

  it('gives imported rows fresh ids through stampNewRowIds, keeping any they have', () => {
    const plan = suggestMapping(headers, columns, 'person');
    const [record] = applyMapping([['Ada', '111', '222']], plan, CONFIG, { stamp: false }).records;
    stampNewRowIds(record, CONFIG);
    const phones = (record['main'] as Record<string, Record<string, unknown>[]>)['phones'];
    expect(phones.map(row => row[ROW_ID_KEY])).toEqual([expect.stringMatching(UUID), expect.stringMatching(UUID)]);
    expect(phones[0][ROW_ID_KEY]).not.toBe(phones[1][ROW_ID_KEY]);

    const kept = { main: { phones: [{ [ROW_ID_KEY]: 'keep', number: '1' }] } };
    expect(stampNewRowIds(kept, CONFIG).main.phones[0][ROW_ID_KEY]).toBe('keep');
  });

  it('survives core import validation without a complaint', () => {
    const record = applyRowIds(RECORD_31(), CONFIG);
    expect(validateImportedRecord(record, CONFIG)).toEqual([]);
    expect(record['main'].phones[0][ROW_ID_KEY]).toBe('legacy-1');
  });

  it('counts a row that holds only its id as blank', () => {
    const rows = [{ [ROW_ID_KEY]: 'a', number: '' }, { [ROW_ID_KEY]: 'b', number: '2' }, { [ROW_ID_KEY]: 'c' }];
    expect(compactArrays({ phones: rows })).toEqual({ phones: [{ [ROW_ID_KEY]: 'b', number: '2' }] });
  });
});
