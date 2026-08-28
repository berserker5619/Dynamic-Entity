import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CheckboxFieldComponent } from './checkbox-field.component';

describe('CheckboxFieldComponent', () => {
  let fixture: ComponentFixture<CheckboxFieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CheckboxFieldComponent, ReactiveFormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(CheckboxFieldComponent);
    fixture.componentRef.setInput('field', { id: 'active', type: 'checkbox', label: { en: 'Active' } });
    fixture.componentRef.setInput('control', new FormControl(true));
    fixture.detectChanges();
  });

  it('should render checked input', () => {
    const input = fixture.nativeElement.querySelector('input');
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBeTrue();
  });

  it('should render Yes/No in readonly mode', () => {
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    const val = fixture.nativeElement.querySelector('.ngx-field__value');
    expect(val.textContent).toBe('Yes');
    
    fixture.componentRef.setInput('control', new FormControl(false));
    fixture.detectChanges();
    expect(val.textContent).toBe('No');
  });
});
