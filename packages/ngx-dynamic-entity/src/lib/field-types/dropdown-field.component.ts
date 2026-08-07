import { Component, Input } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel, resolveOptionLabel, resolveOptionValue } from '@dynamic-entity/core';

@Component({
  selector: 'ngx-dropdown-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--dropdown"
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
        <span class="ngx-field__value">{{ getLabel(control.value) }}</span>
      } @else {
        <select
          [id]="field.id"
          class="ngx-field__input"
          [formControl]="$any(control)"
          [attr.disabled]="field.disabled ? true : null"
          [attr.aria-invalid]="control.invalid && control.touched"
          [attr.aria-describedby]="errorMessage ? field.id + '-error' : null"
        >
          <option value="">{{ placeholder || 'Select...' }}</option>
          @for (option of field.options || []; track getOptVal(option)) {
            <option [value]="getOptVal(option)">{{ getOptLabel(option) }}</option>
          }
        </select>
        @if (errorMessage) {
          <span class="ngx-field__error" [id]="field.id + '-error'" role="alert">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class DropdownFieldComponent {
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

  getOptVal(option: any): any {
    return resolveOptionValue(option, this.language);
  }

  getOptLabel(option: any): string {
    return resolveOptionLabel(option, this.language);
  }

  getLabel(value: any): string {
    const option = (this.field.options || []).find(o => this.getOptVal(o) === value);
    return option ? this.getOptLabel(option) : (value ?? '—');
  }

  get errorMessage(): string {
    if (!this.control || !this.control.errors || !this.control.touched) return '';
    const errs = this.control.errors;
    if (errs['required']) return 'Please select an option.';
    return 'Invalid selection.';
  }
}
