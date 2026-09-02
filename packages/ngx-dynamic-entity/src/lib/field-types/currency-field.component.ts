import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { resolveLabel } from '@dynamic-entity/core';
import { fieldDomId, nextFieldInstanceId } from './field-dom-id';

/** Currency field: number input with locale-aware currency symbol prefix. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-currency-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--currency"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
    >
      <label class="ngx-field__label" [attr.for]="domId()">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">{{
          maskedText
        }}</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'"
          >{{ symbol }}{{ control.value }}</span
        >
      } @else {
        <div class="ngx-field__currency-wrap">
          <span class="ngx-field__currency-symbol">{{ symbol }}</span>
          <input
            [id]="domId()"
            class="ngx-field__input ngx-field__input--currency"
            [attr.data-testid]="'field-' + field.id + '-input'"
            type="number"
            step="0.01"
            [formControl]="$any(control)"
            [placeholder]="placeholder || '0.00'"
            [attr.disabled]="field.disabled ? true : null"
          />
        </div>
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class CurrencyFieldComponent {
  /**
   * Unique to this component instance: an `array` renders the same field once per row, and a
   * DOM id may not repeat. See `field-dom-id.ts`.
   */
  private readonly instanceId = nextFieldInstanceId();
  protected domId(suffix = ''): string {
    return fieldDomId(this.field, this.instanceId, suffix);
  }

  /** Overridable via MASKED_PLACEHOLDER; the default is the historic literal. */
  protected readonly maskedText = inject(MASKED_PLACEHOLDER, { optional: true }) ?? 'XXXXXXXXX';
  private readonly messages = inject(ValidationMessagesService);
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
      return (
        (0)
          .toLocaleString(this.language, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })
          .replace(/[\d,.\s]/g, '')
          .trim() || '$'
      );
    } catch {
      return '$';
    }
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
