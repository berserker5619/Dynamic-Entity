import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
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

/**
 * Phase 4a — dismissible info banners and the read-only inputs.
 *
 * The reference's contract for an info banner: it persists until the user dismisses it,
 * not until the triggering value changes.
 */
describe('DynamicRecordFormComponent — banners and read-only', () => {
  const CONFIG: EntityFormConfig = {
    entity: 'clients',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          { id: 'status', type: 'text', label: { en: 'Status' } },
          { id: 'notes', type: 'text', label: { en: 'Notes' } },
        ],
      },
    ],
  };

  const infoRule = (targetId: string, message: string): FormRule => ({
    formConfigId: 'clients',
    fieldId: 'status',
    conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'archived' }],
    action: { type: 'info', value: message },
    targets: [{ id: targetId, type: 'field' }],
    enabled: true,
    priority: 1,
  });

  let fixture: ComponentFixture<DynamicRecordFormComponent>;
  let component: DynamicRecordFormComponent;

  function build(over: Partial<DynamicRecordFormComponent> = {}): void {
    fixture = TestBed.createComponent(DynamicRecordFormComponent);
    component = fixture.componentInstance;
    component.config = CONFIG;
    Object.assign(component, over);
    component.ngOnChanges({ config: new SimpleChange(undefined, CONFIG, true) });
    fixture.detectChanges();
  }

  /** Drive the inner form so the rules engine produces banners. */
  function trigger(value: string): void {
    component.dynamicFormComp!.getControl('status', 'main')!.setValue(value);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent],
      providers: [provideBuiltInFieldTypes()],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows no banners until a rule fires', () => {
    build({ rules: [infoRule('notes', 'Heads up')] });
    expect(component.infoBanners).toEqual([]);
  });

  it('shows an info banner when its rule matches', () => {
    build({ rules: [infoRule('notes', 'Heads up')] });
    trigger('archived');

    expect(component.infoBanners).toEqual([{ fieldId: 'notes', message: 'Heads up' }]);
    expect(fixture.nativeElement.textContent).toContain('Heads up');
  });

  it('hides a banner once dismissed and keeps it hidden while the rule still matches', () => {
    build({ rules: [infoRule('notes', 'Heads up')] });
    trigger('archived');

    component.dismissInfoBanner('notes');
    fixture.detectChanges();

    expect(component.infoBanners).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('Heads up');
  });

  it('dismisses one banner without hiding another', () => {
    build({ rules: [infoRule('notes', 'First'), infoRule('status', 'Second')] });
    trigger('archived');
    expect(component.infoBanners.length).toBe(2);

    component.dismissInfoBanner('notes');
    expect(component.infoBanners.map(b => b.message)).toEqual(['Second']);
  });

  it('re-arms dismissed banners when a different record is loaded', () => {
    build({ rules: [infoRule('notes', 'Heads up')] });
    trigger('archived');
    component.dismissInfoBanner('notes');
    expect(component.infoBanners).toEqual([]);

    component.initialData = { main: { status: 'archived' } };
    component.ngOnChanges({ initialData: new SimpleChange(undefined, component.initialData, false) });
    fixture.detectChanges();

    expect(component.infoBanners.map(b => b.message)).toEqual(['Heads up']);
  });

  describe('read-only inputs', () => {
    it('recordReadOnly is driven by either readonly or isReadOnly', () => {
      build();
      expect(component.recordReadOnly).toBe(false);

      build({ isReadOnly: true });
      expect(component.recordReadOnly).toBe(true);

      build({ readonly: true });
      expect(component.recordReadOnly).toBe(true);
    });

    it('forces only the named fields read-only', () => {
      build({ readOnlyFields: ['status'] });
      // viewMode defaults on, so open the section before checking per-field state.
      component.editSection();
      fixture.detectChanges();
      const form = component.dynamicFormComp!;

      expect(form.isFieldReadonly(CONFIG.tabs[0].fields![0])).toBe(true);
      expect(form.isFieldReadonly(CONFIG.tabs[0].fields![1])).toBe(false);
    });

    it('isReadOnly makes every field read-only', () => {
      build({ isReadOnly: true });
      const form = component.dynamicFormComp!;

      expect(form.isFieldReadonly(CONFIG.tabs[0].fields![0])).toBe(true);
      expect(form.isFieldReadonly(CONFIG.tabs[0].fields![1])).toBe(true);
    });
  });
});

