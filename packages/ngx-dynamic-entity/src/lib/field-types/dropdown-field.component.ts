import { Component, Input } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';

@Component({
  selector: 'ngx-dropdown-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--dropdown" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value">{{ getLabel(control.value) }}</span>
      } @else {
        <select
          class="ngx-field__input"
          [formControl]="$any(control)"
          [attr.disabled]="field.disabled ? true : null"
        >
          <option value="">{{ placeholder || 'Select...' }}</option>
          @for (option of field.options || []; track option.value) {
            <option [value]="option.value">{{ resolveOptionLabel(option) }}</option>
          }
        </select>
        @if (control.invalid && control.touched) {
          <span class="ngx-field__error">This field has an error</span>
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

  resolveOptionLabel(option: { label: any }): string {
    return resolveLabel(option.label, this.language);
  }

  getLabel(value: any): string {
    const option = (this.field.options || []).find(o => o.value === value);
    return option ? resolveLabel(option.label, this.language) : (value ?? '—');
  }
}
