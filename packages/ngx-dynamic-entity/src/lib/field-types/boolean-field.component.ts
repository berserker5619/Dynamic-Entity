import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { resolveLabel } from '@dynamic-entity/core';
import { UiTextService } from '../services/ui-text.service';
import { fieldDescribedBy, fieldDomId, nextFieldInstanceId } from './field-dom-id';

/**
 * Boolean field: a slide-toggle style switch (true/false).
 * Distinct from `checkbox` (which is a standalone bool) in that it renders as a
 * toggle switch with Yes/No labels for clearer binary state communication.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-boolean-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--boolean"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
    >
      @if (masked) {
        <label class="ngx-field__label">{{ label }}</label>
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">{{
          maskedText
        }}</span>
      } @else if (readonly) {
        <label class="ngx-field__label">{{ label }}</label>
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{
          control.value ? ui.text('yes', language) : ui.text('no', language)
        }}</span>
      } @else {
        <div class="ngx-field__toggle-wrap">
          <label class="ngx-field__toggle-label">{{ label }}</label>
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
          <label class="ngx-field__toggle-switch" [class.ngx-field__toggle-switch--checked]="control.value">
            <input
              class="ngx-field__toggle-input"
              type="checkbox"
              role="switch"
              [formControl]="$any(control)"
              [attr.aria-describedby]="describedBy()"
              [attr.disabled]="field.disabled ? true : null"
              [attr.aria-checked]="control.value"
            />
            <span class="ngx-field__toggle-track">
              <span class="ngx-field__toggle-thumb"></span>
            </span>
            <span class="ngx-field__toggle-text">{{
              control.value ? ui.text('yes', language) : ui.text('no', language)
            }}</span>
          </label>
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
export class BooleanFieldComponent {
  /**
   * Unique to this component instance: an `array` renders the same field once per row, and a
   * DOM id may not repeat. See `field-dom-id.ts`.
   */
  private readonly instanceId = nextFieldInstanceId();
  protected domId(suffix = ''): string {
    return fieldDomId(this.field, this.instanceId, suffix);
  }

  /** Library chrome, overridable via UI_TEXT. */
  protected readonly ui = inject(UiTextService);
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
  /**
   * Configured messages reach this field too.
   *
   * It rendered no error element at all, so a required checkbox left unticked told the user
   * nothing — and `validationMessages` could not reach a field that never displayed one.
   */
  /** Author help text, shown under the control and named by `aria-describedby`. */
  get hint(): string {
    return resolveLabel(this.field?.hint, this.language);
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
