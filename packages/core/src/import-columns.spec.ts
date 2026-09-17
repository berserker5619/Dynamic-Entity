import { parseCsv, toCsv } from './csv';
import {
  buildTemplateSpec,
  collectLeafTargets,
  deriveImportColumns,
  formatArrayHeader,
  parseArrayHeader,
  stripIndices,
  validateMappingPlan,
} from './import-columns';
import { applyMapping, suggestMapping } from './import-engine';
import { formatConfigProblems } from './validate-config';
import type { EntityFormConfig } from './form-model.types';
import type { MappingPlan } from './import-model.types';

const CONFIG: EntityFormConfig = {
  entity: 'employees',
  version: 2,
  name: { en: 'Employee' },
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal Details' },
      fields: [
        { id: 'firstName', type: 'text', label: { en: 'First Name' }, validators: { required: true } },
        { id: 'startDate', type: 'date', label: { en: 'Start Date' } },
        {
          id: 'grade',
          type: 'dropdown',
          label: { en: 'Grade' },
          options: [{ en: 'Junior' }, { en: 'Senior' }],
          hint: { en: 'As per the pay scale' },
        },
        { id: 'photo', type: 'image', label: { en: 'Photo' } },
        { id: 'recordId', type: 'text', label: { en: 'Record Id' }, systemDefault: true },
        { id: 'computed', type: 'text', label: { en: 'Computed' }, readonly: true },
        { id: 'legacy', type: 'text', label: { en: 'Legacy' }, visibility: false },
      ],
    },
    {
      id: 'work',
      label: { en: 'Work' },
      fields: [
        {
          id: 'address',
          type: 'group',
          label: { en: 'Address' },
          children: [{ id: 'city', type: 'text', label: { en: 'City' } }],
        },
        {
          id: 'contacts',
          type: 'array',
          label: { en: 'Contacts' },
          children: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
        },
      ],
    },
    {
      id: 'payroll',
      label: { en: 'Payroll' },
      flatData: true,
      fields: [{ id: 'salary', type: 'number', label: { en: 'Salary' } }],
    },
  ],
};

const refsOf = (config = CONFIG, options = {}): string[] =>
  deriveImportColumns(config, { maxArrayRows: 2, ...options }).columns.map(column => column.ref);

describe('collectLeafTargets', () => {
  it('drops containers, which hold fields rather than values', () => {
    const ids = collectLeafTargets(CONFIG).map(target => target.field.id);
    expect(ids).not.toContain('address');
    expect(ids).not.toContain('contacts');
    expect(ids).toContain('city');
  });

  it('tags a field inside an array with its repeating ancestor', () => {
    const target = collectLeafTargets(CONFIG).find(t => t.field.id === 'name');
    expect(target).toMatchObject({ arrayRef: 'work.contacts', tail: 'name', nested: false });
  });

  it('leaves arrayRef null for a field that does not repeat', () => {
    const target = collectLeafTargets(CONFIG).find(t => t.field.id === 'city');
    expect(target).toMatchObject({ ref: 'work.address.city', arrayRef: null });
  });
});

