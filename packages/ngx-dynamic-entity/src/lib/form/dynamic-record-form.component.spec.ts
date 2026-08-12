import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { DynamicRecordFormComponent } from './dynamic-record-form.component';

const config: EntityFormConfig = {
  entity: 'clients',
  name: { en: 'Client', de: 'Kunde' },
  tabs: [
    {
      id: 'general',
      label: { en: 'General' },
      fields: [
        { id: 'name', type: 'text', label: { en: 'Name' }, showOnMinimize: true },
        {
          id: 'status',
          type: 'dropdown',
          label: { en: 'Status' },
          showOnMinimize: true,
          options: [
            { en: 'Active', de: 'Aktiv' },
            { en: 'Inactive' },
          ],
        },
        { id: 'notes', type: 'textarea', label: { en: 'Notes' } },
      ],
    },
    {
      id: 'meta',
      label: { en: 'Meta' },
      fields: [{ id: 'archived', type: 'boolean', label: { en: 'Archived' }, showOnMinimize: true }],
      children: [
        {
          id: 'nested',
          label: { en: 'Nested' },
          fields: [{ id: 'deep', type: 'text', label: { en: 'Deep' }, showOnMinimize: true }],
        },
      ],
    },
  ],
};

describe('DynamicRecordFormComponent', () => {
  let fixture: ComponentFixture<DynamicRecordFormComponent>;
  let component: DynamicRecordFormComponent;

  function build(initialData?: Record<string, unknown>): void {
    fixture = TestBed.createComponent(DynamicRecordFormComponent);
    component = fixture.componentInstance;
    component.config = config;
    component.initialData = initialData;
    component.ngOnChanges({ config: new SimpleChange(undefined, config, true) });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent],
      providers: [provideBuiltInFieldTypes()],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('header', () => {
    it('resolves the record title from the localized config name', () => {
      build();
      expect(component.recordTitle).toBe('Client');

      component.language = 'de';
      expect(component.recordTitle).toBe('Kunde');
    });

    it('falls back to the entity key when the config has no name', () => {
      fixture = TestBed.createComponent(DynamicRecordFormComponent);
      component = fixture.componentInstance;
      component.config = { entity: 'orders', tabs: [] };
      expect(component.recordTitle).toBe('orders');
    });

    it('returns a placeholder title before a config arrives', () => {
      fixture = TestBed.createComponent(DynamicRecordFormComponent);
      expect(fixture.componentInstance.recordTitle).toBe('Record');
    });

    it('derives the avatar letter from the title', () => {
      build();
      expect(component.avatarLetter).toBe('C');
    });
  });

  describe('session baseline', () => {
    it('seeds the baseline from the loaded record, not the first keystroke', () => {
      build({ name: 'Acme', status: { en: 'Active', de: 'Aktiv' } });

      expect(component.originalBaseline()).toEqual({ name: 'Acme', status: { en: 'Active', de: 'Aktiv' } });
      expect(component.isModified()).toBe(false);
    });

    it('reports a modification once the data diverges', () => {
      build({ name: 'Acme' });
      component.onFormChange({ name: 'Acme Corp' });

      expect(component.isModified()).toBe(true);
    });

    it('adopts the first emitted shape as the baseline in a create flow', () => {
      build();
      expect(component.originalBaseline()).toEqual({});

      component.onFormChange({ name: null });
      expect(component.originalBaseline()).toEqual({ name: null });
      expect(component.isModified()).toBe(false);
    });

    it('does not overwrite an established baseline on later changes', () => {
      build({ name: 'Acme' });
      component.onFormChange({ name: 'Changed' });
      component.onFormChange({ name: 'Changed again' });

      expect(component.originalBaseline()).toEqual({ name: 'Acme' });
    });

    it('re-seeds when a different record is loaded', () => {
      build({ name: 'Acme' });
      component.initialData = { name: 'Globex' };
      component.ngOnChanges({ initialData: new SimpleChange({ name: 'Acme' }, { name: 'Globex' }, false) });

      expect(component.originalBaseline()).toEqual({ name: 'Globex' });
      expect(component.isModified()).toBe(false);
    });
  });

  describe('summary panel', () => {
    it('collects showOnMinimize fields across tabs and nested tabs', () => {
      build();
      expect(component.summaryFields().map(f => f.id)).toEqual(['name', 'status', 'archived', 'deep']);
    });

    it('formats summary values through the shared core formatter', () => {
      build({ status: { en: 'Active', de: 'Aktiv' }, archived: true });

      const status = component.summaryFields().find(f => f.id === 'status')!;
      const archived = component.summaryFields().find(f => f.id === 'archived')!;

      expect(component.formatFieldValue(status)).toBe('Active');
      expect(component.formatFieldValue(archived)).toBe('Yes');
    });

    it('honours the active language when formatting option labels', () => {
      build({ status: { en: 'Active', de: 'Aktiv' } });
      component.language = 'de';

      const status = component.summaryFields().find(f => f.id === 'status')!;
      expect(component.formatFieldValue(status)).toBe('Aktiv');
    });

    it('renders an em dash for an empty value', () => {
      build();
      const name = component.summaryFields()[0];
      expect(component.formatFieldValue(name)).toBe('—');
    });

    it('resolves summary labels for the active language', () => {
      build();
      expect(component.formatFieldLabel(component.summaryFields()[0])).toBe('Name');
    });
  });

  describe('outputs', () => {
    it('re-emits form change, submit, and reset', () => {
      build();
      const changes: unknown[] = [];
      const submits: unknown[] = [];
      let resets = 0;

      component.formChange.subscribe(v => changes.push(v));
      component.formSubmit.subscribe(v => submits.push(v));
      component.formReset.subscribe(() => resets++);

      component.onFormChange({ name: 'x' });
      component.onFormSubmit({ name: 'x' });
      component.onFormReset();

      expect(changes).toEqual([{ name: 'x' }]);
      expect(submits).toEqual([{ name: 'x' }]);
      expect(resets).toBe(1);
    });
  });

  describe('jumpToField', () => {
    it('switches to the tab owning the field', () => {
      build();
      const setActiveTab = jest.spyOn(component.dynamicFormComp!, 'setActiveTab');

      component.jumpToField('archived');

      expect(setActiveTab).toHaveBeenCalledWith('meta');
    });

    it('does nothing for an unknown field', () => {
      build();
      const setActiveTab = jest.spyOn(component.dynamicFormComp!, 'setActiveTab');

      component.jumpToField('nope');

      expect(setActiveTab).not.toHaveBeenCalled();
    });
  });
});
