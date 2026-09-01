import { TestBed } from '@angular/core/testing';
import type { EntityFormConfig, NestedFieldConfig } from '@dynamic-entity/core';
import { BuilderStore } from './builder-store.service';

/**
 * What the builder refuses to save, and what it merely grumbles about.
 *
 * The distinction is load-bearing: an error disables Save, so anything reported as one makes
 * the whole config uneditable until it is resolved. Getting that wrong is how a config
 * becomes a dead end — which is exactly what the per-scope id bug did.
 */
describe('BuilderStore — problems it reports', () => {
  let store: BuilderStore;

  const load = (tabs: EntityFormConfig['tabs']): void =>
    store.load({ entity: 'clients', version: 1, tabs });

  const messages = () => store.problems().map(p => `${p.level}: ${p.message}`);
  const errors = () => store.errors().map(p => p.message);

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [BuilderStore] });
    store = TestBed.inject(BuilderStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('warns about an entity with no fields, without blocking Save', () => {
    load([{ id: 'main', label: { en: 'Main' }, fields: [] }]);
    // A new entity starts empty. Blocking Save here would stop anyone creating one.
    expect(messages().some(m => /warning: This entity has no fields yet/.test(m))).toBe(true);
    expect(store.isValid()).toBe(true);
  });

  it('rejects a field id that is not a valid identifier', () => {
    load([
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [{ id: '2 bad id', type: 'text', label: { en: 'Bad' } }],
      },
    ]);
    // Ids become record keys and control names; a malformed one breaks both.
    expect(errors().some(m => /not a valid identifier/.test(m))).toBe(true);
    expect(store.isValid()).toBe(false);
  });

  it('warns about a field with no label rather than blocking', () => {
    load([{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text' } as NestedFieldConfig] }]);
    expect(messages().some(m => /warning: Field "name" has no label/.test(m))).toBe(true);
    expect(store.isValid()).toBe(true);
  });

  it('warns when a choice field has neither options nor a list name', () => {
    load([
      { id: 'main', label: { en: 'Main' }, fields: [{ id: 'status', type: 'dropdown', label: { en: 'Status' } }] },
    ]);
    // It will render an empty dropdown — usable, but almost certainly unfinished.
    expect(messages().some(m => /is a dropdown but has no options/.test(m))).toBe(true);
  });

  it('warns when a choice field names an empty list', () => {
    load([
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [{ id: 'status', type: 'dropdown', label: { en: 'Status' }, listName: '   ' }],
      },
    ]);
    // Opting into a named list and then not naming it resolves to nothing at runtime.
    expect(messages().some(m => /reads options from a named list but has no list name/.test(m))).toBe(true);
  });

  it('accepts a choice field that names a list, without asking for inline options too', () => {
    load([
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [{ id: 'tier', type: 'dropdown', label: { en: 'Tier' }, listName: 'clientTier' }],
      },
    ]);
    expect(messages().some(m => /has no options/.test(m))).toBe(false);
  });

  it('rejects an entity with no name', () => {
    store.load({ entity: '', version: 1, tabs: [] });
    expect(errors().some(m => /Entity name is required/.test(m))).toBe(true);
  });
});

describe('BuilderStore — referenced fields', () => {
  let store: BuilderStore;

  const source: NestedFieldConfig = {
    id: 'firstName',
    type: 'text',
    label: { en: 'First name' },
    validators: { required: true },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [BuilderStore] });
    store = TestBed.inject(BuilderStore);
    store.load({
      entity: 'clients',
      version: 1,
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
        },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  const field = () => store.fields()[0];

  it('copies the source definition when a field is linked', () => {
    store.linkReferencedField('name', 'individuals', source);

    const linked = field();
    expect(linked.isReferenced).toBe(true);
    expect(linked.referencedEntityKey).toBe('individuals');
    expect(linked.referencedFieldId).toBe('firstName');
    // The label, type and validators come across, so the linked field behaves like its source.
    expect(linked.label).toEqual({ en: 'First name' });
    expect(linked.validators).toEqual({ required: true });
    expect(linked.hasDrift).toBeFalsy();
  });

  it('keeps the copies independent of the source object', () => {
    store.linkReferencedField('name', 'individuals', source);
    (source.label as Record<string, string>)['en'] = 'Mutated';
    // A shared reference would let an unrelated edit to the source config rewrite this config.
    expect(field().label).toEqual({ en: 'First name' });
  });

  it('does nothing when the field to link does not exist', () => {
    expect(() => store.linkReferencedField('missing', 'individuals', source)).not.toThrow();
    expect(field().isReferenced).toBeFalsy();
  });

  it('unlinks a field and clears what the link brought with it', () => {
    store.linkReferencedField('name', 'individuals', source);
    store.unlinkReferencedField('name');

    const unlinked = field();
    expect(unlinked.isReferenced).toBeFalsy();
    expect(unlinked.referencedEntityKey).toBeUndefined();
    expect(unlinked.hasDrift).toBeFalsy();
  });
});
