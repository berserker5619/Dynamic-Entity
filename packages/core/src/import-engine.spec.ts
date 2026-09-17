import { deriveImportColumns } from './import-columns';
import {
  applyMapping,
  coerceCell,
  compactArrays,
  setRecordValue,
  suggestMapping,
  validateImportedRecord,
} from './import-engine';
import type { EntityFormConfig, FormRule, NestedFieldConfig } from './form-model.types';
import type { MappingPlan } from './import-model.types';
import { valuesMatch } from './form-logic';

const STATUS_OPTIONS = [
  { en: 'Active', de: 'Aktiv' },
  { en: 'Inactive', de: 'Inaktiv' },
];

const CONFIG: EntityFormConfig = {
  entity: 'employees',
  version: 3,
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal' },
      fields: [
        { id: 'firstName', type: 'text', label: { en: 'First Name' }, validators: { required: true } },
        { id: 'email', type: 'email', label: { en: 'Email' }, validators: { email: true } },
        { id: 'status', type: 'dropdown', label: { en: 'Status' }, options: STATUS_OPTIONS },
        {
          id: 'terminationReason',
          type: 'text',
          label: { en: 'Termination Reason' },
          validators: { required: true },
        },
        { id: 'headcount', type: 'number', label: { en: 'Headcount' }, validators: { min: 1, max: 10 } },
      ],
    },
    {
      id: 'work',
      label: { en: 'Work' },
      fields: [
        {
          id: 'contacts',
          type: 'array',
          label: { en: 'Contacts' },
          children: [
            { id: 'name', type: 'text', label: { en: 'Name' } },
            { id: 'phone', type: 'text', label: { en: 'Phone' } },
          ],
        },
      ],
    },
  ],
};

/**
 * Hide `terminationReason` while the employee is Active.
 *
 * This is the case the whole parity claim rests on: the field is `required`, so an importer
 * that checked validators alone would reject every active employee.
 */
const RULES: FormRule[] = [
  {
    formConfigId: 'employees',
    fieldId: 'status',
    conditions: [{ operator: 'EQUAL', value: 'Active', compareType: 'value' }],
    action: { type: 'visibility', value: false },
    targets: [{ id: 'terminationReason', type: 'field' }],
    enabled: true,
    priority: 1,
  },
];

const columnsOf = (config = CONFIG): ReturnType<typeof deriveImportColumns>['columns'] =>
  deriveImportColumns(config, { maxArrayRows: 2 }).columns;

const field = (id: string): NestedFieldConfig => {
  const found = columnsOf().find(column => column.field.id === id)?.field;
  if (!found) throw new Error(`no field ${id} in the test config`);
  return found;
};

