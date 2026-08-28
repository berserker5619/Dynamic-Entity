import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ArrayFieldComponent } from './array-field.component';
import type { NestedFieldConfig } from '@dynamic-entity/core';

describe('ArrayFieldComponent', () => {
  let component: ArrayFieldComponent;
  let fixture: ComponentFixture<ArrayFieldComponent>;

  const mockField: NestedFieldConfig = {
    id: 'contacts',
    type: 'array',
    label: { en: 'Contacts List' },
    children: [
      { id: 'name', type: 'text', label: { en: 'Contact Name' } },
      { id: 'phone', type: 'text', label: { en: 'Phone Number' } },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArrayFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(ArrayFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('field', mockField);
    component.control = new FormArray([
      new FormGroup({
        name: new FormControl('Alice'),
        phone: new FormControl('555-0100'),
      }),
    ]);
    fixture.detectChanges();
  });

  it('should render initial items in FormArray', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.ngx-field__label')?.textContent?.trim()).toBe('Contacts List');
    expect(el.querySelectorAll('.ngx-field__array-item').length).toBe(1);
  });

  it('should add item when + Add Item button is clicked', () => {
    component.addItem();
    fixture.detectChanges();
    expect(component.formArray.length).toBe(2);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.ngx-field__array-item').length).toBe(2);
  });

  it('should remove item when Remove button is clicked', () => {
    component.removeItem(0);
    fixture.detectChanges();
    expect(component.formArray.length).toBe(0);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.ngx-field__array-item').length).toBe(0);
    expect(el.querySelector('.ngx-field__array-empty')?.textContent).toContain('No items added yet');
  });
});
