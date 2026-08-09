import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { RadioFieldComponent } from './radio-field.component';

describe('RadioFieldComponent', () => {
  let component: RadioFieldComponent;
  let fixture: ComponentFixture<RadioFieldComponent>;

  const mockField: NestedFieldConfig = {
    id: 'size',
    type: 'radio',
    label: { en: 'Size' },
    options: [
      { value: 's', label: { en: 'Small' } },
      { value: 'l', label: { en: 'Large' } },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RadioFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(RadioFieldComponent);
    component = fixture.componentInstance;
    component.field = mockField;
    component.control = new FormControl('l');
    fixture.detectChanges();
  });

  it('renders one radio per option with unique ids', () => {
    const inputs: HTMLInputElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('input[type="radio"]'),
    );
    expect(inputs.length).toBe(2);
    expect(inputs.map(i => i.id)).toEqual(['size-s', 'size-l']);
  });

  it('resolves the selected option label when readonly', () => {
    component.readonly = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toContain('Large');
  });

  it('renders the legend from the localized label', () => {
    expect(fixture.nativeElement.querySelector('legend').textContent).toContain('Size');
  });

  it('masks the value for masked roles', () => {
    component.masked = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value--masked')).toBeTruthy();
  });
});
