import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { normalizeHexColor, resolveLabel } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { UiTextService } from '../services/ui-text.service';
import { fieldDescribedBy, fieldDomId, nextFieldInstanceId } from './field-dom-id';

/**
 * Colour field: a native colour picker, storing `#rrggbb`.
 *
 * Like a range input, a colour input has no empty state and shows black. The code beside it is
 * therefore the real value, a dash until a colour is chosen, and a clear button sets the value
 * back to nothing. Without them, "no colour" and "black" would look the same.
 *
 * Only a value that passes `normalizeHexColor` reaches a `style` binding. A record can hold
 * any string, and a colour swatch is no place to interpret one.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-color-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--color"
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
        <span class="ngx-field__value ngx-field__color-value" [attr.data-testid]="'field-' + field.id + '-value'">
          @if (hex) {
            <span class="ngx-field__swatch" [style.background-color]="hex" aria-hidden="true"></span>
            {{ hex }}
          } @else {
            {{ control.value || '—' }}
          }
        </span>
      } @else {
        <div class="ngx-field__color-wrap">
          <input
            [id]="domId()"
            type="color"
            class="ngx-field__color"
            [attr.data-testid]="'field-' + field.id + '-input'"
            [formControl]="$any(control)"
            [attr.aria-invalid]="control.invalid && control.touched"
            [attr.aria-describedby]="describedBy()"
            [attr.disabled]="field.disabled ? true : null"
          />
          <span class="ngx-field__color-code" [attr.data-testid]="'field-' + field.id + '-code'">{{ hex || '—' }}</span>
          @if (hex && !field.disabled) {
            <button
              type="button"
              class="ngx-field__remove-btn"
              [attr.data-testid]="'field-' + field.id + '-clear'"
              [attr.aria-label]="ui.text('clearValue', language, { field: label })"
              (click)="clear()"
            >
              ×
            </button>
          }
        </div>
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
export class ColorFieldComponent {
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
  protected readonly ui = inject(UiTextService);

  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  /** Author help text, shown under the control and named by `aria-describedby`. */
  get hint(): string {
    return resolveLabel(this.field?.hint, this.language);
  }

  /** The stored colour as `#rrggbb`, or null when there is none or it is not a colour. */
  get hex(): string | null {
    return normalizeHexColor(this.control?.value);
  }

  clear(): void {
    this.control?.setValue(null);
    this.control?.markAsTouched();
    this.control?.markAsDirty();
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
