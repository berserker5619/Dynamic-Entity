import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { NumberFieldComponent } from './number-field.component';

describe('NumberFieldComponent', () => {
  let component: NumberFieldComponent;
  let fixture: ComponentFixture<NumberFieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NumberFieldComponent, ReactiveFormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(NumberFieldComponent);
    component = fixture.componentInstance;
    component.field = { id: 'age', type: 'number', label: { en: 'Age' } };
    component.control = new FormControl(25);
    fixture.detectChanges();
  });

  it('should render input type number', () => {
    const input = fixture.nativeElement.querySelector('input');
    expect(input.type).toBe('number');
    expect(input.value).toBe('25');
  });

  it('should handle masked state', () => {
    component.masked = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value--masked')).toBeTruthy();
  });

  it('renders a static value when readonly', () => {
    component.readonly = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toContain('25');
  });

  describe('errorMessage', () => {
    function withErrors(errors: Record<string, unknown> | null, touched = true): string {
      component.control = new FormControl(0);
      component.control.setErrors(errors);
      if (touched) component.control.markAsTouched();
      return component.errorMessage;
    }

    it('is empty until touched, and when there are no errors', () => {
      expect(withErrors({ required: true }, false)).toBe('');
      expect(withErrors(null)).toBe('');
    });

    it('is empty when there is no control at all', () => {
      component.control = undefined as unknown as FormControl;
      expect(component.errorMessage).toBe('');
    });

    it('reports required', () => {
      expect(withErrors({ required: true })).toBe('This field is required.');
    });

    it('reports the offending bound for min and max', () => {
      expect(withErrors({ min: { min: 18 } })).toBe('Value must be at least 18.');
      expect(withErrors({ max: { max: 99 } })).toBe('Value must not exceed 99.');
    });

    it('falls back for an unrecognised error key', () => {
      expect(withErrors({ somethingElse: true })).toBe('Invalid number.');
    });
  });
});
