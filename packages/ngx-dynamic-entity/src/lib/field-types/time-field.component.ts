import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { formatDisplayValue, resolveLabel } from '@dynamic-entity/core';

/**
 * Time field: a bare time of day, with no date and no zone attached.
 *
 * Stored as `HH:mm` — exactly the value `<input type="time">` reads and writes, so the
 * control binds straight through with no conversion. That is the whole reason this is a
 * separate type from `datetime`: a recurring 09:00 opening time is not a moment in time,
 * and converting it to UTC would move it whenever the offset changed.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-time-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--time"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label" [attr.for]="field.id">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ formatTime(control.value) }}</span>
      } @else {
        <input
          [id]="field.id"
          class="ngx-field__input" [attr.data-testid]="'field-' + field.id + '-input'"
          type="time"
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
export class TimeFieldComponent {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  /**
   * Defers to core rather than parsing `HH:mm` locally. The other date-ish components each
   * grew their own formatter, and `datetime` ended up showing one thing in the field and
   * another in the record summary because the two drifted apart.
   */
  formatTime(value: unknown): string {
    return formatDisplayValue('time', undefined, value, this.language);
  }
}
