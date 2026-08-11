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

/** Radio field: a group of radio buttons built from field.options. */
@Component({
  selector: 'ngx-radio-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--radio" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <fieldset class="ngx-field__fieldset">
        <legend class="ngx-field__label">{{ label }}</legend>
        @if (masked) {
          <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
        } @else if (readonly) {
          <span class="ngx-field__value">{{ getSelectedLabel() }}</span>
        } @else {
          <div class="ngx-field__radio-group">
            @for (option of field.options || []; track getOptLabel(option)) {
              <label class="ngx-field__radio-option" [attr.for]="field.id + '-' + getOptVal(option)">
                <input
                  [id]="field.id + '-' + getOptVal(option)"
                  type="radio"
                  class="ngx-field__radio-input"
                  [formControl]="$any(control)"
                  [value]="getOptStoredVal(option)"
                  [attr.disabled]="field.disabled ? true : null"
                />
                <span class="ngx-field__radio-label">{{ getOptLabel(option) }}</span>
              </label>
            }
          </div>
          @if (control.invalid && control.touched) {
            <span class="ngx-field__error">This field has an error</span>
          }
        }
      </fieldset>
    </div>
  `,
})
export class RadioFieldComponent {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

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

  getSelectedLabel(): string {
    const selected = (this.field.options ?? []).find(o => valuesMatch(getOptionStoredValue(o), this.control?.value, this.language));
    return selected ? this.getOptLabel(selected) : (typeof this.control?.value === 'object' ? resolveLabel(this.control.value, this.language) : (this.control?.value ?? '—'));
  }
}
