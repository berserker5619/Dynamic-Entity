import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { PasswordFieldComponent } from './password-field.component';

describe('PasswordFieldComponent', () => {
  let component: PasswordFieldComponent;
  let fixture: ComponentFixture<PasswordFieldComponent>;

  const mockField: NestedFieldConfig = {
    id: 'password',
    type: 'password',
    label: { en: 'Password' },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(PasswordFieldComponent);
    component = fixture.componentInstance;
    component.field = mockField;
    component.control = new FormControl('hunter2');
    fixture.detectChanges();
  });

  it('hides the value by default', () => {
    expect(fixture.nativeElement.querySelector('input').type).toBe('password');
  });

  it('reveals the value when the eye toggle is clicked', () => {
    fixture.nativeElement.querySelector('.ngx-field__eye-btn').click();
    fixture.detectChanges();
    expect(component.visible()).toBe(true);
    expect(fixture.nativeElement.querySelector('input').type).toBe('text');
  });

  it('never renders the raw value when readonly', () => {
    component.readonly = true;
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('••••••••');
    expect(text).not.toContain('hunter2');
  });
});
