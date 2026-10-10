/**
 * A container — `group` or `array` — whose `refererField` moves it.
 *
 * The renderer copies a tab-level container's whole value to its override and reads it back
 * from there, so its children move with it. Import has to write where the form reads, and a
 * child's own `refererField` is usually only the builder's stamp of its id-built position.
 */
import { assignFieldRefs, collectFieldRefs } from './field-scopes';
import { deriveImportColumns, validateMappingPlan } from './import-columns';
import { applyMapping } from './import-engine';
import { validateConfig } from './validate-config';
import type { EntityFormConfig, NestedFieldConfig } from './form-model.types';
import type { MappingPlan } from './import-model.types';

const phones = (extra: Partial<NestedFieldConfig> = {}): NestedFieldConfig => ({
  id: 'phones',
  type: 'array',
  label: { en: 'Phone' },
  refererField: 'contact.phones',
  children: [
    { id: 'number', type: 'text', label: { en: 'Number' } },
    { id: 'kind', type: 'text', label: { en: 'Kind' } },
  ],
  ...extra,
});

const configWith = (...fields: NestedFieldConfig[]): EntityFormConfig => ({
  entity: 'people',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      flatData: true,
      fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }, ...fields],
    },
  ],
});

const refsOf = (config: EntityFormConfig, maxArrayRows = 3): string[] =>
  deriveImportColumns(config, { maxArrayRows }).columns.map(column => column.ref);

const planFor = (refs: string[]): MappingPlan => ({
  entity: 'people',
  entries: refs.map((ref, column) => ({ ref, column })),
});

describe('a moved array', () => {
  it('unrolls its children under the override', () => {
    expect(refsOf(configWith(phones()))).toEqual([
      'name',
      'contact.phones.0.number',
      'contact.phones.1.number',
      'contact.phones.2.number',
      'contact.phones.0.kind',
      'contact.phones.1.kind',
      'contact.phones.2.kind',
    ]);
  });

  it('imports several slots as rows at the override', () => {
    const config = configWith(phones());
    const plan = planFor(['name', 'contact.phones.0.number', 'contact.phones.1.number']);
    const result = applyMapping([['Ada', '111', '222']], plan, config, { stamp: false });

    expect(result.errors).toEqual([]);
    expect(result.records[0]['contact']).toEqual({ phones: [{ number: '111' }, { number: '222' }] });
  });

  it('is still an array at the override when the row has no phones', () => {
    const config = configWith(phones());
    const result = applyMapping([['Ada']], planFor(['name']), config, { stamp: false });
    expect(result.records[0]['contact']).toEqual({ phones: [] });
  });

  it('reads children the builder stamped exactly as it reads unstamped ones', () => {
    const stamped = assignFieldRefs(configWith(phones()));
    expect(stamped.tabs[0].fields?.[1].children?.[0].refererField).toBe('phones.number');
    expect(refsOf(stamped)).toEqual(refsOf(configWith(phones())));
    expect(validateConfig(stamped).filter(problem => problem.path.includes('refererField'))).toEqual([]);
  });
});

const address: NestedFieldConfig = {
  id: 'addr',
  type: 'group',
  label: { en: 'Address' },
  refererField: 'customer.address',
  children: [{ id: 'city', type: 'text', label: { en: 'City' } }],
};

describe('a moved group', () => {
  it('takes its children with it, and keeps the heading its position gives it', () => {
    const column = deriveImportColumns(configWith(address)).columns.find(c => c.field.id === 'city');
    expect(column).toMatchObject({ ref: 'customer.address.city', header: 'Address / City' });
  });

  it('imports to the override, and to its position as the form saves it', () => {
    // `placeTabFields` (`form-logic.ts`) is how `extractRecord` saves a tab-level field: at its
    // position and at its `refererField`. Import finishes each record through it too.
    const result = applyMapping([['Paris']], planFor(['customer.address.city']), configWith(address), {
      stamp: false,
    });
    expect(result.records[0]).toEqual({ customer: { address: { city: 'Paris' } }, addr: { city: 'Paris' } });
  });
});

describe('an override the form does not honour', () => {
  it('leaves a container nested in a group where it is, and warns', () => {
    const config = configWith({
      id: 'wrap',
      type: 'group',
      label: { en: 'Wrap' },
      children: [phones()],
    });
    expect(refsOf(config, 1)).toEqual(['name', 'wrap.phones.0.number', 'wrap.phones.0.kind']);
    expect(validateConfig(config)).toContainEqual(
      expect.objectContaining({
        level: 'warning',
        code: 'CONFIG_REFERER_OVERRIDE_IGNORED',
        path: 'tabs[0].fields[1].children[0].refererField',
      }),
    );
  });

  it('rejects an authored override on a field inside an array', () => {
    const config = configWith(
      phones({
        refererField: undefined,
        children: [{ id: 'number', type: 'text', label: { en: 'Number' }, refererField: 'primaryPhone' }],
      }),
    );
    expect(validateConfig(config)).toContainEqual(
      expect.objectContaining({
        level: 'error',
        code: 'CONFIG_REFERER_INSIDE_ARRAY',
        path: 'tabs[0].fields[1].children[0].refererField',
        message: expect.stringContaining('inside an array'),
      }),
    );
  });

  it('keeps a leaf override outside any array, as it always has', () => {
    const config = configWith({ id: 'city', type: 'text', label: { en: 'City' }, refererField: 'customer.city' });
    expect(refsOf(config)).toEqual(['name', 'customer.city']);
    expect(collectFieldRefs(config).find(entry => entry.field.id === 'city')?.authored).toBe(true);
    expect(validateConfig(config).filter(problem => problem.path.includes('refererField'))).toEqual([]);
  });

  it('imports a tab-level leaf override to both addresses, as the form saves it', () => {
    const config = configWith({ id: 'city', type: 'text', label: { en: 'City' }, refererField: 'customer.city' });
    const result = applyMapping([['Ada', 'Paris']], planFor(['name', 'customer.city']), config, { stamp: false });
    expect(result.records[0]).toEqual({ name: 'Ada', city: 'Paris', customer: { city: 'Paris' } });
  });
});

