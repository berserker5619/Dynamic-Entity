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
});