/**
 * Phase 4b — per-tab section editing. One tab is edited at a time and validated on its own,
 * so a required field on an untouched tab cannot block the tab you are working on.
 */
describe('DynamicRecordFormComponent — section editing', () => {
  const CONFIG: EntityFormConfig = {
    entity: 'clients',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          { id: 'name', type: 'text', label: { en: 'Name' }, validators: { required: true } },
          { id: 'nick', type: 'text', label: { en: 'Nick' } },
        ],
      },
      {
        id: 'other',
        label: { en: 'Other' },
        fields: [{ id: 'code', type: 'text', label: { en: 'Code' }, validators: { required: true } }],
      },
    ],
  };

  let fixture: ComponentFixture<DynamicRecordFormComponent>;
  let component: DynamicRecordFormComponent;

  /** viewMode defaults on; set explicitly so these specs do not depend on the default. */
  function build(over: Partial<DynamicRecordFormComponent> = {}, data?: Record<string, unknown>): void {
    fixture = TestBed.createComponent(DynamicRecordFormComponent);
    component = fixture.componentInstance;
    component.config = CONFIG;
    component.initialData = data;
    component.viewMode = true;
    Object.assign(component, over);
    component.ngOnChanges({ config: new SimpleChange(undefined, CONFIG, true) });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent],
      providers: [provideBuiltInFieldTypes()],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('viewMode off', () => {
    it('is directly editable, with no section bar', () => {
      build({ viewMode: false });

      expect(component.isEditingActiveTab).toBe(true);
      expect(component.sectionReadOnly).toBe(false);
      expect(fixture.nativeElement.querySelector('[data-testid="edit-section"]')).toBeNull();
    });

    it('still honours a read-only record', () => {
      build({ viewMode: false, isReadOnly: true });
      expect(component.sectionReadOnly).toBe(true);
    });

    it('ignores editSection()', () => {
      build({ viewMode: false });
      component.editSection();
      expect(component.editingTabId()).toBeNull();
    });
  });

  it('starts in view mode, with fields read-only', () => {
    build();
    expect(component.editingTabId()).toBeNull();
    expect(component.isEditingActiveTab).toBe(false);
    expect(component.sectionReadOnly).toBe(true);
  });

  it('opens the active tab for editing', () => {
    build();
    component.editSection();

    expect(component.editingTabId()).toBe('main');
    expect(component.sectionReadOnly).toBe(false);
  });

  it('refuses to open a read-only record', () => {
    build({ isReadOnly: true });
    component.editSection();
    expect(component.editingTabId()).toBeNull();
  });

  it('saves a valid section and emits it with the tab id', () => {
    build({}, { main: { name: 'Acme' } });
    const saved: { tabId: string; record: Record<string, any> }[] = [];
    component.sectionSave.subscribe(e => saved.push(e));

    component.editSection();
    component.saveSection();

    expect(saved.length).toBe(1);
    expect(saved[0].tabId).toBe('main');
    expect(saved[0].record.main.name).toBe('Acme');
    expect(component.editingTabId()).toBeNull();
  });

  it('blocks the save and reports the invalid field', () => {
    build();
    const saved: unknown[] = [];
    component.sectionSave.subscribe(e => saved.push(e));

    component.editSection();
    component.saveSection();

    expect(saved).toEqual([]);
    expect(component.editingTabId()).toBe('main');
    expect(component.sectionErrors()['name']).toContain('Name');
  });

  it('ignores an invalid field on a tab that is not being edited', () => {
    // `code` on the "other" tab is required and empty; saving "main" must not care.
    build({}, { main: { name: 'Acme' } });
    const saved: unknown[] = [];
    component.sectionSave.subscribe(e => saved.push(e));

    component.editSection();
    component.saveSection();

    expect(saved.length).toBe(1);
  });

  it('restores the baseline on cancel', () => {
    build({}, { main: { name: 'Acme', nick: 'AC' } });
    component.editSection();

    component.dynamicFormComp!.getControl('name', 'main')!.setValue('Changed');
    component.cancelSection();

    expect(component.dynamicFormComp!.getControl('name', 'main')!.value).toBe('Acme');
    expect(component.editingTabId()).toBeNull();
  });

  it('clears stale errors when editing is re-opened', () => {
    build();
    component.editSection();
    component.saveSection();
    expect(Object.keys(component.sectionErrors()).length).toBe(1);

    component.editSection();
    expect(component.sectionErrors()).toEqual({});
  });

  it('clears errors on cancel', () => {
    build();
    component.editSection();
    component.saveSection();

    component.cancelSection();
    expect(component.sectionErrors()).toEqual({});
  });
});

