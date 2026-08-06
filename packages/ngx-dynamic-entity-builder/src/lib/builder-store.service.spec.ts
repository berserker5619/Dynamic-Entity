import type { EntityConfig } from '@dynamic-entity/core';
import { BuilderStore } from './builder-store.service';

/**
 * BuilderStore is a plain signal-backed service — no injection context or effects —
 * so it can be exercised with `new BuilderStore()` directly (no TestBed needed).
 */
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
      store.updateField(id, { visible: false });
      expect(store.fields()[0].visible).toBe(false);
    });

    it('renames a field and rewires dependsOn references', () => {
      const a = store.addField('dropdown'); // dropdown_1
      const b = store.addField('text'); // text_1
      store.updateField(b, { dependsOn: { field: a, value: 'x' } });
      store.renameField(a, 'status');
      expect(store.fields().find(f => f.id === 'status')).toBeTruthy();
      expect(store.fields().find(f => f.id === b)?.dependsOn?.field).toBe('status');
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
      expect(store.fields()[1].id).toBe(dupId);
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

    it('ignores out-of-range moves', () => {
      const a = store.addField('text');
      store.moveField(a, -1); // already first
      expect(store.fields().map(f => f.id)).toEqual([a]);
    });
  });

  describe('validators', () => {
    let id: string;
    beforeEach(() => {
      store.setEntityName('clients');
      id = store.addField('text');
    });

    it('toggles flag validators without duplicating', () => {
      store.toggleFlagValidator(id, 'required', true);
      store.toggleFlagValidator(id, 'required', true);
      expect(store.fields()[0].validators).toEqual(['required']);
      store.toggleFlagValidator(id, 'required', false);
      expect(store.fields()[0].validators).toEqual([]);
    });

    it('sets and clears param validators', () => {
      store.setParamValidator(id, 'minLength', 3);
      expect(store.fields()[0].validators).toContain('minLength:3');
      expect(store.getParamValidator(store.fields()[0], 'minLength')).toBe(3);

      store.setParamValidator(id, 'minLength', 5); // replaces, not appends
      expect(store.fields()[0].validators).toEqual(['minLength:5']);

      store.setParamValidator(id, 'minLength', null); // clears
      expect(store.fields()[0].validators).toEqual([]);
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

    it('adds tabs with incrementing order and assigns new fields to the first tab', () => {
      const t1 = store.addTab();
      store.addTab();
      expect(store.tabs().map(t => t.order)).toEqual([0, 1]);

      const f = store.addField('text');
      expect(store.fields().find(x => x.id === f)?.tab).toBe(t1);
    });

    it('removes a tab and unassigns its fields', () => {
      const t1 = store.addTab();
      const f = store.addField('text'); // auto-assigned to t1
      store.removeTab(t1);
      expect(store.tabs().length).toBe(0);
      expect(store.fields().find(x => x.id === f)?.tab).toBeUndefined();
    });

    it('reorders tabs', () => {
      const t1 = store.addTab();
      const t2 = store.addTab();
      store.moveTab(t1, 1);
      expect(store.tabs().map(t => t.id)).toEqual([t2, t1]);
    });

    it('flags a field pointing at an unknown tab', () => {
      const f = store.addField('text');
      store.updateField(f, { tab: 'ghost' });
      expect(store.errors().some(p => /unknown tab/i.test(p.message))).toBe(true);
    });
  });

  describe('validation', () => {
    beforeEach(() => store.setEntityName('clients'));

    it('flags duplicate field ids as an error', () => {
      const a = store.addField('text');
      store.addField('text');
      // Force a duplicate directly (UI prevents this, validation is the safety net)
      store.updateField(store.fields()[1].id, { id: a });
      expect(store.errors().some(p => /duplicate field id/i.test(p.message))).toBe(true);
    });

    it('warns when a dropdown has no options', () => {
      store.addField('dropdown');
      expect(store.problems().some(p => p.level === 'warning' && /no options/i.test(p.message))).toBe(
        true,
      );
    });
  });

  describe('load / export immutability', () => {
    it('deep-clones on load so the input is never mutated', () => {
      const input: EntityConfig = {
        entity: 'clients',
        version: 3,
        fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
      };
      store.load(input);
      store.updateField('name', { label: { en: 'Changed' } });
      expect(input.fields[0].label).toEqual({ en: 'Name' }); // untouched
      expect(store.config().version).toBe(3);
    });

    it('exportConfig returns a detached copy', () => {
      store.setEntityName('clients');
      store.addField('text');
      const exported = store.exportConfig();
      exported.fields[0].id = 'mutated';
      expect(store.fields()[0].id).not.toBe('mutated');
    });
  });
});