/**
 * Placement in a nested tab: a sub-tab's record lives under its parent's, so placing the parent
 * must not disturb it, and a moved array on the sub-tab lands at its position under both.
 * Covers `tabPlacements` and the placement loop in `applyMapping` (`import-engine.ts`).
 */
describe('a moved array on a sub-tab', () => {
  const config: EntityFormConfig = {
    entity: 'people',
    tabs: [
      {
        id: 'personal',
        label: { en: 'Personal' },
        fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
        children: [{ id: 'contact', label: { en: 'Contact' }, fields: [phones({ refererField: 'reach.phones' })] }],
      },
    ],
  };

  it('is at its override and at its position, and the parent tab keeps its own field', () => {
    const plan = planFor(['personal.name', 'reach.phones.0.number', 'reach.phones.1.number']);
    const result = applyMapping([['Ada', '111', '222']], plan, config, { stamp: false });
    expect(result.errors).toEqual([]);
    const rows = [{ number: '111' }, { number: '222' }];
    expect(result.records[0]).toEqual({
      personal: { name: 'Ada', contact: { phones: rows } },
      reach: { phones: rows },
    });
  });
});

describe('plans saved against 2.2', () => {
  it('reads an un-indexed child of a moved array as slot 0, with a warning', () => {
    const config = configWith(phones());
    const plan = planFor(['name', 'phones.number']);

    const problems = validateMappingPlan(plan, config);
    expect(problems.filter(problem => problem.level === 'error')).toEqual([]);
    expect(problems).toContainEqual(
      expect.objectContaining({
        level: 'warning',
        code: 'PLAN_LEGACY_REF',
        message: expect.stringContaining('contact.phones.0.number'),
      }),
    );

    const result = applyMapping([['Ada', '111']], plan, config, { stamp: false });
    expect(result.records[0]['contact']).toEqual({ phones: [{ number: '111' }] });
  });

  it('reads a moved group child at its old position', () => {
    const config = configWith({
      id: 'addr',
      type: 'group',
      label: { en: 'Address' },
      refererField: 'customer.address',
      children: [{ id: 'city', type: 'text', label: { en: 'City' } }],
    });
    const result = applyMapping([['Paris']], planFor(['addr.city']), config, { stamp: false });
    expect(result.records[0]).toEqual({ customer: { address: { city: 'Paris' } }, addr: { city: 'Paris' } });
  });

  it('still rejects an old ref mapped alongside its new one', () => {
    const plan = planFor(['phones.number', 'contact.phones.0.number']);
    expect(validateMappingPlan(plan, configWith(phones()))).toContainEqual(
      expect.objectContaining({ level: 'error', code: 'PLAN_DUPLICATE_REF', message: expect.stringContaining('more than once') }),
    );
  });
});

/**
 * The moved-container derivations, frozen beside the `all-configs` baseline
 * (`server/src/all-configs.spec.ts`), which covers only `test_data.json` and so no override at
 * all. The extraction treats these as parity: a diff here moves stored plans and records.
 *
 * Covers: `deriveImportColumns` (`import-columns.ts`) → `collectLeafTargets` →
 * `collectFieldRefs` (`field-scopes.ts:220`, which rebases a tab-level container's subtree under
 * its override); and `applyMapping` (`import-engine.ts`), which normalises a moved array at its
 * override (`import-engine.ts:913`) and writes each leaf at its `recordScope`.
 */
describe('moved containers, frozen', () => {
  const nestedInGroup = configWith({ id: 'wrap', type: 'group', label: { en: 'Wrap' }, children: [phones()] });

  const cases: { name: string; config: EntityFormConfig; row: string[] }[] = [
    { name: 'a moved array', config: configWith(phones()), row: ['Ada', '111', '222', '', 'home', 'work', ''] },
    { name: 'a moved group', config: configWith(address), row: ['Ada', 'Paris'] },
    // The override the form ignores: the array stays at `wrap.phones`, where its id puts it.
    {
      name: 'an array override the form does not honour',
      config: nestedInGroup,
      row: ['Ada', '111', '', '', 'home', '', ''],
    },
  ];

  describe.each(cases)('$name', ({ config, row }) => {
    const derived = deriveImportColumns(config, { lang: 'en', maxArrayRows: 3 });

    it('derives the same columns', () => {
      expect({
        columns: derived.columns.map(({ ref, header, required, arrayIndex, arrayRef, arrayLabel }) => ({
          ref,
          header,
          required,
          arrayIndex,
          arrayRef,
          arrayLabel,
        })),
        unsupported: derived.unsupported.map(({ ref, reason }) => ({ ref, reason })),
      }).toMatchSnapshot();
    });

    it('imports a representative row to the same record', () => {
      // One sheet column per derived column, in derivation order.
      const plan = planFor(derived.columns.map(column => column.ref));
      expect(row).toHaveLength(plan.entries.length);
      const { records, errors, skipped } = applyMapping([row], plan, config, { stamp: false });
      expect({ records, errors, skipped }).toMatchSnapshot();
    });
  });
});
