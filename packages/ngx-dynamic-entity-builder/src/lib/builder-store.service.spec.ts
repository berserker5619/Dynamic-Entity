import type { EntityFormConfig } from '@dynamic-entity/core';
import { BuilderStore } from './builder-store.service';

describe('BuilderStore', () => {
  let store: BuilderStore;

  beforeEach(() => {
    store = new BuilderStore();
  });

  it('starts blank and invalid (entity name required)', () => {
    expect(store.fields().length).toBe(0);
    expect(store.config().version).toBe(1);
    expect(store.isValid()).toBe(false);
    expect(store.errors().some(p => /entity name is required/i.test(p.message))).toBe(true);
  });

  describe('entity settings', () => {
    it('accepts a valid entity name', () => {
      store.setEntityName('clients');
      expect(store.config().entity).toBe('clients');
      expect(store.errors().length).toBe(0);
    });

    it('rejects an invalid entity name', () => {
      store.setEntityName('2 bad name');
      expect(store.isValid()).toBe(false);
    });

    it('sets permissions per action', () => {
      store.setPermission('edit', ['ADMIN']);
      expect(store.config().permissions?.edit).toEqual(['ADMIN']);
    });
  });

  describe('fields', () => {
    beforeEach(() => store.setEntityName('clients'));

    it('adds a field with a unique generated id and selects it', () => {
      const id1 = store.addField('text');
      const id2 = store.addField('text');
      expect(id1).toBe('text_1');
      expect(id2).toBe('text_2');
      expect(store.fields().length).toBe(2);
      expect(store.selectedFieldId()).toBe('text_2');
    });

    it('updates a field via patch', () => {
      const id = store.addField('text');
      store.updateField(id, { visibility: false });
      expect(store.fields()[0].visibility).toBe(false);
    });

    it('renames a field', () => {
      const a = store.addField('dropdown'); // dropdown_1
      store.renameField(a, 'status');
      expect(store.fields().find(f => f.id === 'status')).toBeTruthy();
    });

    it('refuses a rename that collides with an existing id', () => {
      store.addField('text'); // text_1
      const b = store.addField('text'); // text_2
      store.renameField(b, 'text_1');
      expect(store.fields().map(f => f.id)).toEqual(['text_1', 'text_2']);
    });

    it('duplicates a field right after the original with a fresh id', () => {
      const a = store.addField('text');
      store.updateField(a, { label: { en: 'Original' } });
      const dupId = store.duplicateField(a);
      expect(store.fields().length).toBe(2);
      expect(store.fields()[1].id).toBe(dupId!);
      expect(store.fields()[1].label).toEqual({ en: 'Original' });
    });

    it('removes a field and clears the selection', () => {
      const id = store.addField('text');
      store.removeField(id);
      expect(store.fields().length).toBe(0);
      expect(store.selectedFieldId()).toBeNull();
    });

    it('moves and reorders fields', () => {
      const a = store.addField('text');
      const b = store.addField('text');
      store.moveField(a, 1);
      expect(store.fields().map(f => f.id)).toEqual([b, a]);
      store.reorderField(0, 1);
      expect(store.fields().map(f => f.id)).toEqual([a, b]);
    });
  });

  describe('validators', () => {
    let id: string;
    beforeEach(() => {
      store.setEntityName('clients');
      id = store.addField('text');
    });

    it('toggles flag validators', () => {
      store.toggleFlagValidator(id, 'required', true);
      expect(store.fields()[0].validators?.required).toBe(true);
      store.toggleFlagValidator(id, 'required', false);
      expect(store.fields()[0].validators?.required).toBeUndefined();
    });

    it('sets and clears param validators', () => {
      store.setParamValidator(id, 'minLength', 3);
      expect(store.fields()[0].validators?.minLength).toBe(3);
      expect(store.getParamValidator(store.fields()[0], 'minLength')).toBe(3);

      store.setParamValidator(id, 'minLength', null);
      expect(store.fields()[0].validators?.minLength).toBeUndefined();
    });
  });

  describe('options', () => {
    let id: string;
    beforeEach(() => {
      store.setEntityName('clients');
      id = store.addField('dropdown');
    });

    it('adds, edits, and removes options', () => {
      store.addOption(id);
      store.addOption(id);
      expect(store.fields()[0].options?.length).toBe(2);

      store.updateOption(id, 0, { value: 'active' });
      store.setOptionLabel(id, 0, 'en', 'Active');
      expect(store.fields()[0].options?.[0]).toEqual({ value: 'active', label: { en: 'Active' } });

      store.removeOption(id, 0);
      expect(store.fields()[0].options?.length).toBe(1);
    });
  });

  describe('tabs', () => {
    beforeEach(() => store.setEntityName('clients'));

    it('adds tabs and assigns fields', () => {
      store.addTab();
      expect(store.tabs().length).toBe(1);
    });

    it('removes a tab', () => {
      const t1 = store.addTab();
      store.removeTab(t1);
      expect(store.tabs().length).toBe(0);
    });
  });

  describe('load / export immutability', () => {
    it('deep-clones on load so the input is never mutated', () => {
      const input: EntityFormConfig = {
        entity: 'clients',
        version: 3,
        tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }] }],
      };
      store.load(input);
      store.updateField('name', { label: { en: 'Changed' } });
      expect(input.tabs[0].fields![0].label).toEqual({ en: 'Name' });
      expect(store.config().version).toBe(3);
    });

    it('exportConfig returns a detached copy', () => {
      store.setEntityName('clients');
      store.addField('text');
      const exported = store.exportConfig();
      exported.tabs[0].fields![0].id = 'mutated';
      expect(store.fields()[0].id).not.toBe('mutated');
    });
  });
});
