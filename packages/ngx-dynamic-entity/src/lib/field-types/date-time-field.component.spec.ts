import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DateTimeFieldComponent } from './date-time-field.component';

describe('DateTimeFieldComponent', () => {
  let component: DateTimeFieldComponent;
  let fixture: ComponentFixture<DateTimeFieldComponent>;

  /** The stored form of a local time, so assertions do not depend on the runner's zone. */
  const isoFor = (y: number, m: number, d: number, h: number, min: number): string =>
    new Date(y, m - 1, d, h, min).toISOString();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DateTimeFieldComponent, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(DateTimeFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('field', { id: 'seenAt', label: { en: 'Seen at' } } as any);
    fixture.componentRef.setInput('control', new FormControl(isoFor(2020, 1, 1, 10, 30)));
    fixture.detectChanges();
  });

  // The defect this component exists to fix: `datetime` rendered through DateFieldComponent,
  // whose input is type="date", so the time could not be entered and was dropped on save.
  it('renders a datetime-local input', () => {
    const input = fixture.nativeElement.querySelector('input');
    expect(input.type).toBe('datetime-local');
  });

  it('shows the stored time in the input, not just the date', () => {
    const input = fixture.nativeElement.querySelector('input');
    expect(input.value).toBe('2020-01-01T10:30');
  });

  it('stores an edited value as ISO 8601 UTC', () => {
    component.onInput('2020-03-04T16:45');
    expect(component.control.value).toBe(isoFor(2020, 3, 4, 16, 45));
  });

  it('round-trips a value through the input unchanged', () => {
    component.onInput('2020-03-04T16:45');
    expect(component.inputValue).toBe('2020-03-04T16:45');
  });

  it('clears to null on an empty input', () => {
    component.onInput('');
    expect(component.control.value).toBeNull();
  });

  it('keeps an unparseable entry rather than discarding it', () => {
    component.onInput('not-a-date');
    expect(component.control.value).toBe('not-a-date');
  });

  // Legacy values were written by the date-only input, and `new Date('2020-01-01')` is UTC
  // midnight — which is the previous day west of Greenwich.
  it('reads a legacy date-only value as local midnight', () => {
    component.control.setValue('2020-01-01');
    expect(component.inputValue).toBe('2020-01-01T00:00');
  });

  it('shows the time in readonly mode', () => {
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    const val = fixture.nativeElement.querySelector('.ngx-field__value');
    expect(val.textContent).toContain(new Date(isoFor(2020, 1, 1, 10, 30)).toLocaleString());
  });

  it('returns a dash for an empty value', () => {
    expect(component.formatDateTime(null)).toBe('—');
    expect(component.formatDateTime('')).toBe('—');
  });

  it('accepts a Date instance as the stored value', () => {
    component.control.setValue(new Date(2021, 5, 7, 9, 5));
    expect(component.inputValue).toBe('2021-06-07T09:05');
  });

  it('treats an invalid Date instance as empty', () => {
    component.control.setValue(new Date('nonsense'));
    expect(component.inputValue).toBe('');
    expect(component.formatDateTime(new Date('nonsense'))).toBe('—');
  });

  it('treats undefined and an unparseable string as empty in the input', () => {
    component.control.setValue(undefined);
    expect(component.inputValue).toBe('');
    component.control.setValue('not-a-date');
    expect(component.inputValue).toBe('');
  });

  it('disables the input when the field is disabled', () => {
    fixture.componentRef.setInput('field', { id: 'seenAt', label: { en: 'Seen at' }, disabled: true } as any);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input').getAttribute('disabled')).not.toBeNull();
  });

  it('masks the value rather than displaying it', () => {
    fixture.componentRef.setInput('masked', true);
    fixture.detectChanges();
    const masked = fixture.nativeElement.querySelector('[data-testid="field-seenAt-masked"]');
    expect(masked.textContent).toContain('XXXXXXXXX');
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });
});
