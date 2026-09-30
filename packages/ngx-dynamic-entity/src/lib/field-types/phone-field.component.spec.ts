import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { PhoneFieldComponent } from './phone-field.component';
import { phoneValidator } from '../services/validator-registry.service';

describe('PhoneFieldComponent', () => {
  let fixture: ComponentFixture<PhoneFieldComponent>;

  const field: NestedFieldConfig = { id: 'tel', type: 'phone', label: { en: 'Phone' } };

  function mount(value: unknown, readonly = false, control = new FormControl(value)) {
    fixture = TestBed.createComponent(PhoneFieldComponent);
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('readonly', readonly);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PhoneFieldComponent, ReactiveFormsModule] }).compileComponents();
  });

  it('renders a tel input bound to the control', () => {
    const input = mount('+44 20 7946 0958').querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('tel');
    expect(input.value).toBe('+44 20 7946 0958');
  });

  it('shows the number as typed, and dials only its digits', () => {
    const link = mount('+1 (555) 555-0123', true).querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toBe('+1 (555) 555-0123');
    expect(link.getAttribute('href')).toBe('tel:+15555550123');
  });

  it('shows a value that is not a phone number as text, with no link', () => {
    const host = mount('ask reception', true);
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('ask reception');
  });

  it('shows the phone message once touched', () => {
    const control = new FormControl('12', [phoneValidator]);
    control.markAsTouched();
    const host = mount(null, false, control);
    expect(host.querySelector('.ngx-field__error')!.textContent).toContain('valid phone number');
  });
});
