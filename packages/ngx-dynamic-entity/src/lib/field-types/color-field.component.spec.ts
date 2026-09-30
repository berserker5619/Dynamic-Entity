import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { ColorFieldComponent } from './color-field.component';

describe('ColorFieldComponent', () => {
  let fixture: ComponentFixture<ColorFieldComponent>;

  const field: NestedFieldConfig = { id: 'brand', type: 'color', label: { en: 'Brand colour' } };

  function mount(control: FormControl, readonly = false) {
    fixture = TestBed.createComponent(ColorFieldComponent);
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('readonly', readonly);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ColorFieldComponent, ReactiveFormsModule] }).compileComponents();
  });

  it('writes the picked colour to the control', () => {
    const control = new FormControl<string | null>(null);
    const input = mount(control).querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('color');
    input.value = '#336699';
    input.dispatchEvent(new Event('input'));
    expect(control.value).toBe('#336699');
  });

  it('shows a dash, not black, when no colour is chosen, and offers no Clear', () => {
    const host = mount(new FormControl(null));
    expect(host.querySelector('[data-testid="field-brand-code"]')!.textContent!.trim()).toBe('—');
    expect(host.querySelector('[data-testid="field-brand-clear"]')).toBeNull();
  });

  it('clears back to no colour', () => {
    const control = new FormControl<string | null>('#336699');
    const host = mount(control);
    const clear = host.querySelector('[data-testid="field-brand-clear"]') as HTMLButtonElement;
    expect(clear.getAttribute('aria-label')).toBe('Clear Brand colour');
    clear.click();
    expect(control.value).toBeNull();
    expect(control.touched).toBe(true);
  });

  it('shows a swatch and the code when read-only', () => {
    const host = mount(new FormControl('#ABCDEF'), true);
    const swatch = host.querySelector('.ngx-field__swatch') as HTMLElement;
    expect(swatch.style.backgroundColor).toBeTruthy();
    expect(host.textContent).toContain('#abcdef');
  });

  it('never puts a value that is not a colour into a style', () => {
    const host = mount(new FormControl('red; background-image: url(x)'), true);
    expect(host.querySelector('.ngx-field__swatch')).toBeNull();
    expect(host.textContent).toContain('red; background-image: url(x)');
  });
});