describe('deriveImportColumns', () => {
  it('addresses each column by the same dot-path the renderer binds to', () => {
    const refs = refsOf();
    expect(refs).toContain('personal.firstName');
    expect(refs).toContain('work.address.city');
  });

  it('puts a flatData tab at the record root, as the record shape does', () => {
    expect(refsOf()).toContain('salary');
    expect(refsOf()).not.toContain('payroll.salary');
  });

  it('unrolls a repeating field into one numbered column per row', () => {
    const refs = refsOf();
    expect(refs).toContain('work.contacts.0.name');
    expect(refs).toContain('work.contacts.1.name');
    expect(refs).not.toContain('work.contacts.2.name');
  });

  it('reports a file field as unsupported rather than dropping it silently', () => {
    const { unsupported } = deriveImportColumns(CONFIG);
    expect(unsupported.map(u => u.ref)).toContain('personal.photo');
    expect(unsupported[0].reason).toMatch(/cannot carry/);
  });

  it('reports a doubly-repeating field as unsupported', () => {
    const nested: EntityFormConfig = JSON.parse(JSON.stringify(CONFIG));
    nested.tabs[1].fields![1].children!.push({
      id: 'numbers',
      type: 'array',
      label: { en: 'Numbers' },
      children: [{ id: 'value', type: 'text', label: { en: 'Value' } }],
    });
    const { unsupported } = deriveImportColumns(nested);
    expect(unsupported.map(u => u.ref)).toContain('work.contacts.numbers.value');
  });

  it('leaves out hidden, readonly and system fields by default', () => {
    const refs = refsOf();
    expect(refs).not.toContain('personal.legacy');
    expect(refs).not.toContain('personal.computed');
    expect(refs).not.toContain('personal.recordId');
  });

  it('includes readonly and system fields when asked', () => {
    const refs = refsOf(CONFIG, { includeReadonly: true, includeSystemDefault: true });
    expect(refs).toContain('personal.computed');
    expect(refs).toContain('personal.recordId');
  });

  it('qualifies a heading with its scope, because bare labels collide across tabs', () => {
    const column = deriveImportColumns(CONFIG).columns.find(c => c.ref === 'work.address.city');
    expect(column?.header).toBe('Work / Address / City');
  });

  it('numbers the heading of each repeating row from 1, as a person counts', () => {
    const headers = deriveImportColumns(CONFIG, { maxArrayRows: 2 })
      .columns.filter(c => c.arrayIndex !== undefined)
      .map(c => c.header);
    expect(headers).toEqual(['Work / Contacts / Name 1', 'Work / Contacts / Name 2']);
  });

  it('carries the option text and the format hint a template needs', () => {
    const columns = deriveImportColumns(CONFIG).columns;
    expect(columns.find(c => c.ref === 'personal.grade')?.enumValues).toEqual(['Junior', 'Senior']);
    expect(columns.find(c => c.ref === 'personal.startDate')?.format).toBe('YYYY-MM-DD');
  });

  it('survives a null config rather than throwing on data it exists to describe', () => {
    expect(deriveImportColumns(null)).toEqual({ columns: [], unsupported: [] });
  });

  it('gives every type that needs one a format hint', () => {
    const typed: EntityFormConfig = {
      entity: 'x',
      tabs: [
        {
          id: 'tab',
          label: { en: 'Tab' },
          fields: [
            { id: 'a', type: 'datetime', label: { en: 'A' } },
            { id: 'b', type: 'time', label: { en: 'B' } },
            { id: 'c', type: 'monthYear', label: { en: 'C' } },
            { id: 'd', type: 'boolean', label: { en: 'D' } },
            { id: 'e', type: 'currency', label: { en: 'E' } },
            { id: 'f', type: 'multiSelect', label: { en: 'F' }, options: [{ en: 'One' }] },
            { id: 'g', type: 'textarea', label: { en: 'G' } },
          ],
        },
      ],
    };
    const formats = Object.fromEntries(
      deriveImportColumns(typed).columns.map(column => [column.field.id, column.format]),
    );
    expect(formats).toEqual({
      a: 'YYYY-MM-DD HH:mm',
      b: 'HH:mm',
      c: 'YYYY-MM',
      d: 'true / false',
      e: 'a number',
      f: 'values separated by ;',
      g: undefined,
    });
  });

  it('offers no enum values for an options field with an empty list', () => {
    const empty: EntityFormConfig = {
      entity: 'x',
      tabs: [
        {
          id: 'tab',
          label: { en: 'Tab' },
          fields: [{ id: 'a', type: 'dropdown', label: { en: 'A' }, options: [] }],
        },
      ],
    };
    expect(deriveImportColumns(empty).columns[0].enumValues).toBeUndefined();
  });
});

describe('array header syntax', () => {
  it('is dotted, so it does not collide with a rule ref token', () => {
    expect(formatArrayHeader('work.contacts', 2)).toBe('work.contacts.2');
  });

  it('reads the indices back out', () => {
    expect(parseArrayHeader('work.contacts.2.name').indices).toEqual([2]);
    expect(parseArrayHeader('personal.firstName').indices).toEqual([]);
  });

  it('strips indices so a selection can name a repeating field once', () => {
    expect(stripIndices('work.contacts.2.name')).toBe('work.contacts.name');
  });
});

describe('buildTemplateSpec', () => {
  it('writes a guidance note naming what is required, the format, and the options', () => {
    const spec = buildTemplateSpec(CONFIG);
    const at = (ref: string): string => spec.notes[spec.columns.findIndex(c => c.ref === ref)];

    expect(at('personal.firstName')).toBe('Required');
    expect(at('personal.startDate')).toBe('YYYY-MM-DD');
    expect(at('personal.grade')).toBe('One of: Junior, Senior · As per the pay scale');
  });

  it('selects a subset by ref, naming a repeating field once', () => {
    const spec = buildTemplateSpec(CONFIG, {
      fields: ['personal.firstName', 'work.contacts.name'],
      maxArrayRows: 2,
    });
    expect(spec.columns.map(c => c.ref)).toEqual([
      'personal.firstName',
      'work.contacts.0.name',
      'work.contacts.1.name',
    ]);
  });

  it('ignores a selection naming a field that no longer exists', () => {
    const spec = buildTemplateSpec(CONFIG, { fields: ['personal.firstName', 'gone.away'] });
    expect(spec.columns.map(c => c.ref)).toEqual(['personal.firstName']);
  });
});

