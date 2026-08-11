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
  selector: 'ngx-multi-select-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--multiSelect" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value">{{ getLabels(control.value) }}</span>
      } @else {
        <select
          [id]="field.id"
          class="ngx-field__input"
          [formControl]="$any(control)"
          [compareWith]="compareFn"
          [attr.disabled]="field.disabled ? true : null"
          multiple
          size="4"
        >
          @for (option of field.options || []; track getOptLabel(option)) {
            @if (isObjectVal(option)) {
              <option [ngValue]="getOptStoredVal(option)">{{ getOptLabel(option) }}</option>
            } @else {
              <option [value]="getOptStoredVal(option)">{{ getOptLabel(option) }}</option>
            }
          }
        </select>
        @if (control.invalid && control.touched) {
          <span class="ngx-field__error">This field has an error</span>
        }
      }
    </div>
  `,
})
export class MultiSelectFieldComponent {
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

  getOptStoredVal(option: any): any {
    return getOptionStoredValue(option);
  }

  getOptVal(option: any): any {
    return resolveOptionValue(option, this.language);
  }

  getOptLabel(option: any): string {
    return resolveOptionLabel(option, this.language);
  }

  getLabels(values: any[]): string {
    if (!Array.isArray(values) || !values.length) return '—';
    return values
      .map(v => {
        const opt = (this.field.options || []).find(o => valuesMatch(getOptionStoredValue(o), v, this.language));
        return opt ? this.getOptLabel(opt) : (typeof v === 'object' ? resolveLabel(v, this.language) : String(v));
      })
      .join(', ');
  }
}
