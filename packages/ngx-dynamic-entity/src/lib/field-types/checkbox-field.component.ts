import { Component, Input, ChangeDetectionStrategy, inject} from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { resolveLabel } from '@dynamic-entity/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-checkbox-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--checkbox"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      @if (masked) {
        <label class="ngx-field__label">{{ label }}</label>
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else if (readonly) {
        <label class="ngx-field__label">{{ label }}</label>
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ control.value ? 'Yes' : 'No' }}</span>
      } @else {
        <label class="ngx-field__label" [attr.for]="field.id">
          <input
            [id]="field.id"
            class="ngx-field__input" [attr.data-testid]="'field-' + field.id + '-input'"
            type="checkbox"
            [formControl]="$any(control)"
            [attr.disabled]="field.disabled ? true : null"
          />
          {{ label }}
        </label>
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'" role="alert">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class CheckboxFieldComponent {
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
