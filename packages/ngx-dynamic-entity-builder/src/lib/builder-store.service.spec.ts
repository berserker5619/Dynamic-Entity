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

  describe('label-derived field ids', () => {
    beforeEach(() => store.setEntityName('clients'));

    it('derives the id from the label as it is typed', () => {
      const generated = store.addField('text');
      expect(generated).toBe('text_1');

      store.setFieldLabel('text_1', 'en', 'Employee Count');

      expect(store.fields()[0].id).toBe('employeeCount');
      expect(store.selectedFieldId()).toBe('employeeCount');
    });

    it('keeps following the label on subsequent edits', () => {
      store.addField('text');
      store.setFieldLabel('text_1', 'en', 'First Name');
      store.setFieldLabel('firstName', 'en', 'Surname');

      expect(store.fields()[0].id).toBe('surname');
    });

    it('stops following once the author edits the id', () => {
      store.addField('text');
      store.setFieldLabel('text_1', 'en', 'First Name');

      store.renameField('firstName', 'given_name');
      store.setFieldLabel('given_name', 'en', 'Something Else');

      expect(store.fields()[0].id).toBe('given_name');
      expect(store.hasManualId('given_name')).toBe(true);
    });

    it('never rewrites ids of a config loaded from storage', () => {
      store.load({
        entity: 'clients',
        tabs: [{ id: 'main', label: { en: 'Main' }, fields: [{ id: 'legacy_key', type: 'text', label: { en: 'Old' } }] }],
      });

      store.setFieldLabel('legacy_key', 'en', 'Brand New Label');

      expect(store.fields()[0].id).toBe('legacy_key');
      expect(store.fields()[0].label).toEqual({ en: 'Brand New Label' });
    });

    it('only derives from the default language', () => {
      store.addField('text');
      store.setFieldLabel('text_1', 'de', 'Vorname');

      expect(store.fields()[0].id).toBe('text_1');
      expect(store.fields()[0].label).toMatchObject({ de: 'Vorname' });
    });

    it('leaves the id alone for an empty or symbol-only label', () => {
      store.addField('text');
      store.setFieldLabel('text_1', 'en', '');
      store.setFieldLabel('text_1', 'en', '***');

      expect(store.fields()[0].id).toBe('text_1');
    });

    it('suffixes a derived id that collides with another field', () => {
      store.addField('text');
      store.setFieldLabel('text_1', 'en', 'Name');

      store.addField('text');
      store.setFieldLabel('text_1', 'en', 'Name');

      expect(store.fields().map(f => f.id)).toEqual(['name', 'name_2']);
      expect(store.isValid()).toBe(true);
    });

    it('does not treat the field’s own id as a collision', () => {
      store.addField('text');
      store.setFieldLabel('text_1', 'en', 'Name');
      store.setFieldLabel('name', 'en', 'Name');

      expect(store.fields()[0].id).toBe('name');
    });

    it('frees the id for reuse after the field is deleted', () => {
      store.addField('text');
      store.setFieldLabel('text_1', 'en', 'Name');
      store.removeField('name');

      expect(store.hasManualId('name')).toBe(false);
    });
  });

  describe('rename keeps id-based references in sync', () => {
    beforeEach(() => {
      store.load({
        entity: 'clients',
        tabs: [
          {
            id: 'main',
            label: { en: 'Main' },
            fields: [
              { id: 'country', type: 'entity-ref', label: { en: 'Country' } },
              {
                id: 'city',
                type: 'entity-ref',
                label: { en: 'City' },
                entityReference: { enabled: true, parentField: 'country' },
              },
              { id: 'notes', type: 'text', label: { en: 'Notes' }, showWhen: { country: 'de' } },
              {
                id: 'company',
                type: 'entity-ref',
                label: { en: 'Company' },
                autoPatch: { targetTab: 'main', mappings: [{ source: 'iso', target: 'country' }] },
              },
              {
                id: 'sameAs',
                type: 'boolean',
                label: { en: 'Same' },
                patchOnTrue: [{ from: 'country', to: 'notes' }],
              },
            ],
          },
        ],
      });
      store.loadRules([
        {
          id: 'r1',
          formConfigId: 'clients',
          fieldId: 'country',
          conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'de' }],
          action: { type: 'visibility', value: false },
          targets: [
            { id: 'country', type: 'field' },
            { id: 'main', type: 'tab' },
          ],
          enabled: true,
          priority: 1,
        },
      ]);

      store.renameField('country', 'countryCode');
    });

    it('repoints a cascade parentField', () => {
      const city = store.fields().find(f => f.id === 'city');
      expect(city?.entityReference?.parentField).toBe('countryCode');
    });

    it('repoints a showWhen key', () => {
      const notes = store.fields().find(f => f.id === 'notes');
      expect(notes?.showWhen).toEqual({ countryCode: 'de' });
    });

    it('repoints an autoPatch target but leaves the linked-record source alone', () => {
      const company = store.fields().find(f => f.id === 'company');
      expect(company?.autoPatch?.mappings).toEqual([{ source: 'iso', target: 'countryCode' }]);
    });

    it('repoints patchOnTrue mappings', () => {
      const sameAs = store.fields().find(f => f.id === 'sameAs');
      expect(sameAs?.patchOnTrue).toEqual([{ from: 'countryCode', to: 'notes' }]);
    });

    it('repoints a rule trigger and its field targets, but not tab targets', () => {
      const rule = store.rules()[0];
      expect(rule.fieldId).toBe('countryCode');
      expect(rule.targets).toEqual([
        { id: 'countryCode', type: 'field' },
        { id: 'main', type: 'tab' },
      ]);
    });
  });

  describe('entity-level settings', () => {
    it('sets the default language and mask flag', () => {
      store.setDefaultLanguage('de');
      store.setMaskData(true);

      expect(store.config().defaultLanguage).toBe('de');
      expect(store.config().maskData).toBe(true);
    });

    it('tracks the active language independently of the config default', () => {
      store.setActiveLanguage('fr');
      expect(store.activeLanguage()).toBe('fr');
      expect(store.config().defaultLanguage).toBe('en');
    });

    it('adopts the config default language on load', () => {
      store.load({ entity: 'x', defaultLanguage: 'de', tabs: [] });
      expect(store.activeLanguage()).toBe('de');
    });

    it('gives a config with no tabs a default tab on load', () => {
      store.load({ entity: 'x', tabs: [] });
      expect(store.tabs().map(t => t.id)).toEqual(['default']);
    });
  });

  describe('localized text and nested lookup', () => {
    beforeEach(() => {
      store.load({
        entity: 'clients',
        tabs: [
          { id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }] },
          {
            id: 'parent',
            label: { en: 'Parent' },
            fields: [],
            children: [
              {
                id: 'child',
                label: { en: 'Child' },
                fields: [{ id: 'deep', type: 'text', label: { en: 'Deep' } }],
              },
            ],
          },
        ],
      });
    });

    it('finds and edits a field inside a nested tab', () => {
      store.setFieldLabel('deep', 'de', 'Tief');
      expect(store.selectedField.name).toBeDefined(); // signal exists
      store.selectField('deep');
      expect(store.selectedField()?.label).toEqual({ en: 'Deep', de: 'Tief' });
    });

    it('sets a placeholder, creating the map when absent', () => {
      store.setFieldPlaceholder('name', 'en', 'Type here');
      store.selectField('name');
      expect(store.selectedField()?.placeholder).toEqual({ en: 'Type here' });
    });
  });

  describe('no-op guards', () => {
    beforeEach(() => {
      store.setEntityName('clients');
      store.addField('text');
    });

    it('ignores mutations aimed at a field that does not exist', () => {
      const before = JSON.stringify(store.config());

      store.updateField('ghost', { readonly: true });
      store.setFieldLabel('ghost', 'en', 'X');
      store.setFieldPlaceholder('ghost', 'en', 'X');
      store.setShowWhen('ghost', { a: 1 });
      store.updateEntityReference('ghost', { linkedEntityKey: 'k' });
      store.addAutoPatchMapping('ghost');
      store.addPatchOnTrueMapping('ghost');
      store.toggleFlagValidator('ghost', 'required', true);
      store.setParamValidator('ghost', 'min', 1);
      store.addOption('ghost');
      store.removeOption('ghost', 0);

      expect(JSON.stringify(store.config())).toBe(before);
    });

    it('ignores autoPatch and patchOnTrue edits when nothing is configured', () => {
      const id = store.selectedFieldId()!;
      store.setAutoPatchTargetTab(id, 'main');
      store.updateAutoPatchMapping(id, 0, { source: 'a' });
      store.removeAutoPatchMapping(id, 0);
      store.updatePatchOnTrueMapping(id, 0, { from: 'a' });
      store.removePatchOnTrueMapping(id, 0);

      expect(store.selectedField()?.autoPatch).toBeUndefined();
      expect(store.selectedField()?.patchOnTrue).toBeUndefined();
    });

    it('refuses a rename that is empty, unchanged, or already taken', () => {
      const first = store.fields()[0].id;
      const second = store.addField('text');

      store.renameField(first, '   ');
      store.renameField(first, first);
      store.renameField(first, second);

      expect(store.fields().map(f => f.id)).toEqual([first, second]);
    });

    it('ignores a duplicate or move of an unknown field', () => {
      expect(store.duplicateField('ghost')).toBeNull();
      store.moveField('ghost', 1);
      expect(store.fields().length).toBe(1);
    });

    it('ignores a move past either end', () => {
      const id = store.fields()[0].id;
      store.moveField(id, -1);
      store.moveField(id, 1);
      expect(store.fields()[0].id).toBe(id);
    });

    it('ignores an out-of-range reorder', () => {
      const before = store.fields().map(f => f.id);
      store.reorderField(0, 5);
      store.reorderField(-1, 0);
      expect(store.fields().map(f => f.id)).toEqual(before);
    });
  });

  describe('tabs', () => {
    beforeEach(() => store.setEntityName('clients'));

    it('adds a tab with a humanized label and unique id', () => {
      const first = store.addTab();
      const second = store.addTab();

      expect(first).not.toBe(second);
      expect(store.tabs().find(t => t.id === first)?.label).toEqual({ en: 'Tab 1' });
    });

    it('updates, relabels, and removes a tab', () => {
      const id = store.addTab();

      store.updateTab(id, { visibility: false });
      store.setTabLabel(id, 'de', 'Reiter');
      expect(store.tabs().find(t => t.id === id)).toMatchObject({
        visibility: false,
        label: { en: 'Tab 1', de: 'Reiter' },
      });

      store.removeTab(id);
      expect(store.tabs().some(t => t.id === id)).toBe(false);
    });

    it('moves a tab and ignores a move past either end', () => {
      const a = store.addTab();
      const b = store.addTab();

      store.moveTab(b, -1);
      expect(store.tabs().map(t => t.id)).toEqual([b, a]);

      store.moveTab(b, -1); // already first
      store.moveTab('ghost', 1);
      expect(store.tabs().map(t => t.id)).toEqual([b, a]);
    });
  });

  describe('entity reference', () => {
    let fieldId: string;

    beforeEach(() => {
      store.setEntityName('clients');
      fieldId = store.addField('entity-ref');
    });

    it('merges patches and keeps the block enabled', () => {
      store.updateEntityReference(fieldId, { linkedEntityKey: 'countries' });
      store.updateEntityReference(fieldId, { displayFields: ['name'] });

      expect(store.selectedField()?.entityReference).toEqual({
        enabled: true,
        linkedEntityKey: 'countries',
        displayFields: ['name'],
      });
    });

    it('drops keys explicitly cleared to undefined', () => {
      store.updateEntityReference(fieldId, { parentField: 'country', lookupFilter: 'iso' });
      store.updateEntityReference(fieldId, { parentField: undefined });

      expect(store.selectedField()?.entityReference).not.toHaveProperty('parentField');
      expect(store.selectedField()?.entityReference?.lookupFilter).toBe('iso');
    });
  });

  describe('autoPatch', () => {
    let fieldId: string;

    beforeEach(() => {
      store.setEntityName('clients');
      store.addTab();
      fieldId = store.addField('entity-ref');
    });

    it('creates the config on the first mapping, defaulting to the first tab', () => {
      store.addAutoPatchMapping(fieldId);
      const autoPatch = store.selectedField()?.autoPatch;

      expect(autoPatch?.targetTab).toBe(store.tabs()[0].id);
      expect(autoPatch?.mappings).toEqual([{ source: '', target: '' }]);
    });

    it('updates a mapping in place', () => {
      store.addAutoPatchMapping(fieldId);
      store.updateAutoPatchMapping(fieldId, 0, { source: 'vat', target: 'taxId' });

      expect(store.selectedField()?.autoPatch?.mappings[0]).toEqual({ source: 'vat', target: 'taxId' });
    });

    it('retargets the tab', () => {
      store.addAutoPatchMapping(fieldId);
      store.setAutoPatchTargetTab(fieldId, 'tab_1');
      expect(store.selectedField()?.autoPatch?.targetTab).toBe('tab_1');
    });

    it('removes autoPatch entirely once the last mapping goes', () => {
      store.addAutoPatchMapping(fieldId);
      store.addAutoPatchMapping(fieldId);

      store.removeAutoPatchMapping(fieldId, 0);
      expect(store.selectedField()?.autoPatch?.mappings.length).toBe(1);

      store.removeAutoPatchMapping(fieldId, 0);
      expect(store.selectedField()?.autoPatch).toBeUndefined();
    });
  });

  describe('patchOnTrue', () => {
    let fieldId: string;

    beforeEach(() => {
      store.setEntityName('clients');
      fieldId = store.addField('boolean');
    });

    it('adds, updates, and removes mappings', () => {
      store.addPatchOnTrueMapping(fieldId);
      store.updatePatchOnTrueMapping(fieldId, 0, { from: 'home', to: 'billing' });
      expect(store.selectedField()?.patchOnTrue).toEqual([{ from: 'home', to: 'billing' }]);

      store.removePatchOnTrueMapping(fieldId, 0);
      expect(store.selectedField()?.patchOnTrue).toBeUndefined();
    });
  });

  describe('showWhen', () => {
    let fieldId: string;

    beforeEach(() => {
      store.setEntityName('clients');
      fieldId = store.addField('text');
    });

    it('sets and clears the condition map', () => {
      store.setShowWhen(fieldId, { isEmployee: true });
      expect(store.selectedField()?.showWhen).toEqual({ isEmployee: true });

      store.setShowWhen(fieldId, {});
      expect(store.selectedField()?.showWhen).toBeUndefined();
    });
  });

  describe('rules', () => {
    const rule = (fieldId: string, id?: string) => ({
      id,
      formConfigId: 'clients',
      fieldId,
      conditions: [{ operator: 'EQUAL' as const, compareType: 'value' as const, value: 'x' }],
      action: { type: 'visibility' as const, value: false },
      targets: [{ id: fieldId, type: 'field' as const }],
      enabled: true,
      priority: 1,
    });

    beforeEach(() => {
      store.setEntityName('clients');
      store.addField('text');
    });

    it('assigns an id when one is not supplied', () => {
      const id = store.addRule(rule('text_1'));
      expect(id).toBeTruthy();
      expect(store.rules()[0].id).toBe(id);
    });

    it('scopes rulesForSelectedField to the trigger or a target', () => {
      store.addRule(rule('text_1'));
      store.addRule(rule('other'));

      store.selectField('text_1');
      expect(store.rulesForSelectedField().length).toBe(1);

      store.selectField(null);
      expect(store.rulesForSelectedField()).toEqual([]);
    });

    it('toggles, updates, and removes a rule', () => {
      const id = store.addRule(rule('text_1'));

      store.toggleRule(id, false);
      expect(store.rules()[0].enabled).toBe(false);

      store.updateRule(id, { priority: 9 });
      expect(store.rules()[0].priority).toBe(9);

      store.removeRule(id);
      expect(store.rules()).toEqual([]);
    });

    it('renumbers priorities contiguously when reordering', () => {
      const first = store.addRule(rule('text_1'));
      const second = store.addRule(rule('text_1'));

      store.moveRule(second, -1);

      expect(store.rules().map(r => r.id)).toEqual([second, first]);
      expect(store.rules().map(r => r.priority)).toEqual([1, 2]);
    });

    it('ignores a move past either end', () => {
      const id = store.addRule(rule('text_1'));
      store.moveRule(id, -1);
      expect(store.rules().map(r => r.id)).toEqual([id]);
    });

    it('clears rules on reset', () => {
      store.addRule(rule('text_1'));
      store.reset();
      expect(store.rules()).toEqual([]);
    });
  });
});
