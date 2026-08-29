import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
import { toRefToken } from '@dynamic-entity/core';
import { BuilderStore } from './builder-store.service';

const CONFIG: EntityFormConfig = {
  entity: 'people',
  version: 1,
  tabs: [
    { id: 'personal', label: { en: 'Personal' }, fields: [{ id: 'address', type: 'text', label: {} }] },
    { id: 'work', label: { en: 'Work' }, fields: [{ id: 'phone', type: 'text', label: {} }] },
  ],
};

const rule = (over: Partial<FormRule> = {}): FormRule => ({
  formConfigId: 'people',
  fieldId: toRefToken('work.phone'),
  conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'x' }],
  action: { type: 'visibility', value: false },
  targets: [{ id: toRefToken('work.phone'), type: 'field' }],
  enabled: true,
  priority: 1,
  ...over,
});

describe('BuilderStore — field paths', () => {
  let store: BuilderStore;

  beforeEach(() => {
    store = new BuilderStore();
    store.load(JSON.parse(JSON.stringify(CONFIG)));
  });

  const refOf = (id: string): string | undefined =>
    store.fields().find(f => f.id === id)?.refererField;

  it('stamps a path on every field when a config is loaded', () => {
    expect(refOf('address')).toBe('personal.address');
    expect(refOf('phone')).toBe('work.phone');
  });

  it('gives a newly added field the path of the tab it was added to', () => {
    const id = store.addField('text', 'work');
    expect(refOf(id)).toBe(`work.${id}`);
  });

  // A ref is an address, so it has to change when the structure around the field does.
  it('restamps the path when a field moves to another tab', () => {
    store.moveFieldToTab('phone', 'personal');
    expect(refOf('phone')).toBe('personal.phone');
  });

  /**
   * The whole reason refs are maintained rather than computed: a rule that pointed at
   * `work.phone` must follow the field to `personal.phone`, or it silently addresses nothing.
   */
  it('repoints a rule that pointed at the field that moved', () => {
    store.loadRules([rule()]);
    store.moveFieldToTab('phone', 'personal');

    const moved = store.rules()[0];
    expect(moved.fieldId).toBe(toRefToken('personal.phone'));
    expect(moved.targets[0].id).toBe(toRefToken('personal.phone'));
  });

  it('repoints a condition that compared against the field that moved', () => {
    store.loadRules([
      rule({
        fieldId: toRefToken('personal.address'),
        conditions: [{ operator: 'EQUAL', compareType: 'field', compareToField: toRefToken('work.phone') }],
      }),
    ]);
    store.moveFieldToTab('phone', 'personal');

    expect(store.rules()[0].conditions[0].compareToField).toBe(toRefToken('personal.phone'));
  });

  it('leaves a rule written with a bare field id alone', () => {
    store.loadRules([rule({ fieldId: 'phone', targets: [{ id: 'phone', type: 'field' }] })]);
    store.moveFieldToTab('phone', 'personal');

    expect(store.rules()[0].fieldId).toBe('phone');
    expect(store.rules()[0].targets[0].id).toBe('phone');
  });

  /**
   * A declared `refererField` is a binding override, not an address the builder assigned, so
   * a structural edit elsewhere must not rewrite it.
   */
  it('leaves a declared refererField alone when the config moves around it', () => {
    store.load(
      JSON.parse(
        JSON.stringify({
          ...CONFIG,
          tabs: [
            {
              id: 'personal',
              label: {},
              fields: [{ id: 'address', type: 'text', label: {}, refererField: 'customer.billing.street' }],
            },
            { id: 'work', label: {}, fields: [{ id: 'phone', type: 'text', label: {} }] },
          ],
        }),
      ) as EntityFormConfig,
    );

    store.moveFieldToTab('phone', 'personal');

    expect(store.fields().find(f => f.id === 'address')?.refererField).toBe('customer.billing.street');
    expect(store.fields().find(f => f.id === 'phone')?.refererField).toBe('personal.phone');
  });

  it('leaves rules alone when a move is ambiguous', () => {
    store.load(
      JSON.parse(JSON.stringify({
        ...CONFIG,
        tabs: [
          { id: 'personal', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
          { id: 'work', label: {}, fields: [{ id: 'address', type: 'text', label: {} }] },
          { id: 'other', label: {}, fields: [] },
        ],
      })) as EntityFormConfig,
    );
    store.loadRules([rule({ fieldId: toRefToken('work.address'), targets: [{ id: toRefToken('work.address'), type: 'field' }] })]);

    store.moveFieldToTab('address', 'other');

    // Two fields share `address`, so which one moved cannot be told from the id alone.
    // Guessing would rewrite a rule to point at the wrong field.
    expect(store.rules()[0].fieldId).toBe(toRefToken('work.address'));
  });
});