describe('setRecordValue', () => {
  it('creates an array for a numeric segment, where setValueByPath creates an object', () => {
    const record: Record<string, unknown> = {};
    setRecordValue(record, 'contacts.0.email', 'a@b.c');
    setRecordValue(record, 'contacts.1.email', 'd@e.f');

    expect(Array.isArray(record['contacts'])).toBe(true);
    expect(record).toEqual({ contacts: [{ email: 'a@b.c' }, { email: 'd@e.f' }] });
  });

  it('creates an object for a non-numeric segment', () => {
    const record: Record<string, unknown> = {};
    setRecordValue(record, 'work.address.city', 'Berlin');
    expect(record).toEqual({ work: { address: { city: 'Berlin' } } });
  });

  it('refuses a path that would reach the prototype', () => {
    const record: Record<string, unknown> = {};
    setRecordValue(record, '__proto__.polluted', true);
    expect(record).toEqual({});
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('compactArrays', () => {
  it('removes the holes a sparse write leaves', () => {
    const record: Record<string, unknown> = {};
    setRecordValue(record, 'contacts.1.name', 'Bob');
    expect(compactArrays(record)).toEqual({ contacts: [{ name: 'Bob' }] });
  });

  it('drops a row whose every cell was blank', () => {
    expect(compactArrays({ rows: [{ a: '' }, { a: 'x' }] })).toEqual({ rows: [{ a: 'x' }] });
  });

  it('returns the result and leaves the argument alone, whatever it was given', () => {
    // It used to mutate an object in place while returning a new array, so whether a caller
    // could ignore the return value depended on what they passed in.
    const object = { rows: [{ a: '' }, { a: 'x' }] };
    const array = [1, null, 2];

    expect(compactArrays(object)).toEqual({ rows: [{ a: 'x' }] });
    expect(object).toEqual({ rows: [{ a: '' }, { a: 'x' }] });

    expect(compactArrays(array)).toEqual([1, 2]);
    expect(array).toEqual([1, null, 2]);
  });

  it('keeps a value that merely has no enumerable keys', () => {
    // A Date has none, so judging emptiness by its keys deleted it outright.
    const when = new Date('2024-01-01T00:00:00.000Z');
    expect(compactArrays([when])).toEqual([when]);
  });
});

describe('coerceCell', () => {
  it('treats a blank cell as no value rather than as an empty one', () => {
    // `''` would be a value that exists, which would defeat `required`.
    expect(coerceCell(field('firstName'), '')).toEqual({ value: undefined });
    expect(coerceCell(field('firstName'), '   ')).toEqual({ value: undefined });
    expect(coerceCell(field('firstName'), null)).toEqual({ value: undefined });
  });

  it('parses a number, including the thousands separator a spreadsheet shows', () => {
    expect(coerceCell(field('headcount'), '1,234')).toEqual({ value: 1234 });
    expect(coerceCell(field('headcount'), '1,234,567.5')).toEqual({ value: 1234567.5 });
    expect(coerceCell(field('headcount'), '-42')).toEqual({ value: -42 });
    expect(coerceCell(field('headcount'), '1.5e3')).toEqual({ value: 1500 });
    expect(coerceCell(field('headcount'), 'seven')).toEqual({ error: '"seven" is not a number' });
  });

  it('rejects text that Number() would happily turn into a plausible wrong answer', () => {
    // `Number` is far looser than any spreadsheet: it reads 0x10 as 16, and stripping commas
    // before parsing turned the plainly broken 1,2,3 into 123.
    for (const text of ['1,2,3', '0x10', '1,23', 'Infinity', '12 34', '1..2']) {
      expect(coerceCell(field('headcount'), text)).toEqual({
        error: `"${text}" is not a number`,
      });
    }
  });

  it('stores a dropdown cell as the option object, not the text that was typed', () => {
    // The whole point: the record holds the LocalizedText, so rules and option comparisons
    // still match it. Storing 'Active' would render correctly and compare wrong.
    expect(coerceCell(field('status'), 'Active')).toEqual({ value: STATUS_OPTIONS[0] });
  });

  it('matches an option in a language nobody passed in', () => {
    // `valuesMatch` compares across every language the option carries, so a German sheet
    // resolves without the caller naming a language.
    expect(coerceCell(field('status'), 'Aktiv')).toEqual({ value: STATUS_OPTIONS[0] });
  });

  it('names the allowed values when a cell matches no option', () => {
    expect(coerceCell(field('status'), 'Retired')).toEqual({
      error: '"Retired" is not one of: Active, Inactive',
    });
  });

  it('reads booleans the several ways a person writes them', () => {
    const flag: NestedFieldConfig = { id: 'f', type: 'boolean', label: { en: 'F' } };
    for (const text of ['true', 'TRUE', 'yes', 'y', '1']) {
      expect(coerceCell(flag, text)).toEqual({ value: true });
    }
    for (const text of ['false', 'no', 'n', '0']) {
      expect(coerceCell(flag, text)).toEqual({ value: false });
    }
    expect(coerceCell(flag, 'maybe')).toEqual({ error: '"maybe" is not true or false' });
  });

  it('normalises a time and rejects an impossible one', () => {
    const time: NestedFieldConfig = { id: 't', type: 'time', label: { en: 'T' } };
    expect(coerceCell(time, '9:05')).toEqual({ value: '09:05' });
    expect(coerceCell(time, '25:00')).toEqual({ error: '"25:00" is not a time (HH:mm)' });
  });

  it('splits a multiSelect on semicolons and resolves each option', () => {
    const multi: NestedFieldConfig = {
      id: 'm',
      type: 'multiSelect',
      label: { en: 'M' },
      options: STATUS_OPTIONS,
    };
    expect(coerceCell(multi, 'Active; Inactive')).toEqual({
      value: [STATUS_OPTIONS[0], STATUS_OPTIONS[1]],
    });
  });

  it('passes a value through when the field has no option list to match', () => {
    const ref: NestedFieldConfig = { id: 'r', type: 'entity-ref', label: { en: 'R' } };
    expect(coerceCell(ref, 'client-42')).toEqual({ value: 'client-42' });
  });

  it('resolves a listName field against caller-supplied lookups', () => {
    const listed: NestedFieldConfig = {
      id: 'l',
      type: 'dropdown',
      label: { en: 'L' },
      listName: 'grades',
    };
    const lookups = { grades: [{ en: 'Junior' }, { en: 'Senior' }] };
    expect(coerceCell(listed, 'Senior', { lookups })).toEqual({ value: { en: 'Senior' } });
  });

  it('passes a listName field through when the caller loaded no such list', () => {
    const listed: NestedFieldConfig = {
      id: 'l',
      type: 'dropdown',
      label: { en: 'L' },
      listName: 'grades',
    };
    expect(coerceCell(listed, 'Senior')).toEqual({ value: 'Senior' });
  });

  it('stores a date as YYYY-MM-DD and rejects text that is not one', () => {
    const date: NestedFieldConfig = { id: 'd', type: 'date', label: { en: 'D' } };
    expect(coerceCell(date, '2024-03-07')).toEqual({ value: '2024-03-07' });
    expect(coerceCell(date, '2024-3-7')).toEqual({ value: '2024-03-07' });
    expect(coerceCell(date, 'last Tuesday')).toEqual({ error: '"last Tuesday" is not a date' });
  });

  it('rejects a well-formed date that does not exist', () => {
    // `new Date` rolls 2024-02-30 forward to March and reports no problem.
    const date: NestedFieldConfig = { id: 'd', type: 'date', label: { en: 'D' } };
    expect(coerceCell(date, '2024-02-30')).toEqual({ error: '"2024-02-30" is not a date' });
    expect(coerceCell(date, '2024-02-29')).toEqual({ value: '2024-02-29' }); // a real leap day
  });

  it('stores a datetime as an ISO instant and rejects text that is not one', () => {
    const when: NestedFieldConfig = { id: 'dt', type: 'datetime', label: { en: 'DT' } };
    expect(coerceCell(when, '2024-03-07T09:30:00.000Z')).toEqual({
      value: '2024-03-07T09:30:00.000Z',
    });
    expect(coerceCell(when, 'soon')).toEqual({ error: '"soon" is not a date and time' });
  });

  it('reads a month and year, padded, from either spelling', () => {
    const month: NestedFieldConfig = { id: 'my', type: 'monthYear', label: { en: 'MY' } };
    expect(coerceCell(month, '2024-3')).toEqual({ value: '2024-03' });
    expect(coerceCell(month, '2024-03-07')).toEqual({ value: '2024-03' });
    expect(coerceCell(month, '2024-13')).toEqual({ error: '"2024-13" is not a month' });
    expect(coerceCell(month, 'sometime')).toEqual({ error: '"sometime" is not a month and year' });
  });

  it('returns no value for a field object that is not one', () => {
    expect(coerceCell(null as unknown as NestedFieldConfig, 'x')).toEqual({ value: undefined });
  });
});

describe('validateImportedRecord — the remaining declared validators', () => {
  const single = (validators: NestedFieldConfig['validators'], value: unknown): string[] => {
    const config: EntityFormConfig = {
      entity: 'x',
      tabs: [
        {
          id: 'tab',
          label: { en: 'Tab' },
          fields: [{ id: 'f', type: 'text', label: { en: 'F' }, validators }],
        },
      ],
    };
    return validateImportedRecord({ tab: { f: value } }, config).map(p => p.message);
  };

  it('applies min to a number below the floor', () => {
    const config: EntityFormConfig = {
      entity: 'x',
      tabs: [
        {
          id: 'tab',
          label: { en: 'Tab' },
          fields: [{ id: 'n', type: 'number', label: { en: 'N' }, validators: { min: 5 } }],
        },
      ],
    };
    const problems = validateImportedRecord({ tab: { n: 2 } }, config);
    expect(problems[0].message).toContain('at least 5');
  });

  it('applies minLength and maxLength', () => {
    expect(single({ minLength: 3 }, 'ab')[0]).toContain('at least 3 characters');
    expect(single({ maxLength: 2 }, 'abc')[0]).toContain('at most 2 characters');
  });

  it('applies a pattern', () => {
    expect(single({ pattern: '^[A-Z]+$' }, 'abc')[0]).toContain('required format');
    expect(single({ pattern: '^[A-Z]+$' }, 'ABC')).toEqual([]);
  });

  it('ignores an unparseable pattern rather than throwing mid-import', () => {
    // An invalid regex is a config defect for `validateConfig` to report. Throwing here would
    // fail the whole file over one badly authored field.
    expect(() => single({ pattern: '([' }, 'abc')).not.toThrow();
    expect(single({ pattern: '([' }, 'abc')).toEqual([]);
  });

  it('checks nothing else once a required field is absent', () => {
    // "is required" and "must be at least 3 characters" describe the same emptiness twice.
    expect(single({ required: true, minLength: 3 }, undefined)).toEqual(['F is required']);
  });

  it('reports an error a validation rule raised', () => {
    const config: EntityFormConfig = {
      entity: 'x',
      tabs: [
        {
          id: 'tab',
          label: { en: 'Tab' },
          fields: [
            { id: 'a', type: 'text', label: { en: 'A' } },
            { id: 'b', type: 'text', label: { en: 'B' } },
          ],
        },
      ],
    };
    const rules: FormRule[] = [
      {
        formConfigId: 'x',
        fieldId: 'a',
        conditions: [{ operator: 'EQUAL', value: 'trigger', compareType: 'value' }],
        action: { type: 'validation', value: 'B is not allowed here', severity: 'error' },
        targets: [{ id: 'b', type: 'field' }],
        enabled: true,
        priority: 1,
      },
    ];
    const problems = validateImportedRecord({ tab: { a: 'trigger', b: 'x' } }, config, { rules });
    expect(problems).toContainEqual(
      expect.objectContaining({ ref: 'tab.b', message: 'B is not allowed here' }),
    );
  });

  it('does not require anything on a tab a rule has hidden', () => {
    const config: EntityFormConfig = {
      entity: 'x',
      tabs: [
        {
          id: 'tab',
          label: { en: 'Tab' },
          fields: [
            { id: 'a', type: 'text', label: { en: 'A' } },
            { id: 'b', type: 'text', label: { en: 'B' }, validators: { required: true } },
          ],
        },
      ],
    };
    const rules: FormRule[] = [
      {
        formConfigId: 'x',
        fieldId: 'a',
        conditions: [{ operator: 'EQUAL', value: 'hide', compareType: 'value' }],
        action: { type: 'visibility', value: false },
        targets: [{ id: 'tab', type: 'tab' }],
        enabled: true,
        priority: 1,
      },
    ];
    expect(validateImportedRecord({ tab: { a: 'hide' } }, config, { rules })).toEqual([]);
  });

  it('honours a static showWhen against the field s own scope', () => {
    const config: EntityFormConfig = {
      entity: 'x',
      tabs: [
        {
          id: 'tab',
          label: { en: 'Tab' },
          fields: [
            { id: 'isEmployee', type: 'boolean', label: { en: 'Employee' } },
            {
              id: 'payrollNumber',
              type: 'text',
              label: { en: 'Payroll Number' },
              validators: { required: true },
              showWhen: { isEmployee: true },
            },
          ],
        },
      ],
    };
    expect(validateImportedRecord({ tab: { isEmployee: false } }, config)).toEqual([]);
    expect(validateImportedRecord({ tab: { isEmployee: true } }, config)).toHaveLength(1);
  });

  it('returns nothing for a missing record or config rather than throwing', () => {
    expect(validateImportedRecord(null as never, CONFIG)).toEqual([]);
    expect(validateImportedRecord({}, null as never)).toEqual([]);
  });
});

describe('suggestMapping', () => {
  it('matches a header that is a ref exactly', () => {
    const plan = suggestMapping(['personal.firstName'], columnsOf());
    expect(plan.entries).toContainEqual(
      expect.objectContaining({ ref: 'personal.firstName', column: 0, confidence: 'exact' }),
    );
  });

  it('collapses spacing and case to match a label, and marks it a guess', () => {
    const plan = suggestMapping(['first_name'], columnsOf());
    expect(plan.entries).toContainEqual(
      expect.objectContaining({ ref: 'personal.firstName', column: 0, confidence: 'guess' }),
    );
  });

  it('gives one header to one field, so a duplicated header is left for the user', () => {
    const plan = suggestMapping(['First Name', 'First Name'], columnsOf());
    const forFirstName = plan.entries.filter(entry => entry.ref === 'personal.firstName');
    expect(forFirstName).toHaveLength(1);
    expect(plan.entries.filter(entry => entry.column === 1)).toHaveLength(0);
  });

  it('records the headers it was given, so a re-run can notice the sheet changed', () => {
    expect(suggestMapping(['a', 'b'], columnsOf()).sourceHeaders).toEqual(['a', 'b']);
  });

  it('refuses to guess when two fields answer to the same label', () => {
    // "Address" on Personal Details and "Address" on Work Details are two fields with one
    // label — the reason a field's identity is its path. Picking one by walk order resolves
    // the ambiguity invisibly and shows the user a mapping that looks considered.
    const twins: EntityFormConfig = {
      entity: 'x',
      tabs: [
        {
          id: 'personal',
          label: { en: 'Personal' },
          fields: [{ id: 'address', type: 'text', label: { en: 'Address' } }],
        },
        {
          id: 'work',
          label: { en: 'Work' },
          fields: [{ id: 'address', type: 'text', label: { en: 'Address' } }],
        },
      ],
    };
    const columns = deriveImportColumns(twins).columns;

    expect(suggestMapping(['Address'], columns).entries).toEqual([]);

    // The qualified heading a generated template carries is still unambiguous, and still matches.
    const exact = suggestMapping(['Work / Address'], columns).entries;
    expect(exact).toEqual([
      expect.objectContaining({ ref: 'work.address', column: 0, confidence: 'exact' }),
    ]);
  });
});

describe('validateImportedRecord — parity with what the form enforces', () => {
  const base = { personal: { firstName: 'Alice' } };

  it('fails a required field that is missing', () => {
    const problems = validateImportedRecord({ personal: {} }, CONFIG);
    expect(problems.map(p => p.ref)).toContain('personal.firstName');
  });

  it('does NOT require a field a visibility rule has hidden', () => {
    // The case that breaks a validators-only importer: `terminationReason` is required, and
    // hidden for every active employee. Without the rules engine, no active employee imports.
    const record = { personal: { ...base.personal, status: STATUS_OPTIONS[0] } };
    const problems = validateImportedRecord(record, CONFIG, { rules: RULES });
    expect(problems.map(p => p.ref)).not.toContain('personal.terminationReason');
  });

  it('still requires that field when the rule does not fire', () => {
    const record = { personal: { ...base.personal, status: STATUS_OPTIONS[1] } };
    const problems = validateImportedRecord(record, CONFIG, { rules: RULES });
    expect(problems.map(p => p.ref)).toContain('personal.terminationReason');
  });

  it('applies min and max to a number', () => {
    const record = { personal: { ...base.personal, terminationReason: 'n/a', headcount: 99 } };
    const problems = validateImportedRecord(record, CONFIG);
    expect(problems.find(p => p.ref === 'personal.headcount')?.message).toContain('at most 10');
  });

  it('applies the email check', () => {
    const record = { personal: { ...base.personal, terminationReason: 'n/a', email: 'not-an-email' } };
    const problems = validateImportedRecord(record, CONFIG);
    expect(problems.find(p => p.ref === 'personal.email')?.message).toContain('valid email');
  });

  it('does not require a child of a repeating row nobody added', () => {
    const required: EntityFormConfig = JSON.parse(JSON.stringify(CONFIG));
    required.tabs[1].fields![0].children![0].validators = { required: true };
    const problems = validateImportedRecord(
      { personal: { ...base.personal, terminationReason: 'n/a' }, work: { contacts: [] } },
      required,
    );
    expect(problems.map(p => p.ref)).not.toContain('work.contacts.0.name');
  });

  it('validates each row of a repeating field that does exist', () => {
    const required: EntityFormConfig = JSON.parse(JSON.stringify(CONFIG));
    required.tabs[1].fields![0].children![0].validators = { required: true };
    const problems = validateImportedRecord(
      {
        personal: { ...base.personal, terminationReason: 'n/a' },
        work: { contacts: [{ name: 'Bob' }, { phone: '123' }] },
      },
      required,
    );
    expect(problems.map(p => p.ref)).toEqual(['work.contacts.1.name']);
  });
});

describe('applyMapping', () => {
  const plan = (entries: MappingPlan['entries']): MappingPlan => ({
    entity: 'employees',
    configVersion: 3,
    entries,
  });

  it('builds a nested record from flat cells', () => {
    const result = applyMapping(
      [['Alice', 'Inactive', 'left']],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.status', column: 1 },
        { ref: 'personal.terminationReason', column: 2 },
      ]),
      CONFIG,
    );

    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      personal: { firstName: 'Alice', status: STATUS_OPTIONS[1], terminationReason: 'left' },
    });
  });

  it('builds a real array from indexed columns', () => {
    const result = applyMapping(
      [['Alice', 'left', 'Bob', 'Carol']],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.terminationReason', column: 1 },
        { ref: 'work.contacts.0.name', column: 2 },
        { ref: 'work.contacts.1.name', column: 3 },
      ]),
      CONFIG,
      { maxArrayRows: 2 },
    );

    expect(result.errors).toEqual([]);
    const contacts = (result.records[0] as any).work.contacts;
    expect(Array.isArray(contacts)).toBe(true);
    expect(contacts).toEqual([{ name: 'Bob' }, { name: 'Carol' }]);
  });

  it('stamps the config version, so an imported record is not mistaken for a pre-versioning one', () => {
    const result = applyMapping(
      [['Alice', 'left']],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.terminationReason', column: 1 },
      ]),
      CONFIG,
    );
    expect(result.records[0]['_configVersion']).toBe(3);
  });

  it('collects every bad row instead of stopping at the first', () => {
    const result = applyMapping(
      [
        ['Alice', 'left'],
        ['', 'left'],
        ['Carol', ''],
      ],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.terminationReason', column: 1 },
      ]),
      CONFIG,
    );

    expect(result.records).toHaveLength(1);
    expect(result.errors.map(e => e.row).sort()).toEqual([3, 4]);
  });

  it('numbers rows the way the spreadsheet does, counting the header as row 1', () => {
    const result = applyMapping(
      [['', '']],
      plan([{ ref: 'personal.firstName', column: 0 }]),
      CONFIG,
    );
    // An entirely blank row is skipped, not reported.
    expect(result).toMatchObject({ records: [], errors: [], skipped: 1 });
  });

  it('reports a coercion failure against the column it came from', () => {
    const result = applyMapping(
      [['Alice', 'left', 'Retired']],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.terminationReason', column: 1 },
        { ref: 'personal.status', column: 2 },
      ]),
      CONFIG,
    );
    expect(result.errors[0]).toMatchObject({ row: 2, ref: 'personal.status', column: 2 });
  });

  it('applies a constant to every row without making a blank row look filled', () => {
    const result = applyMapping(
      [['Alice', 'left'], ['', '']],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.terminationReason', column: 1 },
        { ref: 'personal.status', constant: STATUS_OPTIONS[1] },
      ]),
      CONFIG,
    );
    expect(result.skipped).toBe(1);
    expect((result.records[0] as any).personal.status).toEqual(STATUS_OPTIONS[1]);
  });

  it('accepts an active employee without a termination reason when the rule hides it', () => {
    const result = applyMapping(
      [['Alice', 'Active']],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.status', column: 1 },
      ]),
      CONFIG,
      { rules: RULES },
    );
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(1);
  });

  it('imports every row a plan names, whatever row numbers it reaches for', () => {
    // A plan authored when the UI offered five array rows. The bound now comes from the plan
    // itself, so there is no `maxArrayRows` for a caller to get wrong — two of these columns
    // used to be dropped in silence, and the import reported success.
    const result = applyMapping(
      [['Alice', 'left', 'Bob', 'Carol', 'Dave']],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.terminationReason', column: 1 },
        { ref: 'work.contacts.0.name', column: 2 },
        { ref: 'work.contacts.3.name', column: 3 },
        { ref: 'work.contacts.4.name', column: 4 },
      ]),
      CONFIG,
    );

    expect(result.planProblems).toEqual([]);
    expect(result.errors).toEqual([]);
    expect((result.records[0] as any).work.contacts).toEqual([
      { name: 'Bob' },
      { name: 'Carol' },
      { name: 'Dave' },
    ]);
  });

  it('imports nothing when the plan names a field the config does not have', () => {
    // Refusing beats importing whichever columns happened to resolve: a plan that is wrong
    // about one field is wrong about every row, and a partial import looks like a clean one.
    const result = applyMapping(
      [['Alice', 'left']],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.goneAway', column: 1 },
      ]),
      CONFIG,
    );

    expect(result.records).toEqual([]);
    expect(result.planProblems).toContainEqual(
      expect.objectContaining({ level: 'error', path: 'entries[1].ref' }),
    );
  });

  it('reports a plan written for another entity instead of importing it quietly', () => {
    const result = applyMapping(
      [['Alice', 'left']],
      {
        entity: 'clients',
        entries: [
          { ref: 'personal.firstName', column: 0 },
          { ref: 'personal.terminationReason', column: 1 },
        ],
      },
      CONFIG,
    );

    // A warning, not an error: the refs all resolve, so the import runs — but it says so.
    expect(result.planProblems).toContainEqual(
      expect.objectContaining({ level: 'warning', path: 'entity' }),
    );
    expect(result.records).toHaveLength(1);
  });

  it('produces a dropdown value that still matches its config option', () => {
    const result = applyMapping(
      [['Alice', 'left', 'Aktiv']],
      plan([
        { ref: 'personal.firstName', column: 0 },
        { ref: 'personal.terminationReason', column: 1 },
        { ref: 'personal.status', column: 2 },
      ]),
      CONFIG,
    );
    const stored = (result.records[0] as any).personal.status;
    expect(valuesMatch(stored, STATUS_OPTIONS[0])).toBe(true);
  });
});
