import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormArray, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
import { DynamicFormComponent } from './dynamic-form.component';
import { EntityRefSelectionService } from '../services/entity-ref-selection.service';
import { HookRegistryService } from '../services/hook-registry.service';
import { RbacService } from '../services/rbac.service';
import { ValidatorRegistryService } from '../services/validator-registry.service';

const mockConfig: EntityFormConfig = {
  entity: 'clients',
  version: 1,
  tabs: [
    {
      id: 'tab1',
      label: { en: 'Tab 1' },
      fields: [
        {
          id: 'name',
          type: 'text',
          label: { en: 'Name' },
          validators: { required: true },
          defaultValue: 'Default',
        },
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
          children: [{ id: 'phone', type: 'text', label: { en: 'Phone' } }],
        },
      ],
    },
    {
      id: 'tab2',
      label: { en: 'Tab 2' },
      fields: [{ id: 'age', type: 'number', label: { en: 'Age' } }],
    },
  ],
};

describe('DynamicFormComponent', () => {
  let component: DynamicFormComponent;
  let fixture: ComponentFixture<DynamicFormComponent>;
  let mockHookRegistry: { run: jest.Mock; has: jest.Mock };

  /**
   * Angular only fires ngOnChanges for template-bound inputs; these specs drive the
   * component directly, so the first change has to be announced by hand.
   */
  function build(config: EntityFormConfig = mockConfig): void {
    fixture = TestBed.createComponent(DynamicFormComponent);
    component = fixture.componentInstance;
    component.config = config;
    component.ngOnInit();
    component.ngOnChanges({ config: new SimpleChange(undefined, config, true) });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    mockHookRegistry = {
      run: jest.fn().mockImplementation((_k, d) => Promise.resolve(d)),
      has: jest.fn().mockReturnValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [
        {
          provide: ValidatorRegistryService,
          useValue: { resolveAll: jest.fn().mockReturnValue([]), resolveFromConfig: jest.fn().mockReturnValue([]) },
        },
        { provide: HookRegistryService, useValue: mockHookRegistry },
        { provide: RbacService, useValue: { getPermissions: jest.fn().mockReturnValue({ canEdit: true }) } },
      ],
    }).compileComponents();

    build();
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('form construction', () => {
    it('builds nested group and array controls from the config', () => {
      expect(component.getControl('name')).toBeDefined();
      expect(component.getControl('address') instanceof FormGroup).toBe(true);
      expect(component.getControl('city')).toBeDefined();
      expect(component.getControl('contacts') instanceof FormArray).toBe(true);
    });

    it('seeds controls from defaultValue', () => {
      expect(component.getControl('name')?.value).toBe('Default');
    });

    it('patches initial data including groups and array rows', () => {
      component.initialData = {
        tab1: {
          name: 'John',
          address: { city: 'Berlin' },
          contacts: [{ phone: '123-456' }, { phone: '789-012' }],
        },
        tab2: { age: 30 },
      };
      component.ngOnChanges({ initialData: new SimpleChange(null, component.initialData, true) });

      expect(component.getControl('name')?.value).toBe('John');
      expect(component.getControl('city')?.value).toBe('Berlin');

      const contacts = component.getControl('contacts') as FormArray;
      expect(contacts.length).toBe(2);
      expect(contacts.at(0).get('phone')?.value).toBe('123-456');
    });

    it('honors flatData and refererField overrides', () => {
      const flatConfig: EntityFormConfig = {
        entity: 'employees',
        tabs: [
          {
            id: 'personal',
            flatData: true,
            label: { en: 'Personal' },
            fields: [{ id: 'firstName', type: 'text', label: { en: 'First Name' } }],
          },
          {
            id: 'job',
            label: { en: 'Job' },
            fields: [
              {
                id: 'title',
                type: 'text',
                label: { en: 'Title' },
                refererField: 'employment.jobTitle',
              },
            ],
          },
        ],
      };
      build(flatConfig);

      component.initialData = {
        firstName: 'Alice',
        employment: { jobTitle: 'Engineer' },
      };
      component.ngOnChanges({ initialData: new SimpleChange(null, component.initialData, true) });

      expect(component.getControl('firstName')?.value).toBe('Alice');
      expect(component.getControl('title')?.value).toBe('Engineer');

      component.getControl('firstName')?.patchValue('Bob');
      component.getControl('title')?.patchValue('Senior Engineer');

      const rec = component.extractRecord();
      expect(rec.firstName).toBe('Bob');
      expect(rec.employment?.jobTitle).toBe('Senior Engineer');
    });

    it('does not stack valueChanges subscriptions across rebuilds', () => {
      const emissions: unknown[] = [];
      component.formChange.subscribe(v => emissions.push(v));

      component.ngOnChanges({ config: new SimpleChange(null, mockConfig, false) });
      component.getControl('name')?.patchValue('once');

      expect(emissions.length).toBe(1);
    });
  });

  describe('tabs and visibility', () => {
    it('filters fields to the active tab', () => {
      component.setActiveTab('tab1');
      expect(component.fieldsForActiveTab.map(f => f.id)).toEqual(['name', 'address', 'contacts']);

      component.setActiveTab('tab2');
      expect(component.fieldsForActiveTab.map(f => f.id)).toEqual(['age']);
    });

    it('applies static showWhen conditions', () => {
      build({
        entity: 'x',
        tabs: [
          {
            id: 't',
            label: { en: 'T' },
            fields: [
              { id: 'isEmployee', type: 'boolean', label: { en: 'Employee' } },
              { id: 'staffId', type: 'text', label: { en: 'Staff Id' }, showWhen: { isEmployee: true } },
            ],
          },
        ],
      });

      expect(component.fieldsForActiveTab.map(f => f.id)).toEqual(['isEmployee']);

      component.getControl('isEmployee')?.patchValue(true);
      expect(component.fieldsForActiveTab.map(f => f.id)).toEqual(['isEmployee', 'staffId']);
    });

    it('hides fields targeted by a visibility rule', () => {
      const rules: FormRule[] = [
        {
          formConfigId: 'clients',
          fieldId: 'name',
          conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'hide-me' }],
          action: { type: 'visibility', value: false },
          targets: [{ id: 'address', type: 'field' }],
          enabled: true,
          priority: 1,
        },
      ];
      component.rules = rules;
      component.setActiveTab('tab1');
      component.getControl('name')?.patchValue('hide-me');

      expect(component.fieldsForActiveTab.map(f => f.id)).not.toContain('address');
    });
  });

  describe('criticalField locking', () => {
    beforeEach(() => {
      build({
        entity: 'x',
        tabs: [
          {
            id: 't',
            label: { en: 'T' },
            fields: [{ id: 'iban', type: 'text', label: { en: 'IBAN' }, criticalField: true }],
          },
        ],
      });
    });

    it('starts locked and unlocks on toggle', () => {
      const field = component.fieldsForActiveTab[0];
      expect(component.isFieldLocked(field)).toBe(true);

      component.toggleFieldLock(field);
      expect(component.isFieldLocked(field)).toBe(false);
    });

    it('refuses to unlock a readonly form', () => {
      component.readonly = true;
      const field = component.fieldsForActiveTab[0];
      component.toggleFieldLock(field);
      expect(component.isFieldLocked(field)).toBe(true);
    });

    it('reports a critical change against the session baseline', () => {
      component.ngOnChanges({ initialData: new SimpleChange(null, { t: { iban: 'DE00' } }, true) });
      expect(component.changedCriticalFields()).toEqual([]);

      component.getControl('iban')?.patchValue('DE99');
      expect(component.changedCriticalFields().map(f => f.id)).toEqual(['iban']);
    });

    it('re-locks everything on reset', () => {
      const field = component.fieldsForActiveTab[0];
      component.toggleFieldLock(field);
      component.reset();
      expect(component.isFieldLocked(field)).toBe(true);
    });
  });

  describe('autoPatch and patchOnTrue', () => {
    it('copies mapped values from a selected entity-ref record', () => {
      build({
        entity: 'x',
        tabs: [
          {
            id: 'main',
            label: { en: 'Main' },
            fields: [
              {
                id: 'company',
                type: 'entity-ref',
                label: { en: 'Company' },
                autoPatch: {
                  targetTab: 'main',
                  mappings: [
                    { source: 'city', target: 'city' },
                    { source: 'vat', target: 'vat' },
                  ],
                },
              },
              { id: 'city', type: 'text', label: { en: 'City' } },
              { id: 'vat', type: 'text', label: { en: 'VAT' } },
            ],
          },
        ],
      });

      TestBed.inject(EntityRefSelectionService);
      fixture.debugElement.injector
        .get(EntityRefSelectionService)
        .emit('company', { value: 'c1', label: 'Acme', record: { city: 'Berlin', vat: 'DE123' } });

      expect(component.getControl('city')?.value).toBe('Berlin');
      expect(component.getControl('vat')?.value).toBe('DE123');
    });

    it('ignores autoPatch targets that are not on the configured tab', () => {
      build({
        entity: 'x',
        tabs: [
          {
            id: 'main',
            label: { en: 'Main' },
            fields: [
              {
                id: 'company',
                type: 'entity-ref',
                label: { en: 'Company' },
                autoPatch: { targetTab: 'other', mappings: [{ source: 'city', target: 'city' }] },
              },
              { id: 'city', type: 'text', label: { en: 'City' } },
            ],
          },
          { id: 'other', label: { en: 'Other' }, fields: [] },
        ],
      });

      fixture.debugElement.injector
        .get(EntityRefSelectionService)
        .emit('company', { value: 'c1', label: 'Acme', record: { city: 'Berlin' } });

      expect(component.getControl('city')?.value).toBeNull();
    });

    it('copies from → to when a boolean flips to true, once', () => {
      build({
        entity: 'x',
        tabs: [
          {
            id: 'main',
            label: { en: 'Main' },
            fields: [
              { id: 'billingSame', type: 'boolean', label: { en: 'Same' }, patchOnTrue: [{ from: 'home', to: 'billing' }] },
              { id: 'home', type: 'text', label: { en: 'Home' } },
              { id: 'billing', type: 'text', label: { en: 'Billing' } },
            ],
          },
        ],
      });

      component.getControl('home')?.patchValue('Main St');
      component.getControl('billingSame')?.patchValue(true);
      expect(component.getControl('billing')?.value).toBe('Main St');

      // Editing the target afterwards must not be overwritten while the flag stays true.
      component.getControl('billing')?.patchValue('Other St');
      component.getControl('home')?.patchValue('Changed St');
      expect(component.getControl('billing')?.value).toBe('Other St');
    });
  });

  describe('submission', () => {
    it('runs the beforeSave hook and emits the processed data', async () => {
      const spy = jest.spyOn(component.formSubmit, 'emit');
      component.getControl('name')?.patchValue('Submit Test');

      await component.submit();

      expect(mockHookRegistry.run).toHaveBeenCalledWith('clients:beforeSave', expect.anything());
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          tab1: expect.objectContaining({ name: 'Submit Test' }),
        }),
      );
    });

    it('allows submit when editable', () => {
      expect(component.canSubmit).toBe(true);
    });

    it('emits formReset on reset', () => {
      const spy = jest.spyOn(component.formReset, 'emit');
      component.reset();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('nested sub-tabs and module tabs (Phase 3)', () => {
    it('switches sub-tabs and resolves fields for active sub-tab', () => {
      build({
        entity: 'parent_entity',
        tabs: [
          {
            id: 'parentTab',
            label: { en: 'Parent' },
            children: [
              {
                id: 'childTab1',
                label: { en: 'Child 1' },
                fields: [{ id: 'field1', type: 'text', label: { en: 'Field 1' } }],
              },
              {
                id: 'childTab2',
                label: { en: 'Child 2' },
                fields: [{ id: 'field2', type: 'text', label: { en: 'Field 2' } }],
              },
            ],
          },
        ],
      });

      expect(component.visibleSubTabs.map(t => t.id)).toEqual(['childTab1', 'childTab2']);
      expect(component.activeSubTabConfig?.id).toBe('childTab1');
      expect(component.fieldsForActiveTab.map(f => f.id)).toEqual(['field1']);

      component.setActiveSubTab('childTab2');
      expect(component.activeSubTabConfig?.id).toBe('childTab2');
      expect(component.fieldsForActiveTab.map(f => f.id)).toEqual(['field2']);
    });
  });
});

