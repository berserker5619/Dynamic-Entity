import { Component, Input } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';

/** Email field: type="email" input with inline validation hint. */
@Component({
  selector: 'ngx-email-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--email" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value">
          <a [href]="'mailto:' + control.value" class="ngx-field__email-link">{{ control.value || '—' }}</a>
        </span>
      } @else {
        <input
          class="ngx-field__input"
          type="email"
          autocomplete="email"
          [formControl]="$any(control)"
          [placeholder]="placeholder || 'you@example.com'"
          [attr.disabled]="field.disabled ? true : null"
        />
        @if (control.invalid && control.touched) {
          @if (control.errors?.['required']) {
            <span class="ngx-field__error">Email is required</span>
          } @else if (control.errors?.['email']) {
            <span class="ngx-field__error">Enter a valid email address</span>
          } @else {
            <span class="ngx-field__error">This field has an error</span>
          }
        }
      }
    </div>
  `,
})
export class EmailFieldComponent {
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