describe('validateMappingPlan', () => {
  const plan = (entries: MappingPlan['entries'], extra: Partial<MappingPlan> = {}): MappingPlan => ({
    entity: 'employees',
    entries,
    ...extra,
  });

  it('accepts a sound plan', () => {
    expect(validateMappingPlan(plan([{ ref: 'personal.firstName', column: 0 }]), CONFIG)).toEqual([]);
  });

  it('rejects a ref the config does not define', () => {
    const problems = validateMappingPlan(plan([{ ref: 'personal.nope', column: 0 }]), CONFIG);
    expect(problems).toContainEqual(
      expect.objectContaining({ level: 'error', path: 'entries[0].ref' }),
    );
  });

  it('rejects the same target mapped twice, which is a race rather than a merge', () => {
    const problems = validateMappingPlan(
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.firstName', column: 1 },
      ]),
      CONFIG,
    );
    expect(problems.some(p => p.message.includes('mapped more than once'))).toBe(true);
  });

  it('rejects an entry with both a column and a constant, or with neither', () => {
    expect(
      validateMappingPlan(plan([{ ref: 'personal.firstName', column: 0, constant: 'x' }]), CONFIG),
    ).toContainEqual(expect.objectContaining({ message: expect.stringContaining('not both') }));

    expect(validateMappingPlan(plan([{ ref: 'personal.firstName' }]), CONFIG)).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('needs either') }),
    );
  });

  it('rejects a column that is not a zero-based integer', () => {
    const problems = validateMappingPlan(plan([{ ref: 'personal.firstName', column: -1 }]), CONFIG);
    expect(problems).toContainEqual(
      expect.objectContaining({ path: 'entries[0].column', level: 'error' }),
    );
  });

  it('warns rather than fails when the config has moved on', () => {
    const problems = validateMappingPlan(
      plan([{ ref: 'personal.firstName', column: 0 }], { configVersion: 1 }),
      CONFIG,
    );
    expect(problems).toEqual([
      expect.objectContaining({ level: 'warning', path: 'configVersion' }),
    ]);
  });

  it('warns when the plan targets another entity', () => {
    const problems = validateMappingPlan(
      { entity: 'clients', entries: [{ ref: 'personal.firstName', column: 0 }] },
      CONFIG,
    );
    expect(problems).toEqual([expect.objectContaining({ level: 'warning', path: 'entity' })]);
  });

  it('reports a missing plan rather than throwing', () => {
    expect(validateMappingPlan(null, CONFIG)).toEqual([
      { level: 'error', path: '', message: 'Mapping plan is missing or not an object.' },
    ]);
  });

  it('reports entries that are not a list, which is what a hand-edited plan looks like', () => {
    const problems = validateMappingPlan({ entity: 'employees', entries: 'nope' } as never, CONFIG);
    expect(problems).toEqual([
      { level: 'error', path: 'entries', message: 'entries must be an array.' },
    ]);
  });

  it('reports an entry that is not an object, and one with no ref', () => {
    const problems = validateMappingPlan(plan([null as never, {} as never]), CONFIG);
    expect(problems).toEqual([
      expect.objectContaining({ path: 'entries[0]', message: 'Entry is not an object.' }),
      expect.objectContaining({ path: 'entries[1].ref' }),
    ]);
  });

  it('prints through the same formatter a config s problems print through', () => {
    const problems = validateMappingPlan(plan([{ ref: 'personal.nope', column: 0 }]), CONFIG);
    expect(formatConfigProblems(problems)).toContain('[error] entries[0].ref');
  });
});

describe('round trip: template out, records back in', () => {
  /**
   * The one test that proves the column contract is consistent in both directions.
   *
   * Generating a template and importing a filled copy of it exercises the same `ImportColumn`
   * list from both ends. If the two ever disagree about a ref — which is what would happen the
   * day array indexing changed on one side only — this is what fails.
   */
  it('produces a record equal to what the config describes', () => {
    const spec = buildTemplateSpec(CONFIG, { maxArrayRows: 2 });

    // The template as a user receives it, then filled in.
    const sheet = toCsv(
      spec.columns.map(column => column.header),
      [['Alice', '2024-03-07', 'Senior', 'Berlin', 'Bob', 'Carol', '50000']],
    );

    const parsed = parseCsv(sheet);
    const plan = suggestMapping(parsed.headers, spec.columns, CONFIG.entity);

    // Every column of a generated template must be recognised — nothing left for the user.
    expect(plan.entries).toHaveLength(spec.columns.length);
    expect(plan.entries.every(entry => entry.confidence === 'exact')).toBe(true);

    const result = applyMapping(parsed.rows, plan, CONFIG, { maxArrayRows: 2, stamp: false });

    expect(result.errors).toEqual([]);
    expect(result.records[0]).toEqual({
      personal: { firstName: 'Alice', startDate: '2024-03-07', grade: { en: 'Senior' } },
      work: { address: { city: 'Berlin' }, contacts: [{ name: 'Bob' }, { name: 'Carol' }] },
      salary: 50000,
    });
  });
});