/**
 * The same field id may legitimately appear on two different tabs — `test_data.json`'s
 * employees config has `gender` on both `primaryDetails` and `personalDetails`. Since
 * phase 1 gave each tab its own FormGroup, the record stores them separately. These pin
 * that, and the one place where the id alone is still ambiguous.
 */
describe('DynamicFormComponent — duplicate field ids across tabs', () => {
  const DUPES: EntityFormConfig = {
    entity: 'employees',
    tabs: [
      {
        id: 'primaryDetails',
        label: { en: 'Primary' },
        fields: [{ id: 'gender', type: 'text', label: { en: 'Gender' } }],
      },
      {
        id: 'personalDetails',
        label: { en: 'Personal' },
        fields: [{ id: 'gender', type: 'text', label: { en: 'Gender' } }],
      },
    ],
  };

  let fixture: ComponentFixture<DynamicFormComponent>;
  let component: DynamicFormComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [
        {
          provide: ValidatorRegistryService,
          useValue: { resolveAll: jest.fn().mockReturnValue([]), resolveFromConfig: jest.fn().mockReturnValue([]) },
        },
        { provide: HookRegistryService, useValue: { run: jest.fn(), has: jest.fn().mockReturnValue(false) } },
        { provide: RbacService, useValue: { getPermissions: jest.fn().mockReturnValue({ canEdit: true }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicFormComponent);
    component = fixture.componentInstance;
    component.config = DUPES;
    component.ngOnInit();
    component.ngOnChanges({ config: new SimpleChange(undefined, DUPES, true) });
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('builds one control per tab, not one shared control', () => {
    expect(component.form.get('primaryDetails.gender')).toBeTruthy();
    expect(component.form.get('personalDetails.gender')).toBeTruthy();
    expect(component.form.get('primaryDetails.gender')).not.toBe(
      component.form.get('personalDetails.gender'),
    );
  });

  it('keeps the two values independent', () => {
    component.form.get('primaryDetails.gender')!.setValue('F');
    component.form.get('personalDetails.gender')!.setValue('M');

    expect(component.form.get('primaryDetails.gender')!.value).toBe('F');
    expect(component.form.get('personalDetails.gender')!.value).toBe('M');
  });

  it('loads each tab\u2019s value into its own control', () => {
    const data = { primaryDetails: { gender: 'F' }, personalDetails: { gender: 'M' } };
    component.initialData = data;
    component.ngOnChanges({ initialData: new SimpleChange(undefined, data, true) });

    expect(component.form.get('primaryDetails.gender')!.value).toBe('F');
    expect(component.form.get('personalDetails.gender')!.value).toBe('M');
  });

  it('resolves the right control when the tab is named', () => {
    component.form.get('primaryDetails.gender')!.setValue('F');
    component.form.get('personalDetails.gender')!.setValue('M');

    expect(component.getControl('gender', 'primaryDetails')!.value).toBe('F');
    expect(component.getControl('gender', 'personalDetails')!.value).toBe('M');
  });

  it('falls back to the first match when the id alone is given', () => {
    // Known ambiguity: without a tab, a duplicated id resolves to whichever tab comes
    // first. Everything on the record path passes the tab; this only affects the
    // id-only callers (autoPatch/patchOnTrue targets and the rules value bag), where a
    // duplicated id cannot express which tab was meant.
    component.form.get('primaryDetails.gender')!.setValue('F');
    component.form.get('personalDetails.gender')!.setValue('M');

    expect(component.getControl('gender')!.value).toBe('F');
  });
});

/** Phase 4e — debounced change emission and builder preview mode. */
describe('DynamicFormComponent — debounce and preview', () => {
  const CONFIG: EntityFormConfig = {
    entity: 'x',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          { id: 'name', type: 'text', label: { en: 'Name' } },
          {
            id: 'rows',
            type: 'array',
            label: { en: 'Rows' },
            children: [{ id: 'a', type: 'text', label: { en: 'A' } }],
          },
        ],
      },
    ],
  };

  let fixture: ComponentFixture<DynamicFormComponent>;
  let component: DynamicFormComponent;

  function build(over: Partial<DynamicFormComponent> = {}): void {
    fixture = TestBed.createComponent(DynamicFormComponent);
    component = fixture.componentInstance;
    component.config = CONFIG;
    Object.assign(component, over);
    component.ngOnInit();
    component.ngOnChanges({ config: new SimpleChange(undefined, CONFIG, true) });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [
        {
          provide: ValidatorRegistryService,
          useValue: { resolveAll: jest.fn().mockReturnValue([]), resolveFromConfig: jest.fn().mockReturnValue([]) },
        },
        { provide: HookRegistryService, useValue: { run: jest.fn(), has: jest.fn().mockReturnValue(false) } },
        { provide: RbacService, useValue: { getPermissions: jest.fn().mockReturnValue({ canEdit: true }) } },
      ],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('emits synchronously by default', () => {
    build();
    const seen: unknown[] = [];
    component.formChange.subscribe(v => seen.push(v));

    component.getControl('name', 'main')!.setValue('a');
    expect(seen.length).toBe(1);
  });

  it('coalesces rapid changes when a debounce is set', fakeAsync(() => {
    build({ changeDebounceMs: 300 });
    const seen: unknown[] = [];
    component.formChange.subscribe(v => seen.push(v));

    const name = component.getControl('name', 'main')!;
    name.setValue('a');
    name.setValue('ab');
    name.setValue('abc');
    expect(seen.length).toBe(0);

    tick(300);
    expect(seen.length).toBe(1);

    component.ngOnDestroy();
  }));

  describe('preview', () => {
    it('seeds one empty row per array field so the structure is visible', () => {
      build({ preview: true });
      expect(component.getArrayControl('rows', 'main')!.length).toBe(1);
    });

    it('disables the form', () => {
      build({ preview: true });
      expect(component.form.disabled).toBe(true);
    });

    it('does neither when preview is off', () => {
      build();
      expect(component.getArrayControl('rows', 'main')!.length).toBe(0);
      expect(component.form.disabled).toBe(false);
    });
  });

  /**
   * The record shape is the library's sharpest edge: a flat record handed to a nested tab
   * populates nothing and reports nothing. These specs pin the dev-mode diagnostic that
   * makes that visible, and — just as importantly — pin the cases it must stay quiet for.
   */
  describe('initialData shape diagnostics', () => {
    const nestedConfig: EntityFormConfig = {
      entity: 'clients',
      version: 1,
      tabs: [
        {
          id: 'general',
          label: { en: 'General' },
          fields: [
            { id: 'firstName', type: 'text', label: { en: 'First name' } },
            { id: 'lastName', type: 'text', label: { en: 'Last name' } },
          ],
        },
      ],
    };

    const flatConfig: EntityFormConfig = {
      ...nestedConfig,
      tabs: [{ ...nestedConfig.tabs![0], flatData: true }],
    };

    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => warn.mockRestore());

    function buildWith(config: EntityFormConfig, initialData: Record<string, unknown>): void {
      fixture = TestBed.createComponent(DynamicFormComponent);
      component = fixture.componentInstance;
      component.config = config;
      component.initialData = initialData;
      component.ngOnInit();
      component.ngOnChanges({ config: new SimpleChange(undefined, config, true) });
      fixture.detectChanges();
    }

    /**
     * Other parts of the library warn too (an unregistered field type, for one), and this
     * TestBed registers no field components. Match on our own message so the assertions
     * measure this diagnostic and nothing else.
     */
    const shapeWarnings = (): string[] =>
      warn.mock.calls
        .map(c => String(c[0]))
        .filter(m => m.startsWith('[ngx-dynamic-entity] initialData'));

    it('warns when a flat record is given to a tab that is not flatData', () => {
      buildWith(nestedConfig, { firstName: 'Alice' });

      expect(shapeWarnings()).toHaveLength(1);
      expect(shapeWarnings()[0]).toContain('firstName');
      expect(shapeWarnings()[0]).toContain('flatData: true');
    });

    it('names every field that went unpopulated', () => {
      buildWith(nestedConfig, { firstName: 'Alice', lastName: 'Smith' });

      expect(shapeWarnings()[0]).toContain('firstName');
      expect(shapeWarnings()[0]).toContain('lastName');
    });

    it('stays silent when the tab sets flatData, and the values land', () => {
      buildWith(flatConfig, { firstName: 'Alice' });

      expect(shapeWarnings()).toHaveLength(0);
      expect(component.getControl('firstName')?.value).toBe('Alice');
    });

    it('stays silent when the record is correctly nested by tab id', () => {
      buildWith(nestedConfig, { general: { firstName: 'Alice' } });

      expect(shapeWarnings()).toHaveLength(0);
      expect(component.getControl('firstName', 'general')?.value).toBe('Alice');
    });

    it('ignores top-level keys that are not field ids', () => {
      buildWith(nestedConfig, { general: { firstName: 'Alice' }, id: 'rec-1', _configVersion: 1 });

      expect(shapeWarnings()).toHaveLength(0);
    });

    it('ignores a field id whose value is explicitly undefined', () => {
      buildWith(nestedConfig, { firstName: undefined });

      expect(shapeWarnings()).toHaveLength(0);
    });

    it('warns once per key even when initialData is patched repeatedly', () => {
      buildWith(nestedConfig, { firstName: 'Alice' });
      expect(shapeWarnings()).toHaveLength(1);

      const next = { firstName: 'Bob' };
      component.initialData = next;
      component.ngOnChanges({ initialData: new SimpleChange({ firstName: 'Alice' }, next, false) });

      expect(shapeWarnings()).toHaveLength(1);
    });
  });
});
