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
    component.field = mockField;
    component.control = new FormControl(1250.5);
    fixture.detectChanges();
  });

  it('renders a numeric input with the currency symbol', () => {
    const input = fixture.nativeElement.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    expect(input.value).toBe('1250.5');
    expect(fixture.nativeElement.querySelector('.ngx-field__currency-symbol').textContent.trim()).toBeTruthy();
  });

  it('masks the value for masked roles', () => {
    component.masked = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value--masked').textContent).toBe('XXXXXXXXX');
  });

  it('renders a static value when readonly', () => {
    component.readonly = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toContain('1250.5');
  });

  it('falls back to $ for an unknown locale', () => {
    component.language = 'not-a-locale';
    expect(component.symbol).toBeTruthy();
  });
});
