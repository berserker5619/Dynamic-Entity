import { Component, Input, ChangeDetectionStrategy, inject } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel, sliderBounds, type SliderBounds } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { fieldDescribedBy, fieldDomId, nextFieldInstanceId } from './field-dom-id';

/**
 * Slider field: a range input over `validators.min`–`validators.max` in steps of `field.step`.
 *
 * A range input cannot show that it is empty. With no value it puts the thumb at the midpoint,
 * which looks exactly like a chosen value. The readout beside it is therefore the value itself,
 * and shows a dash until someone moves the thumb. Without it, a required slider nobody touched
 * would look answered and still fail at save.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-slider-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--slider"
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
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ display }}</span>
      } @else {
        <div class="ngx-field__slider-wrap">
          <input
            [id]="domId()"
            type="range"
            class="ngx-field__slider"
            [class.ngx-field__slider--unset]="!hasValue"
            [attr.data-testid]="'field-' + field.id + '-input'"
            [min]="bounds.min"
            [max]="bounds.max"
            [step]="bounds.step"
            [formControl]="$any(control)"
            [attr.aria-valuetext]="hasValue ? null : display"
            [attr.aria-invalid]="control.invalid && control.touched"
            [attr.aria-describedby]="describedBy()"
            [attr.disabled]="field.disabled ? true : null"
          />
          <output
            class="ngx-field__slider-value"
            [attr.for]="domId()"
            [attr.data-testid]="'field-' + field.id + '-readout'"
            aria-hidden="true"
            >{{ display }}</output
          >
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
export class SliderFieldComponent {
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

  /** Author help text, shown under the control and named by `aria-describedby`. */
  get hint(): string {
    return resolveLabel(this.field?.hint, this.language);
  }

  get bounds(): SliderBounds {
    return sliderBounds(this.field);
  }

  /** Whether the control holds a number. The thumb's position cannot say. */
  get hasValue(): boolean {
    const value = this.control?.value;
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }

  get display(): string {
    return this.hasValue ? String(this.control.value) : '—';
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
