import { ComponentFixture, TestBed } from '@angular/core';
import { ReactiveFormsModule, FormArray, FormGroup } from '@angular/forms';
import { DynamicFormComponent } from './dynamic-form.component';
import { ValidatorRegistryService } from '../services/validator-registry.service';
import { HookRegistryService } from '../services/hook-registry.service';
import { VersionService } from '../services/version.service';
import { RbacService } from '../services/rbac.service';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { SimpleChange } from '@angular/core';

describe('DynamicFormComponent', () => {
  let component: DynamicFormComponent;
  let fixture: ComponentFixture<DynamicFormComponent>;
  let mockValidatorRegistry: any;
  let mockHookRegistry: any;
  let mockVersionService: any;
  let mockRbacService: any;

  const mockConfig: EntityFormConfig = {
    entity: 'clients',
    version: 1,
    tabs: [
      {
        id: 'tab1',
        label: { en: 'Tab 1' },
        fields: [
          { id: 'name', type: 'text', validators: { required: true }, defaultValue: 'Default' },
          {
            id: 'address',
            type: 'group',
            label: { en: 'Address' },
            children: [{ id: 'city', type: 'text' }],
          },
          {
            id: 'contacts',
            type: 'array',
            label: { en: 'Contacts' },
            children: [{ id: 'phone', type: 'text' }],
          },
        ],
      },
      {
        id: 'tab2',
        label: { en: 'Tab 2' },
        fields: [{ id: 'age', type: 'number' }],
      },
    ],
  };

  beforeEach(async () => {
    mockValidatorRegistry = {
      resolveAll: jest.fn().mockReturnValue([]),
      resolveFromConfig: jest.fn().mockReturnValue([]),
    };
    mockHookRegistry = { run: jest.fn().mockImplementation((_k, d) => Promise.resolve(d)) };
    mockVersionService = {
      needsMigration: jest.fn().mockReturnValue(false),
      shouldBlockSubmit: jest.fn().mockReturnValue(false),
    };
    mockRbacService = { getPermissions: jest.fn().mockReturnValue({ canEdit: true }) };

    await TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [
        { provide: ValidatorRegistryService, useValue: mockValidatorRegistry },
        { provide: HookRegistryService, useValue: mockHookRegistry },
        { provide: VersionService, useValue: mockVersionService },
        { provide: RbacService, useValue: mockRbacService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicFormComponent);
    component = fixture.componentInstance;
    component.config = mockConfig;
    fixture.detectChanges();
  });

  it('should build form based on config with nested group and array controls', () => {
    expect(component.form).toBeDefined();
    expect(component.form.get('name')).toBeDefined();
    expect(component.form.get('name')?.value).toBe('Default');
    expect(component.form.get('address') instanceof FormGroup).toBeTrue();
    expect(component.form.get('address.city')).toBeDefined();
    expect(component.form.get('contacts') instanceof FormArray).toBeTrue();
  });

  it('should patch form with initial data including nested groups and arrays', () => {
    component.ngOnChanges({
      initialData: new SimpleChange(null, {
        name: 'John',
        age: 30,
        address: { city: 'Berlin' },
        contacts: [{ phone: '123-456' }, { phone: '789-012' }],
      }, true),
    });
    expect(component.form.get('name')?.value).toBe('John');
    expect(component.form.get('age')?.value).toBe(30);
    expect(component.form.get('address.city')?.value).toBe('Berlin');
    const contactsArray = component.form.get('contacts') as FormArray;
    expect(contactsArray.length).toBe(2);
    expect(contactsArray.at(0).get('phone')?.value).toBe('123-456');
  });

  it('should identify active tab and filter fields', () => {
    component.setActiveTab('tab1');
    expect(component.fieldsForActiveTab.length).toBe(3);
    expect(component.fieldsForActiveTab[0].id).toBe('name');

    component.setActiveTab('tab2');
    expect(component.fieldsForActiveTab[0].id).toBe('age');
  });

  it('should handle submission with hooks', async () => {
    const spy = jest.spyOn(component.formSubmit, 'emit');
    component.form.patchValue({ name: 'Submit Test' });

    await component.submit();

    expect(mockHookRegistry.run).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Submit Test' }));
  });

  it('should block submit if VersionService says so (strict mode)', () => {
    mockVersionService.shouldBlockSubmit.mockReturnValue(true);
    expect(component.canSubmit).toBe(false);
  });

  it('should emit formReset on reset call', () => {
    const spy = jest.spyOn(component.formReset, 'emit');
    component.reset();
    expect(spy).toHaveBeenCalled();
  });
});
