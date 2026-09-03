import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { formatDisplayValue, resolveLabel } from '@dynamic-entity/core';

import { fieldDomId, nextFieldInstanceId } from './field-dom-id';
/**
 * Reads a stored value into a `Date`.
 *
 * A bare calendar date is pinned to *local* midnight. `new Date('2020-01-01')` reads a
 * date-only string as UTC midnight, which renders as the previous day anywhere west of
 * Greenwich — and every legacy `datetime` value has exactly that shape, because the type
 * used to render through `DateFieldComponent` and its `type="date"` input.
 */
function parseStored(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]);

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Date & Time field: a single `datetime-local` input.
 *
 * The type is stored as ISO 8601 UTC, per the same convention `date` follows, while the
 * input works in the viewer's local zone — `datetime-local` has no offset, so the two
 * conversions here are what keep a value stable across a round trip.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-date-time-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--datetime"
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
          formatDateTime(control.value)
        }}</span>
      } @else {
        <input
          [id]="domId()"
          class="ngx-field__input"
          [attr.data-testid]="'field-' + field.id + '-input'"
          type="datetime-local"
          [value]="inputValue"
          (change)="onInput($any($event.target).value)"
          [attr.disabled]="field.disabled ? true : null"
        />
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class DateTimeFieldComponent {
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

  /** Stored ISO 8601 → the `YYYY-MM-DDTHH:mm` local form the input requires. */
  get inputValue(): string {
    const d = parseStored(this.control?.value);
    if (!d) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** The input's local `YYYY-MM-DDTHH:mm` → stored ISO 8601 UTC. */
  onInput(value: string): void {
    if (!value) {
      this.control.setValue(null);
      this.control.markAsTouched();
      return;
    }
    const d = new Date(value);
    // An unparseable value is stored verbatim rather than silently discarded, so a validator
    // sees what the user actually entered.
    this.control.setValue(Number.isNaN(d.getTime()) ? value : d.toISOString());
    this.control.markAsTouched();
  }

  /**
   * Displays date *and* time, through the formatter the host configured.
   *
   * Two rounds of the same fault. First this called `toLocaleDateString()`, so a datetime
   * read back through the field showed no time while the record summary showed it. Then it
   * called `toLocaleString()` directly, which fixed the time but kept the field outside
   * `setDateFormatters` — so a host that configured formatters still saw them apply to the
   * summary and not to the field. Going through `formatDisplayValue` is what makes the two
   * paths agree by construction rather than by matching literals.
   *
   * `parseStored` accepts shapes `new Date(raw)` alone does not, so the *parsed* instant is
   * handed on as ISO rather than the raw value.
   */
  formatDateTime(value: unknown): string {
    const d = parseStored(value);
    if (!d) return '—';
    return formatDisplayValue('datetime', undefined, d.toISOString(), this.language);
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
