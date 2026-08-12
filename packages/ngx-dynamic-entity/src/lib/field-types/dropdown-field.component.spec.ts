import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DropdownFieldComponent } from './dropdown-field.component';

describe('DropdownFieldComponent', () => {
  let component: DropdownFieldComponent;
  let fixture: ComponentFixture<DropdownFieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DropdownFieldComponent, ReactiveFormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(DropdownFieldComponent);
    component = fixture.componentInstance;
    component.field = { 
      label: { en: 'Color' },
      options: [
        { en: 'Red' },
        { en: 'Blue' }
      ]
    } as any;
    component.control = new FormControl({ en: 'Red' });
    fixture.detectChanges();
  });

  it('should render options', () => {
    const options = fixture.nativeElement.querySelectorAll('option');
    // +1 for placeholder
    expect(options.length).toBe(3);
    expect(options[1].textContent).toBe('Red');
  });

  it('should show correct label in readonly mode', () => {
    component.readonly = true;
    fixture.detectChanges();
    const val = fixture.nativeElement.querySelector('.ngx-field__value');
    expect(val.textContent).toBe('Red');
  });

  it('falls back to the raw value when no option matches', () => {
    component.control.setValue('unknown');
    expect(component.getLabel('unknown')).toBe('unknown');
  });

  it('shows an em dash for an empty readonly value', () => {
    expect(component.getLabel(null)).toBe('—');
  });

  describe('errorMessage', () => {
    function withErrors(errors: Record<string, unknown> | null, touched = true): string {
      component.control = new FormControl('');
      component.control.setErrors(errors);
      if (touched) component.control.markAsTouched();
      return component.errorMessage;
    }

    it('is empty until touched, and when there are no errors', () => {
      expect(withErrors({ required: true }, false)).toBe('');
      expect(withErrors(null)).toBe('');
    });

    it('asks the user to select for a required error', () => {
      expect(withErrors({ required: true })).toBe('Please select an option.');
    });

    it('falls back for an unrecognised error key', () => {
      expect(withErrors({ somethingElse: true })).toBe('Invalid selection.');
    });
  });
});
