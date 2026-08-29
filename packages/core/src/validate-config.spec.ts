import type { EntityFormConfig, FormRule } from './form-model.types';
import { FIELD_TYPE_CATALOG } from './field-catalog';
import { formatConfigProblems, isConfigValid, validateConfig } from './validate-config';

const ok: EntityFormConfig = {
  entity: 'clients',
  version: 1,
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
    },
  ],
};

const errors = (c: unknown) =>
  validateConfig(c as EntityFormConfig).filter(p => p.level === 'error');
const warnings = (c: unknown) =>
  validateConfig(c as EntityFormConfig).filter(p => p.level === 'warning');

describe('validateConfig', () => {
  it('accepts a sound config', () => {
    expect(validateConfig(ok)).toEqual([]);
    expect(isConfigValid(ok)).toBe(true);
  });

  it('rejects a missing config rather than throwing', () => {
    expect(errors(null)).toHaveLength(1);
    expect(isConfigValid(undefined)).toBe(false);
  });

  it('requires an entity name and at least one tab', () => {
    const problems = errors({ entity: '  ', tabs: [] });
    expect(problems.map(p => p.path)).toEqual(expect.arrayContaining(['entity', 'tabs']));
  });

  /**
   * The defect that shipped in the reference dataset for months. The example used to be
   * `time`, which is a real type now — so this asserts against one that is not.
   */
  it('rejects a field type that is not in the catalog', () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs![0], fields: [{ id: 'x', type: 'signature', label: {} }] }] };
    const problems = errors(bad);

    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('Unknown field type "signature"');
    expect(problems[0].path).toBe('tabs[0].fields[0].type');
  });

  it('accepts a custom type when it is declared', () => {
    const custom = {
      ...ok,
      tabs: [{ ...ok.tabs![0], fields: [{ id: 'sig', type: 'signature', label: {} }] }],
    } as unknown as EntityFormConfig;

    expect(errors(custom)).toHaveLength(1);
    expect(validateConfig(custom, { additionalFieldTypes: ['signature'] })).toEqual([]);
  });

  /**
   * Ids are unique per scope, not globally. A record nests by tab, so `address` on Personal
   * Details and `address` on Work Details are two different keys and always were — the
   * runtime stored, rendered and submitted them separately while this validator refused the
   * config outright.
   */
  it('allows the same field id on two different tabs', () => {
    const dup: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
        { id: 'work', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
      ],
    };
    expect(errors(dup)).toEqual([]);
  });

  it('rejects the same field id twice on one tab', () => {
    const dup: EntityFormConfig = {
      ...ok,
      tabs: [
        {
          id: 'a',
          label: {},
          fields: [
            { id: 'notes', type: 'text', label: {} },
            { id: 'notes', type: 'text', label: {} },
          ],
        },
      ],
    };
    const problems = errors(dup);

    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('Duplicate field id "notes"');
    expect(problems[0].message).toContain('would share one control and one record key');
  });

  // A group stores its children under itself, so `a.name` and `a.addr.name` are distinct
  // keys — the same reason two tabs may each have an `address`.
  it('allows a field id inside a group to match one outside it', () => {
    const dup: EntityFormConfig = {
      ...ok,
      tabs: [
        {
          id: 'a',
          label: {},
          fields: [
            { id: 'name', type: 'text', label: {} },
            {
              id: 'addr',
              type: 'group',
              label: {},
              children: [{ id: 'name', type: 'text', label: {} }],
            },
          ],
        },
      ],
    };
    expect(errors(dup)).toEqual([]);
  });

  it('rejects a duplicate within one group', () => {
    const dup: EntityFormConfig = {
      ...ok,
      tabs: [
        {
          id: 'a',
          label: {},
          fields: [
            {
              id: 'addr',
              type: 'group',
              label: {},
              children: [
                { id: 'line1', type: 'text', label: {} },
                { id: 'line1', type: 'text', label: {} },
              ],
            },
          ],
        },
      ],
    };
    expect(errors(dup).some(p => p.message.includes('Duplicate field id "line1"'))).toBe(true);
  });

  // A `flatData` tab stores its fields at the parent's level, so it shares that scope
  // rather than opening one — and a collision there is a real collision.
  it('rejects a collision between a flatData tab and its parent level', () => {
    const dup: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'a', label: {}, flatData: true, fields: [{ id: 'notes', type: 'text', label: {} }] },
        { id: 'b', label: {}, flatData: true, fields: [{ id: 'notes', type: 'text', label: {} }] },
      ],
    };
    expect(errors(dup).some(p => p.message.includes('Duplicate field id "notes"'))).toBe(true);
  });

  /**
   * Duplicating an id is fine right up until something points at it. `showWhen` and cascade
   * parents carry a bare id and no scope, so an ambiguous name has no answer and the runtime
   * would resolve it by search order, silently.
   */
  it('rejects a showWhen that names an id defined in two scopes', () => {
    const dup: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
        {
          id: 'work',
          label: {},
          fields: [
            { id: 'address', type: 'text', label: {} },
            { id: 'note', type: 'text', label: {}, showWhen: { address: 'x' } },
          ],
        },
      ],
    };
    const problems = errors(dup);

    expect(problems.some(p => p.message.includes('Ambiguous reference to "address"'))).toBe(true);
    expect(problems.some(p => p.message.includes('personal and work'))).toBe(true);
  });

  it('rejects a cascade parent that names an id defined in two scopes', () => {
    const dup: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'country', type: 'dropdown', label: {} }] },
        {
          id: 'work',
          label: {},
          fields: [
            { id: 'country', type: 'dropdown', label: {} },
            {
              id: 'city',
              type: 'entity-ref',
              label: {},
              entityReference: { enabled: true, linkedEntityKey: 'cities', parentField: 'country' },
            },
          ],
        },
      ],
    };
    expect(errors(dup).some(p => p.message.includes('Ambiguous reference to "country"'))).toBe(true);
  });

  /**
   * The path is the form the builder authors and the docs recommend, so the validator has to
   * resolve it — it used to report the bracketed key as an unknown field.
   */
  it('accepts a showWhen keyed by a path, and names the one field it means', () => {
    const fine: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
        {
          id: 'work',
          label: {},
          fields: [
            { id: 'address', type: 'text', label: {} },
            { id: 'note', type: 'text', label: {}, showWhen: { '[work.address]': 'x' } },
          ],
        },
      ],
    };
    expect(errors(fine)).toEqual([]);
  });

  it('rejects a path that no field occupies', () => {
    const bad: EntityFormConfig = {
      ...ok,
      tabs: [
        {
          id: 'work',
          label: {},
          fields: [{ id: 'note', type: 'text', label: {}, showWhen: { '[work.nothing]': 'x' } }],
        },
      ],
    };
    expect(errors(bad).some(p => p.message.includes('No field at path "work.nothing"'))).toBe(true);
  });

  it('accepts a cascade parent named by path', () => {
    const fine: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'country', type: 'dropdown', label: {} }] },
        {
          id: 'work',
          label: {},
          fields: [
            { id: 'country', type: 'dropdown', label: {} },
            {
              id: 'city',
              type: 'entity-ref',
              label: {},
              entityReference: { enabled: true, linkedEntityKey: 'cities', parentField: '[work.country]' },
            },
          ],
        },
      ],
    };
    expect(errors(fine)).toEqual([]);
  });

  // The message should say what to do, not just that it is wrong.
  it('tells an ambiguous bare reference which path to use instead', () => {
    const dup: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
        {
          id: 'work',
          label: {},
          fields: [
            { id: 'address', type: 'text', label: {} },
            { id: 'note', type: 'text', label: {}, showWhen: { address: 'x' } },
          ],
        },
      ],
    };
    expect(errors(dup).some(p => p.message.includes('[personal.address]'))).toBe(true);
  });

  it('rejects a patchOnTrue mapping that names a missing field', () => {
    const bad: EntityFormConfig = {
      ...ok,
      tabs: [
        {
          id: 'a',
          label: {},
          fields: [
            {
              id: 'same',
              type: 'boolean',
              label: {},
              patchOnTrue: [{ from: 'name', to: 'missing' }],
            },
          ],
        },
      ],
    };
    expect(errors(bad).some(p => p.message.includes('Nothing will be copied to.'))).toBe(true);
  });

  it('still allows a showWhen naming an id that exists in only one scope', () => {
    const fine: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
        {
          id: 'work',
          label: {},
          fields: [
            { id: 'address', type: 'text', label: {} },
            { id: 'status', type: 'text', label: {} },
            { id: 'note', type: 'text', label: {}, showWhen: { status: 'x' } },
          ],
        },
      ],
    };
    expect(errors(fine)).toEqual([]);
  });

  it('rejects duplicate tab ids', () => {
    const dup: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'same', label: {}, fields: [{ id: 'a', type: 'text', label: {} }] },
        { id: 'same', label: {}, fields: [{ id: 'b', type: 'text', label: {} }] },
      ],
    };
    expect(errors(dup).some(p => p.message.includes('Duplicate tab id'))).toBe(true);
  });

  it('rejects a showWhen naming a field that does not exist', () => {
    const bad: EntityFormConfig = {
      ...ok,
      tabs: [
        {
          id: 'a',
          label: {},
          fields: [{ id: 'staffId', type: 'text', label: {}, showWhen: { isEmployee: true } }],
        },
      ],
    };
    const problems = errors(bad);
    expect(problems[0].message).toContain('never show');
  });

  it('rejects a cascade whose parentField does not exist', () => {
    const bad: EntityFormConfig = {
      ...ok,
      tabs: [
        {
          id: 'a',
          label: {},
          fields: [
            {
              id: 'city',
              type: 'entity-ref',
              label: {},
              entityReference: { enabled: true, linkedEntityKey: 'cities', parentField: 'country' },
            },
          ],
        },
      ],
    };
    expect(errors(bad)[0].message).toContain('never load');
  });

  it('rejects a colSpan outside the grid', () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs![0], fields: [{ id: 'x', type: 'text', label: {}, colSpan: 13 }] }] };
    expect(errors(bad)[0].path).toBe('tabs[0].fields[0].colSpan');
  });

  it('warns, without erroring, on usable-but-suspicious shapes', () => {
    const odd: EntityFormConfig = {
      entity: 'clients',
      tabs: [
        {
          id: 'a',
          label: {},
          fields: [
            { id: 'empty-group', type: 'group', label: {} },
            { id: 'both', type: 'dropdown', label: {}, options: [{ en: 'A' }], listName: 'statuses' },
            { id: 'has space', type: 'text', label: {} },
          ],
        },
      ],
    };

    expect(errors(odd)).toEqual([]);
    const messages = warnings(odd).map(p => p.message).join('\n');
    expect(messages).toContain('renders nothing');
    expect(messages).toContain('listName is dropped');
    expect(messages).toContain('plain identifier');
  });

  it('reports every problem, not just the first', () => {
    const bad = {
      entity: '',
      tabs: [{ id: 'a', label: {}, fields: [{ id: 'x', type: 'nope', label: {}, colSpan: 99 }] }],
    };
    expect(errors(bad).length).toBeGreaterThanOrEqual(3);
  });

  it('formats problems readably', () => {
    const text = formatConfigProblems(validateConfig({ entity: '', tabs: [] } as EntityFormConfig));
    expect(text).toContain('[error]');
    expect(text).toContain('entity');
  });

  it('accepts the people entity in the reference dataset', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const data = require('../../../test_data.json') as EntityFormConfig[];
    const people = data.find(c => c.entity === 'people');
    expect(people).toBeDefined();
    expect(errors(people)).toEqual([]);
  });

  const aRule = (over: Partial<FormRule> = {}): FormRule => ({
    formConfigId: 'clients',
    fieldId: 'name',
    conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'x' }],
    action: { type: 'visibility', value: false },
    targets: [{ id: 'name', type: 'field' }],
    enabled: true,
    priority: 1,
    ...over,
  });

  it('does not check rules unless they are passed', () => {
    expect(errors({ ...ok })).toEqual([]);
    expect(
      validateConfig(ok, { rules: [aRule({ fieldId: 'nope' })] }).some(p =>
        p.message.includes('never trigger'),
      ),
    ).toBe(true);
  });

  it('accepts a rule that names a field by path', () => {
    const two: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
        { id: 'work', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
      ],
    };
    expect(
      validateConfig(two, {
        rules: [aRule({ fieldId: '[work.address]', targets: [{ id: '[personal.address]', type: 'field' }] })],
      }).filter(p => p.level === 'error'),
    ).toEqual([]);
  });

  it('rejects a rule whose trigger is an id defined in two scopes', () => {
    const two: EntityFormConfig = {
      ...ok,
      tabs: [
        { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
        { id: 'work', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
      ],
    };
    const problems = validateConfig(two, { rules: [aRule({ fieldId: 'address' })] });
    expect(problems.some(p => p.path === 'rules[0].fieldId')).toBe(true);
    expect(problems.some(p => p.message.includes('[personal.address]'))).toBe(true);
  });

  it('rejects a rule that names an unknown tab', () => {
    const problems = validateConfig(ok, {
      rules: [aRule({ targets: [{ id: 'missing', type: 'tab' }] })],
    });
    expect(problems.some(p => p.message.includes('unknown tab "missing"'))).toBe(true);
  });

  it('rejects a compareToField that does not exist', () => {
    const problems = validateConfig(ok, {
      rules: [
        aRule({
          conditions: [{ operator: 'EQUAL', compareType: 'field', compareToField: 'nope' }],
        }),
      ],
    });
    expect(problems.some(p => p.message.includes('never match'))).toBe(true);
  });
});

/**
 * The published JSON Schema and the runtime catalog describe the same vocabulary, so they
 * must not drift. A type added to one and not the other is exactly the kind of silent
 * mismatch that put three non-existent types in the reference dataset.
 */
describe('entity-form-config.schema.json', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const schema = require('../entity-form-config.schema.json');

  it('lists exactly the field types the catalog defines', () => {
    const fromSchema = [...schema.$defs.fieldType.enum].sort();
    const fromCatalog = FIELD_TYPE_CATALOG.map(m => m.type as string).sort();

    expect(fromSchema).toEqual(fromCatalog);
  });

  it('requires the same top-level keys validateConfig does', () => {
    expect(schema.required).toEqual(['entity', 'tabs']);
  });

  it('constrains colSpan to the 12-column grid, as validateConfig does', () => {
    expect(schema.$defs.field.properties.colSpan).toMatchObject({ minimum: 1, maximum: 12 });
  });

  it('documents every validator key the model supports', () => {
    const keys = Object.keys(schema.$defs.validators.properties).sort();
    expect(keys).toEqual(
      ['custom', 'customAsync', 'email', 'max', 'maxLength', 'min', 'minLength', 'pattern', 'required'].sort(),
    );
  });
});
