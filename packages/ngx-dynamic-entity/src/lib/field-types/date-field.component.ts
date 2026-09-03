import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { formatDisplayValue, resolveLabel } from '@dynamic-entity/core';

import { fieldDomId, nextFieldInstanceId } from './field-dom-id';
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-date-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--date"
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
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{
          formatDate(control.value)
        }}</span>
      } @else {
        <input
          [id]="domId()"
          class="ngx-field__input"
          [attr.data-testid]="'field-' + field.id + '-input'"
          type="date"
          [formControl]="$any(control)"
          [attr.disabled]="field.disabled ? true : null"
        />
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class DateFieldComponent {
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

  /**
   * ISO 8601 date → display string, through the formatter the host configured.
   *
   * This used to call `toLocaleDateString()` directly, which meant `setDateFormatters` — the
   * one seam for choosing how a date is rendered — reached the record summary and the `time`
   * field but not this one. A host that configured formatters got them almost everywhere,
   * and silently did not get them on the field type most likely to be the reason they
   * configured formatters at all.
   *
   * The default formatter is `toLocaleDateString()` with no locale, so an application that
   * has not called `setDateFormatters` renders exactly what it rendered before.
   */
  formatDate(value: string | null): string {
    if (!value) return '—';
    // `new Date('nonsense')` does not throw and `toLocaleDateString()` returns the *string*
    // "Invalid Date", so the try/catch this replaced never fired and readers saw that text
    // instead of their data. Records outlive schemas — a field retyped from text to date can
    // hold anything — so an unparseable value is shown as stored, and never reaches the
    // formatter.
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return formatDisplayValue('date', undefined, value, this.language);
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
