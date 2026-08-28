import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { EmailFieldComponent } from './email-field.component';

describe('EmailFieldComponent', () => {
  let component: EmailFieldComponent;
  let fixture: ComponentFixture<EmailFieldComponent>;

  const mockField: NestedFieldConfig = {
    id: 'email',
    type: 'email',
    label: { en: 'Email' },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('field', mockField);
    fixture.componentRef.setInput('control', new FormControl('a@b.com'));
    fixture.detectChanges();
  });

  it('renders an email input', () => {
    const input = fixture.nativeElement.querySelector('input[type="email"]');
    expect(input).toBeTruthy();
    expect(input.value).toBe('a@b.com');
  });

  it('renders a mailto link when readonly', () => {
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('a.ngx-field__email-link');
    expect(link.getAttribute('href')).toBe('mailto:a@b.com');
  });

  it('shows the email-specific error once touched', () => {
    fixture.componentRef.setInput('control', new FormControl('nope', [Validators.email]));
    component.control.markAsTouched();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__error').textContent).toContain(
      'valid email',
    );
  });

  it('masks the value for masked roles', () => {
    fixture.componentRef.setInput('masked', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value--masked')).toBeTruthy();
  });
});
