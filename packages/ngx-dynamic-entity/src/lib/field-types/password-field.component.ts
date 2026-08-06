import { Component, Input, signal } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';

/** Password field: masked input with show/hide eye toggle. */
@Component({
  selector: 'ngx-password-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--password" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value">••••••••</span>
      } @else {
        <div class="ngx-field__password-wrap">
          <input
            class="ngx-field__input"
            [type]="visible() ? 'text' : 'password'"
            autocomplete="current-password"
            [formControl]="$any(control)"
            [placeholder]="placeholder || '••••••••'"
            [attr.disabled]="field.disabled ? true : null"
          />
          <button
            type="button"
            class="ngx-field__eye-btn"
            (click)="toggleVisibility()"
            [attr.aria-label]="visible() ? 'Hide password' : 'Show password'"
          >
            {{ visible() ? '🙈' : '👁' }}
          </button>
        </div>
        @if (control.invalid && control.touched) {
          <span class="ngx-field__error">This field has an error</span>
        }
      }
    </div>
  `,
})
export class PasswordFieldComponent {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  readonly visible = signal(false);

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  get placeholder(): string {
    return resolveLabel(this.field?.placeholder, this.language);
  }

  toggleVisibility(): void {
    this.visible.update(v => !v);
  }
}
