import { Component, Input } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import {
  getOptionStoredValue,
  resolveLabel,
  resolveOptionLabel,
  resolveOptionValue,
  valuesMatch,
} from '@dynamic-entity/core';

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
          [compareWith]="compareFn"
          [attr.disabled]="field.disabled ? true : null"
          [attr.aria-invalid]="control.invalid && control.touched"
          [attr.aria-describedby]="errorMessage ? field.id + '-error' : null"
        >
          <option [value]="''">{{ placeholder || 'Select...' }}</option>
          @for (option of field.options || []; track getOptLabel(option)) {
            @if (isObjectVal(option)) {
              <option [ngValue]="getOptStoredVal(option)">{{ getOptLabel(option) }}</option>
            } @else {
              <option [value]="getOptStoredVal(option)">{{ getOptLabel(option) }}</option>
            }
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

  readonly compareFn = (o1: any, o2: any): boolean => valuesMatch(o1, o2, this.language);

  isObjectVal(option: any): boolean {
    const val = getOptionStoredValue(option);
    return typeof val === 'object' && val !== null;
  }

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  get placeholder(): string {
    return resolveLabel(this.field?.placeholder, this.language);
  }

  getOptStoredVal(option: any): any {
    return getOptionStoredValue(option);
  }

  getOptVal(option: any): any {
    return resolveOptionValue(option, this.language);
  }

  getOptLabel(option: any): string {
    return resolveOptionLabel(option, this.language);
  }

  getLabel(value: any): string {
    if (value == null || value === '') return '—';
    const option = (this.field.options || []).find(o => valuesMatch(getOptionStoredValue(o), value, this.language));
    return option ? this.getOptLabel(option) : (typeof value === 'object' ? resolveLabel(value, this.language) : (value ?? '—'));
  }

  get errorMessage(): string {
    if (!this.control || !this.control.errors || !this.control.touched) return '';
    const errs = this.control.errors;
    if (errs['required']) return 'Please select an option.';
    return 'Invalid selection.';
  }
}
