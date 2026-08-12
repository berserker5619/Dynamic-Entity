import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { MonthYearFieldComponent } from './month-year-field.component';

describe('MonthYearFieldComponent', () => {
  let component: MonthYearFieldComponent;
  let fixture: ComponentFixture<MonthYearFieldComponent>;

  const mockField: NestedFieldConfig = {
    id: 'startedOn',
    type: 'monthYear',
    label: { en: 'Started' },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthYearFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(MonthYearFieldComponent);
    component = fixture.componentInstance;
    component.field = mockField;
    component.control = new FormControl('2024-03');
    fixture.detectChanges();
  });

  it('splits a stored YYYY-MM value across the two selects', () => {
    expect(component.selectedYear).toBe('2024');
    expect(component.selectedMonth).toBe('03');
    expect(fixture.nativeElement.querySelectorAll('select').length).toBe(2);
  });

  it('recomposes YYYY-MM when the month changes', () => {
    component.onMonthChange('11');
    expect(component.control.value).toBe('2024-11');
  });

  it('recomposes YYYY-MM when the year changes', () => {
    component.onYearChange('2020');
    expect(component.control.value).toBe('2020-03');
  });

  it('clears the value when the month is unset', () => {
    component.onMonthChange('');
    expect(component.control.value).toBeNull();
  });

  it('formats the value as a month name when readonly', () => {
    component.readonly = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toContain('March 2024');
  });

  describe('parsing a stored value', () => {
    function withValue(value: unknown): MonthYearFieldComponent {
      component.control = new FormControl(value);
      return component;
    }

    it('reads the month out of a full YYYY-MM-DD date', () => {
      expect(withValue('2024-07-19').selectedMonth).toBe('07');
      expect(component.selectedYear).toBe('2024');
    });

    it('reports both parts empty for a null or short value', () => {
      expect(withValue(null).selectedMonth).toBe('');
      expect(component.selectedYear).toBe('');
      expect(withValue('20').selectedYear).toBe('');
    });
  });

  describe('recomposition when only one part is set', () => {
    it('defaults the year to the current one when a month is picked first', () => {
      component.control = new FormControl(null);
      component.onMonthChange('05');

      expect(component.control.value).toBe(`${new Date().getFullYear()}-05`);
    });

    it('defaults the month to January when a year is picked first', () => {
      component.control = new FormControl(null);
      component.onYearChange('2030');

      expect(component.control.value).toBe('2030-01');
    });

    it('clears the value when the year is unset', () => {
      component.onYearChange('');
      expect(component.control.value).toBeNull();
    });

    it('marks the control touched on either change, so validation can show', () => {
      component.control = new FormControl(null);
      expect(component.control.touched).toBe(false);

      component.onMonthChange('05');
      expect(component.control.touched).toBe(true);
    });
  });

  describe('formatValue', () => {
    it('shows an em dash for an empty value', () => {
      expect(component.formatValue(null)).toBe('—');
      expect(component.formatValue('')).toBe('—');
    });

    it('returns the raw string when the month is not a real month', () => {
      expect(component.formatValue('2024-13')).toBe('2024-13');
      expect(component.formatValue('nonsense')).toBe('nonsense');
    });
  });
});
