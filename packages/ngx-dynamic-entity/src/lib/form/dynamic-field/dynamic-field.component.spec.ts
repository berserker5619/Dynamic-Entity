import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import type { EntityFormConfig, NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_ROLES } from '../../tokens/injection-tokens';
import { provideFieldTypes } from '../../providers/provide-field-types';
import { FieldRegistryService } from '../../services/field-registry.service';
import { DynamicFieldComponent } from './dynamic-field.component';

@Component({ selector: 'mock-text', standalone: true, template: '' })
class MockTextFieldComponent {
  @Input() field!: NestedFieldConfig;
  @Input() control!: FormControl;
  @Input() language!: string;
  @Input() readonly!: boolean;
  @Input() masked!: boolean;
}

@Component({ selector: 'mock-alt', standalone: true, template: '' })
class MockAltFieldComponent extends MockTextFieldComponent {}

const config: EntityFormConfig = {
  entity: 'person',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      maskData: true,
      fields: [{ id: 'ssn', type: 'text', label: { en: 'SSN' }, maskData: true }],
    },
  ],
};

describe('DynamicFieldComponent', () => {
  let fixture: ComponentFixture<DynamicFieldComponent>;
  let component: DynamicFieldComponent;

  /** The instance the host mounted into its ViewContainerRef. */
  function mounted(): MockTextFieldComponent {
    return (component as unknown as { componentRef: { instance: MockTextFieldComponent } })
      .componentRef.instance;
  }

  function configure(maskedRoles: string[] = []): void {
    TestBed.configureTestingModule({
      imports: [DynamicFieldComponent],
      providers: [
        provideFieldTypes({ text: MockTextFieldComponent, number: MockAltFieldComponent }),
        { provide: MASKED_ROLES, useValue: maskedRoles },
      ],
    });

    fixture = TestBed.createComponent(DynamicFieldComponent);
    component = fixture.componentInstance;
    component.field = config.tabs[0].fields![0];
    component.control = new FormControl('123');
    component.config = config;
    component.currentTabId = 'main';
    // Inputs assigned directly do not trigger ngOnChanges — mount explicitly.
    component.ngOnChanges({});
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('mounts the component registered for the field type', () => {
    configure();
    expect(mounted()).toBeInstanceOf(MockTextFieldComponent);
  });

  it('passes all five contract inputs to the mounted component', () => {
    configure();
    const instance = mounted();
    expect(instance.field).toBe(component.field);
    expect(instance.control).toBe(component.control);
    expect(instance.language).toBe('en');
    expect(instance.readonly).toBe(false);
    expect(instance.masked).toBe(false);
  });

  it('masks the field when the user holds a masked role', () => {
    configure(['IT_SUPPORT']);
    component.userRoles = ['IT_SUPPORT'];
    component.ngOnChanges({});
    expect(mounted().masked).toBe(true);
  });

  it('honours a field-level readonly flag', () => {
    configure();
    component.field = { ...component.field, readonly: true };
    component.ngOnChanges({});
    expect(mounted().readonly).toBe(true);
  });

  it('renders nothing for an unregistered field type', () => {
    configure();
    component.field = { id: 'x', type: 'image', label: { en: 'X' } };
    component.ngOnChanges({});
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('warns once per unregistered type so the blank slot is not silent', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    configure();

    component.field = { id: 'x', type: 'never-registered', label: { en: 'X' } } as never;
    component.ngOnChanges({});
    component.ngOnChanges({}); // same type again — must not warn twice

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('never-registered');
    expect(warn.mock.calls[0][0]).toContain('provideBuiltInFieldTypes');
    warn.mockRestore();
  });

  it('recreates the mounted component when the field type changes', () => {
    configure();
    const first = mounted();
    component.field = { id: 'age', type: 'number', label: { en: 'Age' } };
    component.ngOnChanges({});

    const second = mounted();
    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(MockAltFieldComponent);
  });

  it('reuses the mounted component when only inputs change', () => {
    configure();
    const first = mounted();
    component.language = 'de';
    component.ngOnChanges({});

    expect(mounted()).toBe(first);
    expect(mounted().language).toBe('de');
  });

  it('does not resolve anything before a control is assigned', () => {
    configure();
    const registry = TestBed.inject(FieldRegistryService);
    const spy = jest.spyOn(registry, 'resolve');
    component.control = undefined as unknown as FormControl;
    component.ngOnChanges({});
    expect(spy).not.toHaveBeenCalled();
  });
});
