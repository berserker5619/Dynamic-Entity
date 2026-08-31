import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  AbstractControl,
  FormArray,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import type { EntityFormConfig, FormRule, RecordMigration } from '@dynamic-entity/core';
import { DynamicFormComponent } from './dynamic-form.component';
import { EntityRefSelectionService } from '../services/entity-ref-selection.service';
import { HookRegistryService } from '../services/hook-registry.service';
import { RbacService } from '../services/rbac.service';
import { ValidatorRegistryService } from '../services/validator-registry.service';
import { ASYNC_VALIDATOR_REGISTRY, RECORD_MIGRATIONS } from '../tokens/injection-tokens';

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
          // Mirrors the real service: a partial stub here fails at control construction,
          // which surfaces as every spec in the file breaking at once.
          provide: ValidatorRegistryService,
          useValue: {
            resolveAll: jest.fn().mockReturnValue([]),
            resolveFromConfig: jest.fn().mockReturnValue([]),
            resolveAsyncFromConfig: jest.fn().mockReturnValue([]),
          },
        },
        { provide: HookRegistryService, useValue: mockHookRegistry },
        {
          // Mirrors the real service's shape: view and delete are part of the contract, and
          // a partial object here silently makes them undefined at every call site.
          provide: RbacService,
          useValue: {
            getPermissions: jest.fn().mockReturnValue({ canView: true, canEdit: true, canDelete: true }),
          },
        },
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

  describe('the active tab across a record swap', () => {
    const twoTabs = (): EntityFormConfig => ({
      entity: 'people',
      tabs: [
        { id: 'personal', label: { en: 'Personal' }, fields: [{ id: 'fullName', type: 'text' }] },
        { id: 'work', label: { en: 'Work' }, fields: [{ id: 'deskNumber', type: 'text' }] },
      ],
    });

    function swapInitialData(from: unknown, to: unknown): void {
      component.initialData = to as Record<string, unknown>;
      component.ngOnChanges({ initialData: new SimpleChange(from, to, false) });
    }

    it('returns to the first tab when a different record is loaded', () => {
      build(twoTabs());
      component.setActiveTab('work');
      expect(component.activeTab()).toBe('work');

      // A mounted form swapped to another record kept the previous record's tab, so the new
      // record opened on a tab the reader never chose.
      swapInitialData({ personal: { fullName: 'Ada' } }, { personal: { fullName: 'Grace' } });
      expect(component.activeTab()).toBe('personal');
    });

    it('stays put when the same empty record is re-bound', () => {
      build(twoTabs());
      component.setActiveTab('work');

      // `[initialData]="record() || {}"` hands over a fresh literal on every evaluation.
      // Treating that as a record swap would drag someone off the tab they were filling in.
      swapInitialData({}, {});
      expect(component.activeTab()).toBe('work');
    });

    it('stays put when the binding is re-evaluated with null', () => {
      build(twoTabs());
      component.setActiveTab('work');
      swapInitialData(undefined, null);
      expect(component.activeTab()).toBe('work');
    });

    it('does not steal focus when the host swaps the record', () => {
      build(twoTabs());
      component.setActiveTab('work');
      const focusSpy = jest.spyOn(
        component as unknown as { focusActivePanel: () => void },
        'focusActivePanel',
      );

      swapInitialData({ personal: { fullName: 'Ada' } }, { personal: { fullName: 'Grace' } });

      // Focus follows a user choosing a tab, not a host replacing the record beneath them.
      expect(component.activeTab()).toBe('personal');
      expect(focusSpy).not.toHaveBeenCalled();
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

  describe('edit permission', () => {
    /**
     * `permissions.edit` used to gate the Save button alone, so a role without edit rights
     * got a fully editable form and only found out the record was not theirs to change when
     * no Save appeared — after typing into it.
     */
    function buildAsViewer(): void {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [DynamicFormComponent, ReactiveFormsModule],
        providers: [
          {
            provide: ValidatorRegistryService,
            useValue: {
              resolveAll: jest.fn().mockReturnValue([]),
              resolveFromConfig: jest.fn().mockReturnValue([]),
              resolveAsyncFromConfig: jest.fn().mockReturnValue([]),
            },
          },
          { provide: HookRegistryService, useValue: mockHookRegistry },
          {
            provide: RbacService,
            useValue: {
              getPermissions: jest
                .fn()
                .mockReturnValue({ canView: true, canEdit: false, canDelete: false }),
            },
          },
        ],
      });
      build();
    }

    it('renders every field read-only when the roles may not edit', () => {
      buildAsViewer();
      const fields = (mockConfig.tabs ?? []).flatMap(t => t.fields ?? []);
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        expect(component.isFieldReadonly(field)).toBe(true);
      }
    });

    it('leaves fields editable when the roles may edit', () => {
      const fields = (mockConfig.tabs ?? []).flatMap(t => t.fields ?? []);
      const plain = fields.filter(f => !f.readonly && !f.criticalField);
      expect(plain.length).toBeGreaterThan(0);
      for (const field of plain) {
        expect(component.isFieldReadonly(field)).toBe(false);
      }
    });

    it('refuses to unlock a critical field without edit rights', () => {
      buildAsViewer();
      const critical = (mockConfig.tabs ?? [])
        .flatMap(t => t.fields ?? [])
        .find(f => f.criticalField);
      if (!critical) return;
      component.toggleFieldLock(critical);
      expect(component.isFieldReadonly(critical)).toBe(true);
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
          useValue: {
            resolveAll: jest.fn().mockReturnValue([]),
            resolveFromConfig: jest.fn().mockReturnValue([]),
            resolveAsyncFromConfig: jest.fn().mockReturnValue([]),
          },
        },
        { provide: HookRegistryService, useValue: { run: jest.fn(), has: jest.fn().mockReturnValue(false) } },
        {
          // Mirrors the real service's shape: view and delete are part of the contract, and
          // a partial object here silently makes them undefined at every call site.
          provide: RbacService,
          useValue: {
            getPermissions: jest.fn().mockReturnValue({ canView: true, canEdit: true, canDelete: true }),
          },
        },
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
          useValue: {
            resolveAll: jest.fn().mockReturnValue([]),
            resolveFromConfig: jest.fn().mockReturnValue([]),
            resolveAsyncFromConfig: jest.fn().mockReturnValue([]),
          },
        },
        { provide: HookRegistryService, useValue: { run: jest.fn(), has: jest.fn().mockReturnValue(false) } },
        {
          // Mirrors the real service's shape: view and delete are part of the contract, and
          // a partial object here silently makes them undefined at every call site.
          provide: RbacService,
          useValue: {
            getPermissions: jest.fn().mockReturnValue({ canView: true, canEdit: true, canDelete: true }),
          },
        },
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
   * `permissions.view` and `permissions.delete` were computed and discarded — a user whose
   * roles failed `view` still received the whole form with every value in the DOM.
   */
  describe('entity permissions', () => {
    const restricted: EntityFormConfig = {
      ...mockConfig,
      permissions: { view: ['manager'], edit: ['manager'], delete: ['admin'] },
    };

    /**
     * These specs are about what RbacService actually computes from roles, so they run
     * against the real one rather than the suite-wide stub — hence a fresh module.
     */
    beforeEach(async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DynamicFormComponent, ReactiveFormsModule],
        providers: [
          {
            provide: ValidatorRegistryService,
            useValue: { resolveAll: () => [], resolveFromConfig: () => [], resolveAsyncFromConfig: () => [] },
          },
          { provide: HookRegistryService, useValue: { run: jest.fn(), has: () => false } },
        ],
      }).compileComponents();
    });

    function buildAs(roles: string[]): void {
      fixture = TestBed.createComponent(DynamicFormComponent);
      component = fixture.componentInstance;
      component.config = restricted;
      component.userRoles = roles;
      component.ngOnInit();
      component.ngOnChanges({ config: new SimpleChange(undefined, restricted, true) });
      fixture.detectChanges();
    }

    const html = (): string => fixture.nativeElement.innerHTML as string;

    it('renders nothing of the record when view permission is denied', () => {
      buildAs(['guest']);

      expect(component.canView).toBe(false);
      expect(html()).toContain('form-access-denied');
      expect(html()).not.toContain('form-panel');
    });

    it('renders the form when view permission is granted', () => {
      buildAs(['manager']);

      expect(component.canView).toBe(true);
      expect(html()).toContain('form-panel');
      expect(html()).not.toContain('form-access-denied');
    });

    it('refuses to submit for a user who may not view the record', async () => {
      buildAs(['guest']);
      const emitted = jest.fn();
      component.formSubmit.subscribe(emitted);

      expect(component.canSubmit).toBe(false);
      await component.submit();

      expect(emitted).not.toHaveBeenCalled();
    });

    it('answers canDelete so a consumer can gate its own delete affordance', () => {
      buildAs(['admin']);
      expect(component.canDelete).toBe(true);

      buildAs(['manager']);
      expect(component.canDelete).toBe(false);
    });

    it('recomputes permissions when userRoles change', () => {
      buildAs(['guest']);
      expect(component.canView).toBe(false);

      component.userRoles = ['manager'];
      component.ngOnChanges({ userRoles: new SimpleChange(['guest'], ['manager'], false) });

      expect(component.canView).toBe(true);
    });
  });

  /**
   * Two ways a form could silently do the wrong thing: submit a record the rules engine had
   * already rejected, and deadlock behind a required field nobody can see.
   */
  describe('submission gating', () => {
    const blockingRule = (message: string): FormRule => ({
      formConfigId: 'clients',
      fieldId: 'name',
      conditions: [{ operator: 'IS_NOT_EMPTY', compareType: 'value' }],
      action: { type: 'validation', value: message, severity: 'error' },
      targets: [{ id: 'name', type: 'field' }],
      enabled: true,
      priority: 0,
    });

    function buildValid(rules?: FormRule[]): void {
      fixture = TestBed.createComponent(DynamicFormComponent);
      component = fixture.componentInstance;
      component.config = mockConfig;
      if (rules) component.rules = rules;
      component.ngOnInit();
      component.ngOnChanges({ config: new SimpleChange(undefined, mockConfig, true) });
      fixture.detectChanges();
      component.getControl('name')?.patchValue('Acme');
      fixture.detectChanges();
    }

    it('submits when the form is valid and no rule objects', async () => {
      buildValid();
      const emitted = jest.fn();
      component.formSubmit.subscribe(emitted);

      expect(component.submitBlocked).toBe(false);
      await component.submit();

      expect(emitted).toHaveBeenCalledTimes(1);
    });

    /**
     * saveSection() in the record editor has always honoured rule validation errors;
     * submit() did not. The same rule blocked one save path and merely painted a banner on
     * the other, so anything wiring (formSubmit) to persistence wrote rejected records.
     */
    it('refuses to submit while a validation rule is failing', async () => {
      buildValid([blockingRule('Name is not allowed')]);
      const emitted = jest.fn();
      component.formSubmit.subscribe(emitted);

      expect(component.hasRuleErrors).toBe(true);
      expect(component.submitBlocked).toBe(true);
      await component.submit();

      expect(emitted).not.toHaveBeenCalled();
    });

    it('exposes the rule errors that are blocking it', () => {
      buildValid([blockingRule('Name is not allowed')]);
      expect(component.ruleValidationErrors).toEqual({ name: 'Name is not allowed' });
    });
  });

  /**
   * A field hidden by a rule or a showWhen condition keeps its validators, so a hidden
   * required field held form.invalid true forever and left Save permanently disabled with
   * nothing on screen to explain it.
   */
  describe('hidden fields and validity', () => {
    const conditionalConfig: EntityFormConfig = {
      entity: 'clients',
      version: 1,
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [
            { id: 'isEmployee', type: 'boolean', label: { en: 'Employee' } },
            {
              id: 'staffId',
              type: 'text',
              label: { en: 'Staff Id' },
              showWhen: { isEmployee: true },
              validators: { required: true },
            },
          ],
        },
      ],
    };

    /**
     * The suite-wide ValidatorRegistryService mock resolves every field to no validators,
     * which would make "is the form invalid?" vacuously false here. These specs are about
     * required-ness specifically, so they need a resolver that actually honours it.
     */
    function buildConditional(): void {
      TestBed.overrideProvider(ValidatorRegistryService, {
        useValue: {
          resolveAll: () => [],
          resolveFromConfig: (v?: { required?: boolean }) => (v?.required ? [Validators.required] : []),
          resolveAsyncFromConfig: () => [],
        },
      });

      fixture = TestBed.createComponent(DynamicFormComponent);
      component = fixture.componentInstance;
      component.config = conditionalConfig;
      component.ngOnInit();
      component.ngOnChanges({ config: new SimpleChange(undefined, conditionalConfig, true) });
      fixture.detectChanges();
    }

    it('does not hold the form invalid for a required field that is hidden', () => {
      buildConditional();

      expect(component.fieldsForActiveTab.map(f => f.id)).toEqual(['isEmployee']);
      expect(component.getControl('staffId')?.disabled).toBe(true);
      expect(component.form.invalid).toBe(false);
      expect(component.submitBlocked).toBe(false);
    });

    it('re-applies the requirement once the field becomes visible', () => {
      buildConditional();
      component.getControl('isEmployee')?.patchValue(true);
      fixture.detectChanges();

      expect(component.fieldsForActiveTab.map(f => f.id)).toEqual(['isEmployee', 'staffId']);
      expect(component.getControl('staffId')?.enabled).toBe(true);
      expect(component.form.invalid).toBe(true);
      expect(component.submitBlocked).toBe(true);
    });

    it('keeps a hidden field’s value, so rules still see it', () => {
      buildConditional();
      component.getControl('isEmployee')?.patchValue(true);
      fixture.detectChanges();
      component.getControl('staffId')?.patchValue('E-1');
      fixture.detectChanges();

      component.getControl('isEmployee')?.patchValue(false);
      fixture.detectChanges();

      expect(component.getControl('staffId')?.disabled).toBe(true);
      expect(component.getControl('staffId')?.value).toBe('E-1');
      expect(component.extractRecord()['main'].staffId).toBe('E-1');
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

/**
 * EntityFormConfig.version and _configVersion used to be declarations nothing acted on: a
 * schema could move on while saved records kept their old shape, with nothing reconciling
 * the two. Registered migrations are applied where a record enters the renderer.
 */
describe('record migration', () => {
  // Own fixture: this suite builds its own TestBed rather than the shared one above.
  let fixture: ComponentFixture<DynamicFormComponent>;
  let component: DynamicFormComponent;

  const versionedConfig = (version: number): EntityFormConfig => ({
    entity: 'clients',
    version,
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        flatData: true,
        fields: [
          { id: 'firstName', type: 'text', label: { en: 'First' } },
          { id: 'lastName', type: 'text', label: { en: 'Last' } },
        ],
      },
    ],
  });

  const splitName: RecordMigration = {
    from: 1,
    to: 2,
    description: 'split name',
    migrate: record => {
      const [firstName = '', ...rest] = String(record['name'] ?? '').split(' ');
      const { name, ...others } = record;
      void name;
      return { ...others, firstName, lastName: rest.join(' ') };
    },
  };

  async function buildWith(
    config: EntityFormConfig,
    initialData: Record<string, unknown>,
    migrations: RecordMigration[],
  ): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [
        {
          provide: ValidatorRegistryService,
          useValue: { resolveAll: () => [], resolveFromConfig: () => [], resolveAsyncFromConfig: () => [] },
        },
        { provide: HookRegistryService, useValue: { run: jest.fn(), has: () => false } },
        {
          provide: RbacService,
          useValue: { getPermissions: () => ({ canView: true, canEdit: true, canDelete: true }) },
        },
        { provide: RECORD_MIGRATIONS, useValue: migrations },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicFormComponent);
    component = fixture.componentInstance;
    component.config = config;
    component.initialData = initialData;
    component.ngOnInit();
    component.ngOnChanges({ config: new SimpleChange(undefined, config, true) });
    fixture.detectChanges();
  }

  it('upgrades a stale record before patching the form', async () => {
    await buildWith(versionedConfig(2), { _configVersion: 1, name: 'Ada Lovelace' }, [splitName]);

    expect(component.getControl('firstName')?.value).toBe('Ada');
    expect(component.getControl('lastName')?.value).toBe('Lovelace');
  });

  it('leaves a current record untouched', async () => {
    await buildWith(
      versionedConfig(2),
      { _configVersion: 2, firstName: 'Grace', lastName: 'Hopper' },
      [splitName],
    );

    expect(component.getControl('firstName')?.value).toBe('Grace');
    expect(component.getControl('lastName')?.value).toBe('Hopper');
  });

  it('does nothing when no migrations are registered', async () => {
    await buildWith(versionedConfig(2), { _configVersion: 1, name: 'Ada Lovelace' }, []);

    expect(component.getControl('firstName')?.value).toBeNull();
  });

  /** A missing step must surface, not be swallowed into a half-understood record. */
  it('propagates a gap in the migration path', async () => {
    await expect(
      buildWith(versionedConfig(3), { _configVersion: 1, name: 'Ada Lovelace' }, [splitName]),
    ).rejects.toThrow(/No migration from config version 2 to 3/);
  });
});

