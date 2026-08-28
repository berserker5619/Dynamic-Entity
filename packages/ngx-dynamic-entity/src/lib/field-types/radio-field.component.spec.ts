import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { RadioFieldComponent } from './radio-field.component';

describe('RadioFieldComponent', () => {
  let component: RadioFieldComponent;
  let fixture: ComponentFixture<RadioFieldComponent>;

  const mockField: NestedFieldConfig = {
    id: 'size',
    type: 'radio',
    label: { en: 'Size' },
    options: [
      { en: 'Small' },
      { en: 'Large' },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RadioFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(RadioFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('field', mockField);
    fixture.componentRef.setInput('control', new FormControl({ en: 'Large' }));
    fixture.detectChanges();
  });

  it('renders one radio per option with unique ids', () => {
    const inputs: HTMLInputElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('input[type="radio"]'),
    );
    expect(inputs.length).toBe(2);
    expect(inputs.map(i => i.id)).toEqual(['size-small', 'size-large']);
  });

  it('resolves the selected option label when readonly', () => {
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toContain('Large');
  });

  it('renders the legend from the localized label', () => {
    expect(fixture.nativeElement.querySelector('legend').textContent).toContain('Size');
  });

  it('masks the value for masked roles', () => {
    fixture.componentRef.setInput('masked', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value--masked')).toBeTruthy();
  });

  it('renders no radios while masked — a masked field must not be editable', () => {
    fixture.componentRef.setInput('masked', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('input[type="radio"]').length).toBe(0);
  });

  describe('read-only display fallbacks', () => {
    function readonlyText(value: unknown): string {
      fixture.componentRef.setInput('control', new FormControl(value));
      fixture.componentRef.setInput('readonly', true);
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('.ngx-field__value').textContent.trim();
    }

    it('shows an em dash for an empty value', () => {
      expect(readonlyText(null)).toBe('—');
    });

    it('shows the stored text when no option matches', () => {
      // A record saved before this option was renamed away.
      expect(readonlyText({ en: 'Medium' })).toBe('Medium');
    });

    it('shows a plain scalar value as-is', () => {
      expect(readonlyText('Bespoke')).toBe('Bespoke');
    });
  });

  it('re-resolves labels when the language changes', () => {
    component.field = {
      ...mockField,
      options: [{ en: 'Small', de: 'Klein' }, { en: 'Large', de: 'Groß' }],
    };
    fixture.componentRef.setInput('language', 'de');
    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.ngx-field__radio-label'),
    ).map((el: any) => el.textContent.trim());
    expect(labels).toEqual(['Klein', 'Groß']);
  });

  it('falls back to en when the language input is cleared', () => {
    fixture.componentRef.setInput('language', '');
    expect(component.language).toBe('en');
  });

  it('slugifies option text into radio ids so spaces never reach the id attribute', () => {
    fixture.componentRef.setInput('field', { ...mockField, options: [{ en: 'On Leave' }] });
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(input.id).toBe('size-on_leave');
    expect(fixture.nativeElement.querySelector('label').getAttribute('for')).toBe(input.id);
  });

  it('disables every radio when the field is disabled', () => {
    fixture.componentRef.setInput('field', { ...mockField, disabled: true });
    fixture.detectChanges();

    const inputs: HTMLInputElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('input[type="radio"]'),
    );
    expect(inputs.every(i => i.disabled)).toBe(true);
  });
});
