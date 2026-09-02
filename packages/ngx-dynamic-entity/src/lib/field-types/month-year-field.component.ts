import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { resolveLabel } from '@dynamic-entity/core';
import { UiTextService } from '../services/ui-text.service';
import { fieldDomId, nextFieldInstanceId } from './field-dom-id';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 80 }, (_, i) => CURRENT_YEAR - i);

/**
 * Month-Year field: two linked selects (Month + Year).
 * Value stored as ISO partial date string "YYYY-MM" for unambiguous storage.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-month-year-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--month-year"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
    >
      <!--
        Points at the month select: one visible label stands in front of two controls, and a
        label pointing at neither of them announces as nothing and focuses nothing when
        clicked. Each select then carries its own name below, because "Billing Cycle" alone
        does not say which half of the pair the screen reader has landed on.
      -->
      <label class="ngx-field__label" [attr.for]="domId('-month')">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">{{
          maskedText
        }}</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{
          formatValue(control.value)
        }}</span>
      } @else {
        <div class="ngx-field__month-year-wrap">
          <select
            [id]="domId('-month')"
            class="ngx-field__input ngx-field__input--month"
            [attr.aria-label]="label + ' ' + ui.text('month', language)"
            [attr.data-testid]="'field-' + field.id + '-month'"
            [value]="selectedMonth"
            (change)="onMonthChange($any($event.target).value)"
            [attr.disabled]="field.disabled ? true : null"
          >
            <option value="">{{ ui.text('month', language) }}</option>
            @for (m of months; track m.value) {
              <option [value]="m.value">{{ m.label }}</option>
            }
          </select>
          <select
            [id]="domId('-year')"
            class="ngx-field__input ngx-field__input--year"
            [attr.aria-label]="label + ' ' + ui.text('year', language)"
            [attr.data-testid]="'field-' + field.id + '-year'"
            [value]="selectedYear"
            (change)="onYearChange($any($event.target).value)"
            [attr.disabled]="field.disabled ? true : null"
          >
            <option value="">{{ ui.text('year', language) }}</option>
            @for (y of years; track y) {
              <option [value]="y">{{ y }}</option>
            }
          </select>
        </div>
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class MonthYearFieldComponent {
  /**
   * Unique to this component instance: an `array` renders the same field once per row, and a
   * DOM id may not repeat. See `field-dom-id.ts`.
   */
  private readonly instanceId = nextFieldInstanceId();
  protected domId(suffix = ''): string {
    return fieldDomId(this.field, this.instanceId, suffix);
  }

  /** Library chrome, overridable via UI_TEXT. */
  protected readonly ui = inject(UiTextService);
  /** Overridable via MASKED_PLACEHOLDER; the default is the historic literal. */
  protected readonly maskedText = inject(MASKED_PLACEHOLDER, { optional: true }) ?? 'XXXXXXXXX';
  private readonly messages = inject(ValidationMessagesService);
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  readonly months = MONTH_NAMES.map((label, i) => ({ value: String(i + 1).padStart(2, '0'), label }));
  readonly years = YEARS;

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  /** Parses "YYYY-MM" or "YYYY-MM-DD" stored value → month part. */
  get selectedMonth(): string {
    const v = String(this.control.value ?? '');
    return v.length >= 7 ? v.substring(5, 7) : '';
  }

  get selectedYear(): string {
    const v = String(this.control.value ?? '');
    return v.length >= 4 ? v.substring(0, 4) : '';
  }

  onMonthChange(month: string): void {
    const year = this.selectedYear || new Date().getFullYear().toString();
    this.control.setValue(month ? `${year}-${month}` : null);
    this.control.markAsTouched();
  }

  onYearChange(year: string): void {
    const month = this.selectedMonth || '01';
    this.control.setValue(year ? `${year}-${month}` : null);
    this.control.markAsTouched();
  }

  formatValue(value: unknown): string {
    if (!value) return '—';
    const [year, monthNum] = String(value).split('-');
    const monthName = MONTH_NAMES[parseInt(monthNum, 10) - 1];
    return monthName && year ? `${monthName} ${year}` : String(value);
  }
  /**
   * Resolved through `ValidationMessagesService`, so `provideNgxDynamicEntity({
   * validationMessages })` reaches this field. It used to render a fixed
   * "This field has an error", which made a documented, configurable feature work on three
   * of fifteen field types.
   */
  get errorMessage(): string {
    if (!this.control?.errors || !this.control.touched) return '';
    return this.messages.resolve(this.control.errors, this.language, [
      'required',
      'email',
      'min',
      'max',
      'minlength',
      'maxlength',
      'pattern',
    ]);
  }
}
