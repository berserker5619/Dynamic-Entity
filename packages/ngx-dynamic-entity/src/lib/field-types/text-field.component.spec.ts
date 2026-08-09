import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TextFieldComponent } from './text-field.component';
import type { NestedFieldConfig } from '@dynamic-entity/core';

describe('TextFieldComponent', () => {
  let component: TextFieldComponent;
  let fixture: ComponentFixture<TextFieldComponent>;
  const mockField: NestedFieldConfig = {
    id: 'name',
    type: 'text',
    label: { en: 'Full Name' },
    placeholder: { en: 'Enter name' }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TextFieldComponent, ReactiveFormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(TextFieldComponent);
    component = fixture.componentInstance;
    component.field = mockField;
    component.control = new FormControl('Initial');
    fixture.detectChanges();
  });

  it('should render label', () => {
    const label = fixture.nativeElement.querySelector('label');
    expect(label.textContent).toBe('Full Name');
  });

  it('should render input when not masked or readonly', () => {
    const input = fixture.nativeElement.querySelector('input');
    expect(input).toBeTruthy();
    expect(input.value).toBe('Initial');
  });

  it('should render masked value when masked is true', () => {
    component.masked = true;
    fixture.detectChanges();
    const masked = fixture.nativeElement.querySelector('.ngx-field__value--masked');
    expect(masked).toBeTruthy();
    expect(masked.textContent).toBe('XXXXXXXXX');
  });

  it('should render static value when readonly is true', () => {
    component.readonly = true;
    fixture.detectChanges();
    const val = fixture.nativeElement.querySelector('.ngx-field__value');
    expect(val).toBeTruthy();
    expect(val.textContent).toBe('Initial');
  });

  /** Contextual messages are user-facing copy — pin each branch. */
  describe('errorMessage', () => {
    function withErrors(errors: Record<string, unknown> | null, touched = true): string {
      component.control = new FormControl('');
      component.control.setErrors(errors);
      if (touched) component.control.markAsTouched();
      return component.errorMessage;
    }

    it('is empty until the control is touched', () => {
      expect(withErrors({ required: true }, false)).toBe('');
    });

    it('is empty when there are no errors', () => {
      expect(withErrors(null)).toBe('');
    });

    it('is empty when there is no control at all', () => {
      component.control = undefined as unknown as FormControl;
      expect(component.errorMessage).toBe('');
    });

    it('reports required', () => {
      expect(withErrors({ required: true })).toBe('This field is required.');
    });

    it('reports an invalid email', () => {
      expect(withErrors({ email: true })).toContain('valid email');
    });

    it('reports the required length for minlength and maxlength', () => {
      expect(withErrors({ minlength: { requiredLength: 5 } })).toBe('Minimum 5 characters required.');
      expect(withErrors({ maxlength: { requiredLength: 9 } })).toBe('Maximum 9 characters allowed.');
    });

    it('reports a pattern mismatch', () => {
      expect(withErrors({ pattern: true })).toBe('Invalid format.');
    });

    it('falls back for an unrecognised error key', () => {
      expect(withErrors({ somethingElse: true })).toBe('Invalid value.');
    });

    it('prefers required over other errors', () => {
      expect(withErrors({ required: true, pattern: true })).toBe('This field is required.');
    });
  });
});
