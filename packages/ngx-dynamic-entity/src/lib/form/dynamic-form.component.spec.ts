import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
      expect(component.form.get('name')).toBeDefined();
      expect(component.form.get('address') instanceof FormGroup).toBe(true);
      expect(component.form.get('address.city')).toBeDefined();
      expect(component.form.get('contacts') instanceof FormArray).toBe(true);
    });

    it('seeds controls from defaultValue', () => {
      expect(component.form.get('name')?.value).toBe('Default');
    });

    it('patches initial data including groups and array rows', () => {
      component.initialData = {
        name: 'John',
        age: 30,
        address: { city: 'Berlin' },
        contacts: [{ phone: '123-456' }, { phone: '789-012' }],
      };
      component.ngOnChanges({ initialData: new SimpleChange(null, component.initialData, true) });

      expect(component.form.get('name')?.value).toBe('John');
      expect(component.form.get('address.city')?.value).toBe('Berlin');

      const contacts = component.form.get('contacts') as FormArray;
      expect(contacts.length).toBe(2);
      expect(contacts.at(0).get('phone')?.value).toBe('123-456');
    });

    it('does not stack valueChanges subscriptions across rebuilds', () => {
      const emissions: unknown[] = [];
      component.formChange.subscribe(v => emissions.push(v));

      component.ngOnChanges({ config: new SimpleChange(null, mockConfig, false) });
      component.form.patchValue({ name: 'once' });

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

      component.form.patchValue({ isEmployee: true });
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
      component.form.patchValue({ name: 'hide-me' });

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
      component.ngOnChanges({ initialData: new SimpleChange(null, { iban: 'DE00' }, true) });
      expect(component.changedCriticalFields()).toEqual([]);

      component.form.patchValue({ iban: 'DE99' });
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

      expect(component.form.get('city')?.value).toBe('Berlin');
      expect(component.form.get('vat')?.value).toBe('DE123');
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

      expect(component.form.get('city')?.value).toBeNull();
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

      component.form.patchValue({ home: 'Main St' });
      component.form.patchValue({ billingSame: true });
      expect(component.form.get('billing')?.value).toBe('Main St');

      // Editing the target afterwards must not be overwritten while the flag stays true.
      component.form.patchValue({ billing: 'Other St' });
      component.form.patchValue({ home: 'Changed St' });
      expect(component.form.get('billing')?.value).toBe('Other St');
    });
  });

  describe('submission', () => {
    it('runs the beforeSave hook and emits the processed data', async () => {
      const spy = jest.spyOn(component.formSubmit, 'emit');
      component.form.patchValue({ name: 'Submit Test' });

      await component.submit();

      expect(mockHookRegistry.run).toHaveBeenCalledWith('clients:beforeSave', expect.anything());
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Submit Test' }));
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
});
