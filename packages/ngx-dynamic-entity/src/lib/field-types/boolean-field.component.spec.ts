import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { BooleanFieldComponent } from './boolean-field.component';

describe('BooleanFieldComponent', () => {
  let component: BooleanFieldComponent;
  let fixture: ComponentFixture<BooleanFieldComponent>;

  const mockField: NestedFieldConfig = {
    id: 'active',
    type: 'boolean',
    label: { en: 'Active' },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BooleanFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(BooleanFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('field', mockField);
    fixture.componentRef.setInput('control', new FormControl(true));
    fixture.detectChanges();
  });

  it('renders a switch reflecting the control value', () => {
    const input = fixture.nativeElement.querySelector('input[role="switch"]');
    expect(input).toBeTruthy();
    expect(input.getAttribute('aria-checked')).toBe('true');
    expect(fixture.nativeElement.querySelector('.ngx-field__toggle-text').textContent).toContain('Yes');
  });

  it('renders No when false', () => {
    fixture.componentRef.setInput('control', new FormControl(false));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__toggle-text').textContent).toContain('No');
  });

  it('renders Yes/No text when readonly', () => {
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toContain('Yes');
  });
});
