import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { RatingFieldComponent } from './rating-field.component';

describe('RatingFieldComponent', () => {
  let fixture: ComponentFixture<RatingFieldComponent>;

  const field: NestedFieldConfig = { id: 'score', type: 'rating', label: { en: 'Score' } };

  function mount(control: FormControl, overrides: Partial<NestedFieldConfig> = {}, readonly = false) {
    fixture = TestBed.createComponent(RatingFieldComponent);
    fixture.componentRef.setInput('field', { ...field, ...overrides });
    fixture.componentRef.setInput('control', control);
    fixture.componentRef.setInput('readonly', readonly);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const radios = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"]'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RatingFieldComponent, ReactiveFormsModule] }).compileComponents();
  });

  it('draws five stars by default, and validators.max of them otherwise', () => {
    expect(radios(mount(new FormControl(null))).length).toBe(5);
    expect(radios(mount(new FormControl(null), { validators: { max: 3 } })).length).toBe(3);
  });

  it('is one radio group, so arrow keys move between stars', () => {
    const names = new Set(radios(mount(new FormControl(null))).map(r => r.name));
    expect(names.size).toBe(1);
  });

  it('names every star in words, since a star glyph reads aloud as "black star"', () => {
    const host = mount(new FormControl(null));
    const labels = Array.from(host.querySelectorAll('.ngx-field__star .ngx-field__sr-only')).map(el =>
      el.textContent!.trim(),
    );
    expect(labels).toEqual(['1 of 5', '2 of 5', '3 of 5', '4 of 5', '5 of 5']);
  });

  it('stores the chosen star as a number', () => {
    const control = new FormControl<number | null>(null);
    const host = mount(control);
    radios(host)[3].dispatchEvent(new Event('change'));
    expect(control.value).toBe(4);
    expect(control.touched).toBe(true);
  });

  it('fills the stars up to the value, and marks the rest hollow', () => {
    const host = mount(new FormControl(2));
    const glyphs = Array.from(host.querySelectorAll('.ngx-field__star .ngx-field__star-glyph')).map(g =>
      g.textContent!.trim(),
    );
    expect(glyphs).toEqual(['★', '★', '☆', '☆', '☆']);
    expect(radios(host)[1].checked).toBe(true);
  });

  it('follows a value set from outside the component', () => {
    const control = new FormControl<number | null>(1);
    const host = mount(control);
    control.setValue(5);
    fixture.detectChanges();
    expect(radios(host)[4].checked).toBe(true);
  });

  it('clears back to no rating', () => {
    const control = new FormControl<number | null>(3);
    const host = mount(control);
    (host.querySelector('[data-testid="field-score-clear"]') as HTMLButtonElement).click();
    expect(control.value).toBeNull();
  });

  it('reads a value that is not a star on this scale as no rating', () => {
    const host = mount(new FormControl(9));
    expect(radios(host).some(r => r.checked)).toBe(false);
    expect(host.querySelector('[data-testid="field-score-clear"]')).toBeNull();
  });

  it('says the rating in words when read-only', () => {
    const host = mount(new FormControl(4), {}, true);
    expect(host.querySelector('[data-testid="field-score-value"]')!.textContent).toContain('4 of 5');
  });

  it('shows the required message once touched', () => {
    const control = new FormControl(null, [Validators.required]);
    control.markAsTouched();
    expect(mount(control).querySelector('.ngx-field__error')!.textContent).toContain('required');
  });
});
