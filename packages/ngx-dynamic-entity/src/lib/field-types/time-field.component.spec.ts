import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TimeFieldComponent } from './time-field.component';

describe('TimeFieldComponent', () => {
  let component: TimeFieldComponent;
  let fixture: ComponentFixture<TimeFieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimeFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(TimeFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('field', { id: 'opensAt', label: { en: 'Opens at' } } as any);
    fixture.componentRef.setInput('control', new FormControl('09:00'));
    fixture.detectChanges();
  });

  it('renders a time input', () => {
    const input = fixture.nativeElement.querySelector('input');
    expect(input.type).toBe('time');
  });

  // `HH:mm` is the input's own value format, so the control binds straight through. No
  // conversion means nothing to drift, which is the point of storing it this way.
  it('binds the stored HH:mm value directly', () => {
    expect(fixture.nativeElement.querySelector('input').value).toBe('09:00');
  });

  it('writes the input value back to the control unchanged', () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    input.value = '17:45';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.control.value).toBe('17:45');
  });

  it('formats the value for readonly display', () => {
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    const val = fixture.nativeElement.querySelector('.ngx-field__value');
    expect(val.textContent.trim()).toBe(
      new Date(2000, 0, 1, 9, 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('returns a dash for an empty or unparseable value', () => {
    expect(component.formatTime(null)).toBe('—');
    expect(component.formatTime('')).toBe('—');
    expect(component.formatTime('half past nine')).toBe('—');
  });

  it('masks the value rather than displaying it', () => {
    fixture.componentRef.setInput('masked', true);
    fixture.detectChanges();
    const masked = fixture.nativeElement.querySelector('[data-testid="field-opensAt-masked"]');
    expect(masked.textContent).toContain('XXXXXXXXX');
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });

  it('disables the input when the field is disabled', () => {
    fixture.componentRef.setInput('field', { id: 'opensAt', label: { en: 'Opens at' }, disabled: true } as any);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input').getAttribute('disabled')).not.toBeNull();
  });
});