/**
 * Async validation did not exist: there was no async registry, and the beforeSave hook could
 * not veto a save — its return value simply replaced the payload and the submit proceeded.
 */
describe('async validation and a rejectable beforeSave', () => {
  let fixture: ComponentFixture<DynamicFormComponent>;
  let component: DynamicFormComponent;

  const cfg: EntityFormConfig = {
    entity: 'clients',
    version: 1,
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        flatData: true,
        fields: [
          {
            id: 'email',
            type: 'email',
            label: { en: 'Email' },
            validators: { customAsync: ['uniqueEmail'] },
          },
        ],
      },
    ],
  };

  /** Resolves an error for a taken address, after a tick, like a server would. */
  const uniqueEmail = (control: AbstractControl): Promise<ValidationErrors | null> =>
    new Promise(resolve =>
      setTimeout(() => resolve(control.value === 'taken@example.com' ? { taken: true } : null), 0),
    );

  async function build(hooks: Record<string, unknown> = {}): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [
        { provide: ASYNC_VALIDATOR_REGISTRY, useValue: new Map([['uniqueEmail', uniqueEmail]]) },
        {
          provide: HookRegistryService,
          useValue: {
            has: (k: string) => k in hooks,
            run: (k: string, d: unknown) => Promise.resolve((hooks as any)[k]?.(d)),
          },
        },
        {
          provide: RbacService,
          useValue: { getPermissions: () => ({ canView: true, canEdit: true, canDelete: true }) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicFormComponent);
    component = fixture.componentInstance;
    component.config = cfg;
    component.ngOnInit();
    component.ngOnChanges({ config: new SimpleChange(undefined, cfg, true) });
    fixture.detectChanges();
  }

  const settle = () => new Promise(r => setTimeout(r, 5));

  it('attaches a registered async validator and reports its error', async () => {
    await build();
    component.getControl('email')?.setValue('taken@example.com');
    await settle();

    expect(component.getControl('email')?.errors).toEqual({ taken: true });
  });

  it('passes a value the async validator accepts', async () => {
    await build();
    component.getControl('email')?.setValue('free@example.com');
    await settle();

    expect(component.getControl('email')?.errors).toBeNull();
  });

  /** `invalid` is false while a check is outstanding, so pending must block on its own. */
  it('blocks submission while an async check is pending', async () => {
    await build();
    component.getControl('email')?.setValue('taken@example.com');

    expect(component.isValidating).toBe(true);
    expect(component.submitBlocked).toBe(true);

    await settle();
    expect(component.isValidating).toBe(false);
  });

  it('aborts the save when beforeSave returns false', async () => {
    await build({ 'clients:beforeSave': () => false });
    const submitted = jest.fn();
    const rejected = jest.fn();
    component.formSubmit.subscribe(submitted);
    component.saveRejected.subscribe(rejected);
    await settle(); // the async validator must settle, or submitBlocked refuses on pending

    await component.submit();

    expect(submitted).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledWith({ reason: 'beforeSave returned false' });
  });

  it('aborts the save when beforeSave throws, and reports why', async () => {
    await build({ 'clients:beforeSave': () => { throw new Error('server said no'); } });
    const submitted = jest.fn();
    const rejected = jest.fn();
    component.formSubmit.subscribe(submitted);
    component.saveRejected.subscribe(rejected);
    await settle(); // the async validator must settle, or submitBlocked refuses on pending

    await component.submit();

    expect(submitted).not.toHaveBeenCalled();
    expect(rejected.mock.calls[0][0].reason).toBe('server said no');
  });

  it('still lets beforeSave replace the payload', async () => {
    await build({ 'clients:beforeSave': (d: Record<string, unknown>) => ({ ...d, stamped: true }) });
    const submitted = jest.fn();
    component.formSubmit.subscribe(submitted);
    await settle(); // as above

    await component.submit();

    expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ stamped: true }));
  });

  it('treats an undefined return as "unchanged"', async () => {
    await build({ 'clients:beforeSave': () => undefined });
    const submitted = jest.fn();
    component.formSubmit.subscribe(submitted);
    await settle(); // as above

    await component.submit();

    expect(submitted).toHaveBeenCalledTimes(1);
  });
});
