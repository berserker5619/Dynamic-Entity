import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { SliderFieldComponent } from './slider-field.component';

describe('SliderFieldComponent', () => {
  let fixture: ComponentFixture<SliderFieldComponent>;

  const field: NestedFieldConfig = {
    id: 'volume',
    type: 'slider',
    label: { en: 'Volume' },
    validators: { min: 10, max: 20 },
    step: 2,
  };

  function mount(control: FormControl, readonly = false) {
    fixture = TestBed.createComponent(SliderFieldComponent);
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('readonly', readonly);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SliderFieldComponent, ReactiveFormsModule] }).compileComponents();
  });

  it('draws the track from validators.min, validators.max and step', () => {
    const input = mount(new FormControl(12)).querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('range');
    expect(input.min).toBe('10');
    expect(input.max).toBe('20');
    expect(input.step).toBe('2');
  });

  it('writes a number to the control as the thumb moves', () => {
    const control = new FormControl<number | null>(null);
    const input = mount(control).querySelector('input') as HTMLInputElement;
    input.value = '16';
    input.dispatchEvent(new Event('input'));
    expect(control.value).toBe(16);
  });

  it('says it is unset rather than showing the midpoint as a value', () => {
    const host = mount(new FormControl(null));
    expect(host.querySelector('[data-testid="field-volume-readout"]')!.textContent!.trim()).toBe('—');
    expect(host.querySelector('input')!.classList).toContain('ngx-field__slider--unset');
    expect(host.querySelector('input')!.getAttribute('aria-valuetext')).toBe('—');
  });

  it('reads out the value once there is one', () => {
    const host = mount(new FormControl(14));
    expect(host.querySelector('[data-testid="field-volume-readout"]')!.textContent!.trim()).toBe('14');
    expect(host.querySelector('input')!.getAttribute('aria-valuetext')).toBeNull();
  });

  it('shows the value as text when read-only', () => {
    const host = mount(new FormControl(18), true);
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('[data-testid="field-volume-value"]')!.textContent!.trim()).toBe('18');
  });
});