/**
 * Phase 4c — inline array-row editing. Rows are edited in a drawer rendered outside the tab
 * panel, and only pushed into the FormArray on save.
 */
describe('DynamicRecordFormComponent — array row drawer', () => {
  const CONFIG: EntityFormConfig = {
    entity: 'employees',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          {
            id: 'addresses',
            type: 'array',
            label: { en: 'Addresses' },
            children: [
              { id: 'street', type: 'text', label: { en: 'Street' }, validators: { required: true } },
              { id: 'city', type: 'text', label: { en: 'City' } },
            ],
          },
        ],
      },
    ],
  };

  let fixture: ComponentFixture<DynamicRecordFormComponent>;
  let component: DynamicRecordFormComponent;

  function build(data?: Record<string, unknown>): void {
    fixture = TestBed.createComponent(DynamicRecordFormComponent);
    component = fixture.componentInstance;
    component.config = CONFIG;
    component.initialData = data;
    component.ngOnChanges({ config: new SimpleChange(undefined, CONFIG, true) });
    fixture.detectChanges();
    component.editSection();
    fixture.detectChanges();
  }

  const arrayField = () => CONFIG.tabs[0].fields![0];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent],
      providers: [provideBuiltInFieldTypes()],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('lists existing rows', () => {
    build({ main: { addresses: [{ street: '1 Main St', city: 'Berlin' }] } });

    expect(component.rowsOf(arrayField()).length).toBe(1);
    expect(component.rowSummary(arrayField(), component.rowsOf(arrayField())[0])).toContain('1 Main St');
  });

  it('opens an empty drawer for a new row', () => {
    build();
    component.openAddRow(arrayField());

    expect(component.inlineRowField()?.id).toBe('addresses');
    expect(component.inlineRowIndex()).toBeNull();
    expect(component.inlineRowForm!.value).toEqual({ street: null, city: null });
  });

  it('does not push the row until save', () => {
    build();
    component.openAddRow(arrayField());
    component.inlineRowForm!.patchValue({ street: '9 Elm', city: 'Munich' });

    expect(component.rowsOf(arrayField()).length).toBe(0);

    component.saveRow();
    expect(component.rowsOf(arrayField()).length).toBe(1);
    expect(component.rowsOf(arrayField())[0]).toEqual({ street: '9 Elm', city: 'Munich' });
  });

  it('refuses to save an invalid row and keeps the drawer open', () => {
    build();
    component.openAddRow(arrayField());
    component.inlineRowForm!.patchValue({ city: 'Munich' }); // street is required

    component.saveRow();

    expect(component.rowsOf(arrayField()).length).toBe(0);
    expect(component.inlineRowField()).not.toBeNull();
  });

  it('edits an existing row in place', () => {
    build({ main: { addresses: [{ street: '1 Main St', city: 'Berlin' }] } });
    component.openEditRow(arrayField(), 0);

    expect(component.inlineRowIndex()).toBe(0);
    expect(component.inlineRowForm!.value).toEqual({ street: '1 Main St', city: 'Berlin' });

    component.inlineRowForm!.patchValue({ street: '2 Oak Ave' });
    component.saveRow();

    expect(component.rowsOf(arrayField()).length).toBe(1);
    expect(component.rowsOf(arrayField())[0].street).toBe('2 Oak Ave');
  });

  it('leaves the array untouched on cancel', () => {
    build({ main: { addresses: [{ street: '1 Main St', city: 'Berlin' }] } });
    component.openEditRow(arrayField(), 0);
    component.inlineRowForm!.patchValue({ street: 'Changed' });

    component.cancelRow();

    expect(component.rowsOf(arrayField())[0].street).toBe('1 Main St');
    expect(component.inlineRowField()).toBeNull();
  });

  it('deletes a row', () => {
    build({ main: { addresses: [{ street: 'A' }, { street: 'B' }] } });
    component.deleteRow(arrayField(), 0);

    expect(component.rowsOf(arrayField()).map(r => r.street)).toEqual(['B']);
  });

  it('closes the drawer when the row being edited is deleted', () => {
    build({ main: { addresses: [{ street: 'A' }] } });
    component.openEditRow(arrayField(), 0);
    component.deleteRow(arrayField(), 0);

    expect(component.inlineRowField()).toBeNull();
  });

  it('does nothing while the section is read-only', () => {
    build({ main: { addresses: [{ street: 'A' }] } });
    component.cancelSection();

    component.openAddRow(arrayField());
    expect(component.inlineRowField()).toBeNull();

    component.deleteRow(arrayField(), 0);
    expect(component.rowsOf(arrayField()).length).toBe(1);
  });

  it('surfaces the saved row in the extracted record', () => {
    build();
    component.openAddRow(arrayField());
    component.inlineRowForm!.patchValue({ street: '9 Elm', city: 'Munich' });
    component.saveRow();

    const record = component.dynamicFormComp!.extractRecord();
    expect(record.main.addresses).toEqual([{ street: '9 Elm', city: 'Munich' }]);
  });
});

