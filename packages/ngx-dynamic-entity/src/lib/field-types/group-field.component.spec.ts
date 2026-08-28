import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { GroupFieldComponent } from './group-field.component';
import type { NestedFieldConfig } from '@dynamic-entity/core';

describe('GroupFieldComponent', () => {
  let component: GroupFieldComponent;
  let fixture: ComponentFixture<GroupFieldComponent>;

  const mockField: NestedFieldConfig = {
    id: 'address',
    type: 'group',
    label: { en: 'Address Details' },
    children: [
      { id: 'street', type: 'text', label: { en: 'Street' } },
      { id: 'city', type: 'text', label: { en: 'City' } },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('field', mockField);
    component.control = new FormGroup({
      street: new FormControl('123 Main St'),
      city: new FormControl('Metropolis'),
    });
    fixture.detectChanges();
  });

  it('should render group title and nested child controls', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.ngx-field__legend')?.textContent?.trim()).toBe('Address Details');
    expect(el.querySelectorAll('ngx-dynamic-field').length).toBe(2);
  });

  it('should render masked representation when masked is true', () => {
    fixture.componentRef.setInput('masked', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.ngx-field__value--masked')?.textContent).toBe('XXXXXXXXX');
  });
});
