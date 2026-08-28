import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { CurrencyFieldComponent } from './currency-field.component';

describe('CurrencyFieldComponent', () => {
  let component: CurrencyFieldComponent;
  let fixture: ComponentFixture<CurrencyFieldComponent>;

  const mockField: NestedFieldConfig = {
    id: 'salary',
    type: 'currency',
    label: { en: 'Salary' },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CurrencyFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(CurrencyFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('field', mockField);
    fixture.componentRef.setInput('control', new FormControl(1250.5));
    fixture.detectChanges();
  });

  it('renders a numeric input with the currency symbol', () => {
    const input = fixture.nativeElement.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    expect(input.value).toBe('1250.5');
    expect(fixture.nativeElement.querySelector('.ngx-field__currency-symbol').textContent.trim()).toBeTruthy();
  });

  it('masks the value for masked roles', () => {
    fixture.componentRef.setInput('masked', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value--masked').textContent).toBe('XXXXXXXXX');
  });

  it('renders a static value when readonly', () => {
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toContain('1250.5');
  });

  it('falls back to $ for an unknown locale', () => {
    fixture.componentRef.setInput('language', 'not-a-locale');
    expect(component.symbol).toBeTruthy();
  });
});

describe('CurrencyFieldComponent — currency symbol resolution', () => {
  async function build(language: string): Promise<CurrencyFieldComponent> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CurrencyFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(CurrencyFieldComponent);
    fixture.componentRef.setInput('field', { id: 'salary', type: 'currency', label: { en: 'Salary' } });
    fixture.componentRef.setInput('control', new FormControl(0));
    fixture.componentRef.setInput('language', language);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('derives a symbol from a valid locale', async () => {
    const component = await build('en');
    expect(component.symbol).toBeTruthy();
    expect(component.symbol).not.toMatch(/[\d]/);
  });

  /**
   * `toLocaleString` throws a RangeError on a malformed locale tag. A bad `language` input
   * must degrade to a default symbol, not take the field down.
   */
  it('falls back to $ when the locale tag is invalid', async () => {
    const component = await build('not-a-locale!!');
    expect(component.symbol).toBe('$');
  });

  /**
   * The other half of the guard: a runtime whose ICU data yields no currency indicator at
   * all leaves nothing behind once digits and separators are stripped. Real ICU always
   * emits a symbol, so this is simulated rather than reproducible — the point is that the
   * field renders a symbol instead of an empty box.
   */
  it('falls back to $ when the locale yields no currency symbol', async () => {
    const component = await build('en');
    const spy = jest.spyOn(Number.prototype, 'toLocaleString').mockReturnValue('0');

    expect(component.symbol).toBe('$');

    spy.mockRestore();
  });
});