/** Phase 4d — header fields driven by `isProfileImage` and `isHeaderToggle`. */
describe('DynamicRecordFormComponent — header fields', () => {
  const CONFIG: EntityFormConfig = {
    entity: 'employees',
    name: { en: 'Employee' },
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          { id: 'photo', type: 'image', label: { en: 'Photo' }, isProfileImage: true },
          { id: 'active', type: 'boolean', label: { en: 'Active' }, isHeaderToggle: true },
          { id: 'name', type: 'text', label: { en: 'Name' } },
        ],
      },
    ],
  };

  let fixture: ComponentFixture<DynamicRecordFormComponent>;
  let component: DynamicRecordFormComponent;

  function build(data?: Record<string, unknown>, over: Partial<DynamicRecordFormComponent> = {}): void {
    fixture = TestBed.createComponent(DynamicRecordFormComponent);
    component = fixture.componentInstance;
    component.config = CONFIG;
    component.initialData = data;
    Object.assign(component, over);
    component.ngOnChanges({ config: new SimpleChange(undefined, CONFIG, true) });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent],
      providers: [provideBuiltInFieldTypes()],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('finds the flagged header fields', () => {
    build();
    expect(component.headerProfileField?.id).toBe('photo');
    expect(component.headerToggleField?.id).toBe('active');
  });

  it('falls back to the initial letter with no profile image', () => {
    build();
    expect(component.profileImageUrl).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="header-avatar-initial"]')).not.toBeNull();
  });

  it('renders the avatar from a persisted FileRef', () => {
    build({ main: { photo: { url: 'https://cdn/a.png' } } });

    expect(component.profileImageUrl).toBe('https://cdn/a.png');
    const img = fixture.nativeElement.querySelector('[data-testid="header-profile-image"]');
    expect(img.getAttribute('src')).toBe('https://cdn/a.png');
  });

  it('reflects and flips the header toggle', () => {
    build({ main: { active: true } });
    expect(component.headerToggleValue).toBe(true);

    component.toggleHeaderStatus();
    expect(component.headerToggleValue).toBe(false);
    expect(component.dynamicFormComp!.getControl('active', 'main')!.value).toBe(false);
  });

  it('flips the toggle even though the section is not being edited', () => {
    // A record-level status switch, not part of any one tab's section.
    build({ main: { active: false } });
    expect(component.isEditingActiveTab).toBe(false);

    component.toggleHeaderStatus();
    expect(component.headerToggleValue).toBe(true);
  });

  it('refuses to flip a read-only record', () => {
    build({ main: { active: false } }, { isReadOnly: true });
    component.toggleHeaderStatus();
    expect(component.headerToggleValue).toBe(false);
  });

  it('renders no toggle when no field is flagged', () => {
    const plain: EntityFormConfig = {
      entity: 'x',
      tabs: [{ id: 'main', label: { en: 'M' }, fields: [{ id: 'a', type: 'text', label: { en: 'A' } }] }],
    };
    fixture = TestBed.createComponent(DynamicRecordFormComponent);
    component = fixture.componentInstance;
    component.config = plain;
    component.ngOnChanges({ config: new SimpleChange(undefined, plain, true) });
    fixture.detectChanges();

    expect(component.headerToggleField).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="header-toggle"]')).toBeNull();
  });
});
