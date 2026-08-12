import { Component, Input } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';

/** Currency field: number input with locale-aware currency symbol prefix. */
@Component({
  selector: 'ngx-currency-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--currency"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ symbol }}{{ control.value }}</span>
      } @else {
        <div class="ngx-field__currency-wrap">
          <span class="ngx-field__currency-symbol">{{ symbol }}</span>
          <input
            class="ngx-field__input ngx-field__input--currency" [attr.data-testid]="'field-' + field.id + '-input'"
            type="number"
            step="0.01"
            [formControl]="$any(control)"
            [placeholder]="placeholder || '0.00'"
            [attr.disabled]="field.disabled ? true : null"
          />
        </div>
        @if (control.invalid && control.touched) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">This field has an error</span>
        }
      }
    </div>
  `,
})
export class CurrencyFieldComponent {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  get placeholder(): string {
    return resolveLabel(this.field?.placeholder, this.language);
  }

  /** Picks the currency symbol from the locale — defaults to '$'. */
  get symbol(): string {
    try {
      return (0).toLocaleString(this.language, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })
        .replace(/[\d,.\s]/g, '').trim() || '$';
    } catch {
      return '$';
    }
  }
}
