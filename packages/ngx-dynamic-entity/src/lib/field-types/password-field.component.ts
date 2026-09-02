import { Component, Input, signal, ChangeDetectionStrategy, inject} from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { resolveLabel } from '@dynamic-entity/core';

/** Password field: masked input with show/hide eye toggle. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-password-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--password"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">••••••••</span>
      } @else {
        <div class="ngx-field__password-wrap">
          <input
            class="ngx-field__input" [attr.data-testid]="'field-' + field.id + '-input'"
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
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class PasswordFieldComponent {
  private readonly messages = inject(ValidationMessagesService);
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
  /**
   * Resolved through `ValidationMessagesService`, so `provideNgxDynamicEntity({
   * validationMessages })` reaches this field. It used to render a fixed
   * "This field has an error", which made a documented, configurable feature work on three
   * of fifteen field types.
   */
  get errorMessage(): string {
    if (!this.control?.errors || !this.control.touched) return '';
    return this.messages.resolve(this.control.errors, this.language, [
      'required',
      'email',
      'min',
      'max',
      'minlength',
      'maxlength',
      'pattern',
    ]);
  }

}
