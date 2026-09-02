import { Component, Input, ChangeDetectionStrategy, inject} from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { resolveLabel } from '@dynamic-entity/core';

/**
 * Boolean field: a slide-toggle style switch (true/false).
 * Distinct from `checkbox` (which is a standalone bool) in that it renders as a
 * toggle switch with Yes/No labels for clearer binary state communication.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-boolean-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--boolean"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      @if (masked) {
        <label class="ngx-field__label">{{ label }}</label>
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else if (readonly) {
        <label class="ngx-field__label">{{ label }}</label>
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ control.value ? 'Yes' : 'No' }}</span>
      } @else {
        <div class="ngx-field__toggle-wrap">
          <label class="ngx-field__toggle-label">{{ label }}</label>
          <label class="ngx-field__toggle-switch" [class.ngx-field__toggle-switch--checked]="control.value">
            <input
              class="ngx-field__toggle-input"
              type="checkbox"
              role="switch"
              [formControl]="$any(control)"
              [attr.disabled]="field.disabled ? true : null"
              [attr.aria-checked]="control.value"
            />
            <span class="ngx-field__toggle-track">
              <span class="ngx-field__toggle-thumb"></span>
            </span>
            <span class="ngx-field__toggle-text">{{ control.value ? 'Yes' : 'No' }}</span>
          </label>
        </div>
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'" role="alert">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class BooleanFieldComponent {
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
   * Configured messages reach this field too.
   *
   * It rendered no error element at all, so a required checkbox left unticked told the user
   * nothing — and `validationMessages` could not reach a field that never displayed one.
   */
  get errorMessage(): string {
    if (!this.control?.errors || !this.control.touched) return '';
    return this.messages.resolve(this.control.errors, this.language, ['required', 'pattern']);
  }

}
