import { TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import type { EntityFormConfig, NestedFieldConfig } from '@dynamic-entity/core';
import { assignFieldRefs } from '@dynamic-entity/core';
import { FormStructureService } from './form-structure.service';

/**
 * `FormStructureService` in isolation — no component, no fixture.
 *
 * That is the point of it being a service: config ⇄ `FormGroup` is a pure question about
 * where a value lives, and answering it used to require standing up a whole form to ask.
 */
const CONFIG = (): EntityFormConfig =>
  assignFieldRefs({
    entity: 'people',
    version: 1,
    tabs: [
      {
        id: 'personal',
        label: { en: 'Personal' },
        fields: [
          { id: 'firstName', type: 'text', label: { en: 'First name' } },
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
        children: [
          {
            id: 'emergency',
            label: { en: 'Emergency' },
            fields: [{ id: 'phone', type: 'text', label: { en: 'Phone' } }],
          },
        ],
      },
      {
        id: 'work',
        label: { en: 'Work' },
        flatData: true,
        fields: [{ id: 'deskNumber', type: 'text', label: { en: 'Desk' } }],
      },
    ],
  })!;

describe('FormStructureService', () => {
  let service: FormStructureService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [FormStructureService] });
    service = TestBed.inject(FormStructureService);
  });

  describe('buildForm', () => {
    it('nests by tab id, and merges a flatData tab into its parent', () => {
      const form = service.buildForm(CONFIG());

      expect(form.get('personal.firstName')).toBeInstanceOf(FormControl);
      expect(form.get('personal.emergency.phone')).toBeInstanceOf(FormControl);
      // `flatData` puts the tab's fields at the parent's level rather than under the tab id.
      expect(form.get('work')).toBeNull();
      expect(form.get('deskNumber')).toBeInstanceOf(FormControl);
    });

    it('opens a group for a `group` field and an empty array for an `array`', () => {
      const form = service.buildForm(CONFIG());

      expect(form.get('personal.address')).toBeInstanceOf(FormGroup);
      expect(form.get('personal.address.city')).toBeInstanceOf(FormControl);
      expect(form.get('personal.contacts')).toBeInstanceOf(FormArray);
      expect((form.get('personal.contacts') as FormArray).length).toBe(0);
    });

    it('applies a field’s validators and its disabled flag', () => {
      const config: EntityFormConfig = {
        entity: 'e',
        tabs: [
          {
            id: 't',
            label: { en: 'T' },
            fields: [
              { id: 'req', type: 'text', label: { en: 'R' }, validators: { required: true } },
              { id: 'off', type: 'text', label: { en: 'O' }, disabled: true },
              { id: 'def', type: 'text', label: { en: 'D' }, defaultValue: 'seeded' },
            ],
          },
        ],
      };
      const form = service.buildForm(config);

      expect(form.get('t.req')!.invalid).toBe(true);
      expect(form.get('t.off')!.disabled).toBe(true);
      expect(form.get('t.def')!.value).toBe('seeded');
    });

    it('copes with a config whose tabs hold no fields', () => {
      const form = service.buildForm({ entity: 'e', tabs: [{ id: 't', label: { en: 'T' } }] });
      expect(form.get('t')).toBeInstanceOf(FormGroup);
    });
  });

  describe('buildArrayRow', () => {
    const rowField = (): NestedFieldConfig => ({
      id: 'contacts',
      type: 'array',
      label: { en: 'Contacts' },
      children: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
    });

    it('builds a group when the field declares columns, and patches the row in', () => {
      const row = service.buildArrayRow(rowField(), { name: 'Ada' });
      expect(row).toBeInstanceOf(FormGroup);
      expect(row.get('name')!.value).toBe('Ada');
    });

    it('builds a bare control when the field declares none', () => {
      expect(service.buildArrayRow(undefined, 'x')).toBeInstanceOf(FormControl);
      expect(
        service.buildArrayRow({ id: 'tags', type: 'array', label: { en: 'T' } }, 'x').value,
      ).toBe('x');
    });

    it('leaves a non-object row value alone', () => {
      const row = service.buildArrayRow(rowField(), 'not-an-object');
      expect(row.get('name')!.value).toBeNull();
    });
  });

  describe('getControl', () => {
    it('resolves a bracketed path to exactly one control', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      expect(service.getControl(form, config, '[personal.address.city]')).toBe(
        form.get('personal.address.city'),
      );
    });

    it('prefers the named tab for a bare id', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      expect(service.getControl(form, config, 'phone', 'emergency')).toBe(
        form.get('personal.emergency.phone'),
      );
    });

    it('falls back to the root, then to a recursive search', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      // `deskNumber` lives at the root because its tab is flatData.
      expect(service.getControl(form, config, 'deskNumber')).toBe(form.get('deskNumber'));
      // `phone` is two levels down and no tab was named.
      expect(service.getControl(form, config, 'phone')).toBe(form.get('personal.emergency.phone'));
    });

    it('returns null for a name nothing answers to, and for no form at all', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      expect(service.getControl(form, config, 'nothingHere')).toBeNull();
      expect(service.getControl(form, config, '[work.nothingHere]')).toBeNull();
      expect(service.getControl(null, config, 'firstName')).toBeNull();
    });
  });

  describe('getTabGroup', () => {
    it('finds a tab’s group, and a sub-tab’s', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      expect(service.getTabGroup(form, config, 'personal')).toBe(form.get('personal'));
      expect(service.getTabGroup(form, config, 'emergency')).toBe(form.get('personal.emergency'));
    });

    it('returns the form itself for a flatData tab, which opens no group', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      expect(service.getTabGroup(form, config, 'work')).toBe(form);
    });

    it('returns null without a form, and the root for a tab that is not there', () => {
      const config = CONFIG();
      expect(service.getTabGroup(null, config, 'personal')).toBeNull();
      // `getTabPath` answers `null` for an unknown tab, which reads the same as "no path" —
      // so an unknown tab resolves to the root group, exactly as a flatData one does.
      const form = service.buildForm(config);
      expect(service.getTabGroup(form, config, 'nope')).toBe(form);
    });

    it('returns null when the path runs through something that is not a group', () => {
      const config = CONFIG();
      const form = new FormGroup({ personal: new FormControl('not a group') });
      expect(service.getTabGroup(form, config, 'emergency')).toBeNull();
    });
  });

  describe('extractRecord', () => {
    it('assembles the nested record, honouring flatData', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      form.get('personal.firstName')!.setValue('Ada');
      form.get('deskNumber')!.setValue('4B');

      const record = service.extractRecord(form, config);
      expect(record['personal'].firstName).toBe('Ada');
      expect(record['deskNumber']).toBe('4B');
    });

    it('also writes each field to its declared refererField path', () => {
      const config = CONFIG();
      config.tabs[0].fields![0].refererField = 'legacy.name';
      const form = service.buildForm(config);
      form.get('personal.firstName')!.setValue('Ada');

      expect(service.extractRecord(form, config)['legacy']).toEqual({ name: 'Ada' });
    });

    it('returns an empty record with no form or no config', () => {
      expect(service.extractRecord(null, CONFIG())).toEqual({});
      expect(service.extractRecord(new FormGroup({}), null)).toEqual({});
    });
  });

  describe('patchForm', () => {
    const fieldsById = (config: EntityFormConfig) => {
      const map = new Map<string, NestedFieldConfig>();
      const walk = (fields: NestedFieldConfig[] | undefined) => {
        for (const f of fields ?? []) {
          map.set(f.id, f);
          walk(f.children);
        }
      };
      for (const tab of config.tabs) {
        walk(tab.fields);
        for (const child of tab.children ?? []) walk(child.fields);
      }
      return map;
    };

    it('writes values in, nested and flat', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      service.patchForm(form, config, { personal: { firstName: 'Ada' }, deskNumber: '4B' }, fieldsById(config));

      expect(form.get('personal.firstName')!.value).toBe('Ada');
      expect(form.get('deskNumber')!.value).toBe('4B');
    });

    it('rebuilds an array field’s rows', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      service.patchForm(
        form,
        config,
        { personal: { contacts: [{ name: 'Ada' }, { name: 'Bo' }] } },
        fieldsById(config),
      );

      const rows = form.get('personal.contacts') as FormArray;
      expect(rows.length).toBe(2);
      expect(rows.at(1).get('name')!.value).toBe('Bo');
    });

    it('prefers a value at the field’s refererField path', () => {
      const config = CONFIG();
      config.tabs[0].fields![0].refererField = 'legacy.name';
      const form = service.buildForm(config);
      service.patchForm(
        form,
        config,
        { personal: { firstName: 'ignored' }, legacy: { name: 'Ada' } },
        fieldsById(config),
      );

      expect(form.get('personal.firstName')!.value).toBe('Ada');
    });

    it('reports a top-level key that names a field but reached no control', () => {
      // The flat-record mistake: `{ firstName }` handed to a form nested by tab id. Nothing
      // errors, the field stays empty, and this is the only thing that says so.
      const config = CONFIG();
      const form = service.buildForm(config);
      const unconsumed = service.patchForm(form, config, { firstName: 'Ada' }, fieldsById(config));

      expect(unconsumed).toEqual(['firstName']);
      expect(form.get('personal.firstName')!.value).toBeNull();
    });

    it('does not report record metadata, a tab id, or a key that was consumed', () => {
      const config = CONFIG();
      const form = service.buildForm(config);
      const unconsumed = service.patchForm(
        form,
        config,
        { _id: 'abc', _configVersion: 1, personal: { firstName: 'Ada' }, deskNumber: '4B' },
        fieldsById(config),
      );

      expect(unconsumed).toEqual([]);
    });

    it('does nothing without a form, a config, or data', () => {
      const config = CONFIG();
      expect(service.patchForm(null, config, { a: 1 }, new Map())).toEqual([]);
      expect(service.patchForm(new FormGroup({}), null, { a: 1 }, new Map())).toEqual([]);
      expect(
        service.patchForm(new FormGroup({}), config, undefined as never, new Map()),
      ).toEqual([]);
    });
  });
});
