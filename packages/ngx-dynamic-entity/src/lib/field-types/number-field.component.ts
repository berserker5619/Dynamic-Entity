import { Component, Input } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';

@Component({
  selector: 'ngx-number-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--number"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
      [class.ngx-field--invalid]="control && control.invalid && control.touched"
    >
      <label class="ngx-field__label" [attr.for]="field.id">
        {{ label }}
        @if (field.validators?.required) { <span class="ngx-field__req">*</span> }
      </label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value">{{ control.value ?? '—' }}</span>
      } @else {
        <input
          [id]="field.id"
          type="number"
          class="ngx-field__input"
          [formControl]="$any(control)"
          [placeholder]="placeholder"
          [attr.disabled]="field.disabled ? true : null"
          [attr.aria-invalid]="control.invalid && control.touched"
          [attr.aria-describedby]="errorMessage ? field.id + '-error' : null"
        />
        @if (errorMessage) {
          <span class="ngx-field__error" [id]="field.id + '-error'" role="alert">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class NumberFieldComponent {
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

  get errorMessage(): string {
    if (!this.control || !this.control.errors || !this.control.touched) return '';
    const errs = this.control.errors;
    if (errs['required']) return 'This field is required.';
    if (errs['min']) return `Value must be at least ${errs['min'].min}.`;
    if (errs['max']) return `Value must not exceed ${errs['max'].max}.`;
    return 'Invalid number.';
  }
}
