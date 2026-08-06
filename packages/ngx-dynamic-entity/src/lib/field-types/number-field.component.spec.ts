import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { NumberFieldComponent } from './number-field.component';
import type { NestedFieldConfig } from '@dynamic-entity/core';

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
});
