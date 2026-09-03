import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig, RichFieldType } from '@dynamic-entity/core';
import { setDateFormatters } from '@dynamic-entity/core';
import { DateFieldComponent } from './date-field.component';
import { DateTimeFieldComponent } from './date-time-field.component';
import { TimeFieldComponent } from './time-field.component';

/**
 * `setDateFormatters` must reach every field that renders a date, not most of them.
 *
 * The defect this guards: `date` and `datetime` formatted with their own
 * `toLocaleDateString()` / `toLocaleString()` calls, while the record summary and the `time`
 * field went through core's `formatDisplayValue`. A host that configured formatters got them
 * on some surfaces and not others — and nothing failed, because every test in the suite
 * asserted against the browser's own locale output, which is what both paths produced.
 *
 * The sweep is written per type rather than per component so a date-rendering field added
 * later has an obvious place to be listed, and an obvious failure when it is not.
 */
describe('the configured date formatters reach every field that renders a date', () => {
  /** A fixed instant, and a stored value in the shape each field type actually holds. */
  const CASES: [type: string, component: unknown, stored: string, marker: string][] = [
    ['date', DateFieldComponent, '2020-01-15', 'FORMATTED-DATE'],
    ['datetime', DateTimeFieldComponent, '2020-01-15T09:30:00.000Z', 'FORMATTED-DATETIME'],
    ['time', TimeFieldComponent, '09:30', 'FORMATTED-TIME'],
  ];

  afterEach(() => setDateFormatters());

  function render(type: string, component: unknown, stored: string): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [component as never, ReactiveFormsModule] });
    const fixture = TestBed.createComponent(component as never);
    const field: NestedFieldConfig = { id: 'probe', type: type as RichFieldType, label: { en: 'Probe' } };
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('control', new FormControl(stored));
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  for (const [type, component, stored, marker] of CASES) {
    it(`${type} renders through the configured formatter`, () => {
      setDateFormatters({
        date: () => marker,
        datetime: () => marker,
        time: () => marker,
      });

      const host = render(type, component, stored);
      expect(host.querySelector('[data-testid="field-probe-value"]')!.textContent).toContain(marker);
    });

    it(`${type} is handed the form's language, not the browser's`, () => {
      const seen: (string | undefined)[] = [];
      const record = (_d: Date, lang?: string) => {
        seen.push(lang);
        return 'x';
      };
      setDateFormatters({ date: record, datetime: record, time: record });

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [component as never, ReactiveFormsModule] });
      const fixture = TestBed.createComponent(component as never);
      fixture.componentRef.setInput('field', { id: 'probe', type, label: { en: 'Probe' } });
      fixture.componentRef.setInput('control', new FormControl(stored));
      fixture.componentRef.setInput('readonly', true);
      fixture.componentRef.setInput('language', 'de');
      fixture.detectChanges();

      expect(seen).toContain('de');
    });
  }

  it('renders exactly as before when no formatter is configured', () => {
    // The defaults are the same `toLocale*` calls these fields used to make directly, so an
    // application that never calls `setDateFormatters` sees no change from this fix. If that
    // stops being true, it is a silent visual change on upgrade for every consumer.
    const host = render('date', DateFieldComponent, '2020-01-15');
    const shown = host.querySelector('[data-testid="field-probe-value"]')!.textContent!.trim();
    expect(shown).toBe(new Date('2020-01-15').toLocaleDateString());
  });

  it('shows an unparseable value as stored rather than passing it to a formatter', () => {
    // Records outlive schemas: a field retyped from text to date can hold anything. The
    // formatter is only reached for a value that parses.
    setDateFormatters({ date: () => 'FORMATTER-RAN' });

    const host = render('date', DateFieldComponent, 'not a date at all');
    const shown = host.querySelector('[data-testid="field-probe-value"]')!.textContent!.trim();
    expect(shown).toBe('not a date at all');
  });
});
