import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-date-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--date"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label" [attr.for]="field.id">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ formatDate(control.value) }}</span>
      } @else {
        <input
          [id]="field.id"
          class="ngx-field__input" [attr.data-testid]="'field-' + field.id + '-input'"
          type="date"
          [formControl]="$any(control)"
          [attr.disabled]="field.disabled ? true : null"
        />
        @if (control.invalid && control.touched) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">This field has an error</span>
        }
      }
    </div>
  `,
})
export class DateFieldComponent {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  /** ISO 8601 date → locale display string (ONEHERMES convention: always UTC, display in user locale) */
  formatDate(value: string | null): string {
    if (!value) return '—';
    // `new Date('nonsense')` does not throw and `toLocaleDateString()` returns the *string*
    // "Invalid Date", so the try/catch this replaced never fired and readers saw that text
    // instead of their data. Records outlive schemas — a field retyped from text to date can
    // hold anything — so an unparseable value is shown as stored.
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  }
}
