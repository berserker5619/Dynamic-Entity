import { Component, Input } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';

@Component({
  selector: 'ngx-textarea-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--textarea"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label" [attr.for]="field.id">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ control.value }}</span>
      } @else {
        <textarea
          [id]="field.id"
          class="ngx-field__input" [attr.data-testid]="'field-' + field.id + '-input'"
          [formControl]="$any(control)"
          [placeholder]="placeholder"
          [attr.disabled]="field.disabled ? true : null"
          rows="3"
        ></textarea>
        @if (control.invalid && control.touched) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">This field has an error</span>
        }
      }
    </div>
  `,
})
export class TextareaFieldComponent {
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
}
