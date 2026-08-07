import { Component, Input } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';

@Component({
  selector: 'ngx-checkbox-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--checkbox" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      @if (masked) {
        <label class="ngx-field__label">{{ label }}</label>
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else if (readonly) {
        <label class="ngx-field__label">{{ label }}</label>
        <span class="ngx-field__value">{{ control.value ? 'Yes' : 'No' }}</span>
      } @else {
        <label class="ngx-field__label" [attr.for]="field.id">
          <input
            [id]="field.id"
            class="ngx-field__input"
            type="checkbox"
            [formControl]="$any(control)"
            [attr.disabled]="field.disabled ? true : null"
          />
          {{ label }}
        </label>
      }
    </div>
  `,
})
export class CheckboxFieldComponent {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }
}
