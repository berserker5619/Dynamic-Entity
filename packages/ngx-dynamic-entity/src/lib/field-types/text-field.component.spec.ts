import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TextFieldComponent } from './text-field.component';
import type { NestedFieldConfig } from '@dynamic-entity/core';

describe('TextFieldComponent', () => {
  let component: TextFieldComponent;
  let fixture: ComponentFixture<TextFieldComponent>;
  const mockField: NestedFieldConfig = {
    id: 'name',
    type: 'text',
    label: { en: 'Full Name' },
    placeholder: { en: 'Enter name' }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TextFieldComponent, ReactiveFormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(TextFieldComponent);
    component = fixture.componentInstance;
    component.field = mockField;
    component.control = new FormControl('Initial');
    fixture.detectChanges();
  });

  it('should render label', () => {
    const label = fixture.nativeElement.querySelector('label');
    expect(label.textContent).toBe('Full Name');
  });

  it('should render input when not masked or readonly', () => {
    const input = fixture.nativeElement.querySelector('input');
    expect(input).toBeTruthy();
    expect(input.value).toBe('Initial');
  });

  it('should render masked value when masked is true', () => {
    component.masked = true;
    fixture.detectChanges();
    const masked = fixture.nativeElement.querySelector('.ngx-field__value--masked');
    expect(masked).toBeTruthy();
    expect(masked.textContent).toBe('XXXXXXXXX');
  });

  it('should render static value when readonly is true', () => {
    component.readonly = true;
    fixture.detectChanges();
    const val = fixture.nativeElement.querySelector('.ngx-field__value');
    expect(val).toBeTruthy();
    expect(val.textContent).toBe('Initial');
  });
});
