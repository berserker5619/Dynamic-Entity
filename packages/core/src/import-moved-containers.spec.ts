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

describe('a moved group', () => {
  const address: NestedFieldConfig = {
    id: 'addr',
    type: 'group',
    label: { en: 'Address' },
    refererField: 'customer.address',
    children: [{ id: 'city', type: 'text', label: { en: 'City' } }],
  };

  it('takes its children with it, and keeps the heading its position gives it', () => {
    const column = deriveImportColumns(configWith(address)).columns.find(c => c.field.id === 'city');
    expect(column).toMatchObject({ ref: 'customer.address.city', header: 'Address / City' });
  });

  it('imports to the override', () => {
    const result = applyMapping([['Paris']], planFor(['customer.address.city']), configWith(address), {
      stamp: false,
    });
    expect(result.records[0]).toEqual({ customer: { address: { city: 'Paris' } } });
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
});

describe('plans saved against 2.2', () => {
  it('reads an un-indexed child of a moved array as slot 0, with a warning', () => {
    const config = configWith(phones());
    const plan = planFor(['name', 'phones.number']);

    const problems = validateMappingPlan(plan, config);
    expect(problems.filter(problem => problem.level === 'error')).toEqual([]);
    expect(problems).toContainEqual(
      expect.objectContaining({ level: 'warning', message: expect.stringContaining('contact.phones.0.number') }),
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
    expect(result.records[0]).toEqual({ customer: { address: { city: 'Paris' } } });
  });

  it('still rejects an old ref mapped alongside its new one', () => {
    const plan = planFor(['phones.number', 'contact.phones.0.number']);
    expect(validateMappingPlan(plan, configWith(phones()))).toContainEqual(
      expect.objectContaining({ level: 'error', message: expect.stringContaining('more than once') }),
    );
  });
});
