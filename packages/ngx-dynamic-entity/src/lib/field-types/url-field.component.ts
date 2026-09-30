import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { isValidUrl, resolveLabel } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { fieldDescribedBy, fieldDomId, nextFieldInstanceId } from './field-dom-id';

/**
 * URL field: a `type="url"` input, and a link when read-only.
 *
 * The read-only link is rendered only for a value that passes `isValidUrl`, meaning an http or
 * https address. A record can hold anything, including `javascript:`, and a field whose job is
 * to show an address must not turn a stored script into something to click. Anything else is
 * shown as plain text.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-url-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--url"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
      [class.ngx-field--invalid]="control && control.invalid && control.touched"
    >
      <div class="ngx-field__label-row">
        <label class="ngx-field__label" [attr.for]="domId()">
          {{ label }}
          @if (field.validators?.required) {
            <span class="ngx-field__req">*</span>
          }
        </label>
        @if (hint) {
          <span class="ngx-field__hint-wrap">
            <span class="ngx-field__hint-icon" aria-hidden="true">i</span>
            <span
              class="ngx-field__hint"
              role="tooltip"
              [attr.data-testid]="'field-' + field.id + '-hint'"
              [id]="domId('-hint')"
              >{{ hint }}</span
            >
          </span>
        }
      </div>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">{{
          maskedText
        }}</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">
          @if (linkable) {
            <a [href]="control.value" class="ngx-field__link" target="_blank" rel="noopener noreferrer">{{
              control.value
            }}</a>
          } @else {
            {{ control.value || '—' }}
          }
        </span>
      } @else {
        <input
          [id]="domId()"
          class="ngx-field__input"
          [attr.data-testid]="'field-' + field.id + '-input'"
          type="url"
          inputmode="url"
          autocomplete="url"
          [formControl]="$any(control)"
          [attr.aria-invalid]="control.invalid && control.touched"
          [attr.aria-describedby]="describedBy()"
          [placeholder]="placeholder || 'https://example.com'"
          [attr.disabled]="field.disabled ? true : null"
        />
        @if (errorMessage) {
          <span
            class="ngx-field__error"
            [attr.data-testid]="'field-' + field.id + '-error'"
            [id]="domId('-error')"
            role="alert"
            >{{ errorMessage }}</span
          >
        }
      }
    </div>
  `,
})
export class UrlFieldComponent {
  /**
   * Unique to this component instance: an `array` renders the same field once per row, and a
   * DOM id may not repeat. See `field-dom-id.ts`.
   */
  private readonly instanceId = nextFieldInstanceId();
  protected domId(suffix = ''): string {
    return fieldDomId(this.field, this.instanceId, suffix);
  }

  /** Overridable via MASKED_PLACEHOLDER; the default is the historic literal. */
  protected readonly maskedText = inject(MASKED_PLACEHOLDER, { optional: true }) ?? 'XXXXXXXXX';
  private readonly messages = inject(ValidationMessagesService);

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

  /** Author help text, shown under the control and named by `aria-describedby`. */
  get hint(): string {
    return resolveLabel(this.field?.hint, this.language);
  }

  /** Whether the stored value is an http(s) address, and so safe to render as a link. */
  get linkable(): boolean {
    const value = this.control?.value;
    return typeof value === 'string' && isValidUrl(value);
  }

  /** The ids of whatever is describing this control right now. */
  protected describedBy(): string | null {
    return fieldDescribedBy(s => this.domId(s), { hint: !!this.hint, error: !!this.errorMessage });
  }

  get errorMessage(): string {
    if (!this.control?.errors || !this.control.touched) return '';
    return this.messages.resolveForField(this.control.errors, this.language, this.field.type);
  }
}
