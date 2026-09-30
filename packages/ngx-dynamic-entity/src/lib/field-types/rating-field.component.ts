import { Component, Input, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy, inject } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { ratingScale, resolveLabel } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { UiTextService } from '../services/ui-text.service';
import { fieldDescribedBy, fieldDomId, nextFieldInstanceId } from './field-dom-id';

/**
 * Rating field: 1 to `validators.max` stars (default 5), stored as a number.
 *
 * Built from native radio inputs in a fieldset, not clickable spans. That gives it the
 * behaviour a radio group already has: arrow keys move the choice, Tab enters and leaves the
 * group once, and a screen reader announces "3 of 5, radio button, 3 of 5". Each star's
 * label is text a host can translate (`ratingValue`), because a star glyph read aloud is
 * "black star".
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-rating-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--rating"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
      [class.ngx-field--invalid]="control && control.invalid && control.touched"
    >
      <fieldset class="ngx-field__fieldset">
        <legend class="ngx-field__label">
          {{ label }}
          @if (field.validators?.required) {
            <span class="ngx-field__req">*</span>
          }
          @if (hint) {
            <!-- Inside the legend: a fieldset allows one legend, and it must come first. -->
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
        </legend>
        @if (masked) {
          <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">{{
            maskedText
          }}</span>
        } @else if (readonly) {
          <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">
            @if (current) {
              <span class="ngx-field__stars" aria-hidden="true">
                @for (star of stars; track star) {
                  <span class="ngx-field__star-glyph" [class.ngx-field__star-glyph--on]="star <= current">{{
                    star <= current ? '★' : '☆'
                  }}</span>
                }
              </span>
              {{ ui.text('ratingValue', language, { value: current, max: scale }) }}
            } @else {
              —
            }
          </span>
        } @else {
          <div class="ngx-field__rating">
            @for (star of stars; track star) {
              <label class="ngx-field__star" [class.ngx-field__star--on]="current !== null && star <= current">
                <input
                  type="radio"
                  class="ngx-field__star-input"
                  [id]="domId('-' + star)"
                  [name]="domId()"
                  [value]="star"
                  [checked]="current === star"
                  [attr.data-testid]="'field-' + field.id + '-star-' + star"
                  [attr.aria-describedby]="describedBy()"
                  [attr.disabled]="field.disabled ? true : null"
                  (change)="select(star)"
                />
                <!-- Filled and hollow, so the rating is readable without telling colours apart. -->
                <span class="ngx-field__star-glyph" aria-hidden="true">{{
                  current !== null && star <= current ? '★' : '☆'
                }}</span>
                <span class="ngx-field__sr-only">{{ ui.text('ratingValue', language, { value: star, max: scale }) }}</span>
              </label>
            }
            @if (current !== null && !field.disabled) {
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
      </fieldset>
    </div>
  `,
})
export class RatingFieldComponent implements OnDestroy {
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
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly ui = inject(UiTextService);

  @Input() field!: NestedFieldConfig;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  private _control!: AbstractControl;
  private _controlSub?: Subscription;

  /**
   * Subscribed because the radios are not bound through a form directive. A value patched in
   * from outside (a reset, an autoPatch) would otherwise leave an OnPush view showing the old
   * stars.
   */
  @Input() set control(value: AbstractControl) {
    this._control = value;
    this._controlSub?.unsubscribe();
    this._controlSub = this._control?.valueChanges?.subscribe(() => this.cdr.markForCheck());
  }
  get control(): AbstractControl {
    return this._control;
  }

  ngOnDestroy(): void {
    this._controlSub?.unsubscribe();
  }

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  /** Author help text, shown under the control and named by `aria-describedby`. */
  get hint(): string {
    return resolveLabel(this.field?.hint, this.language);
  }

  get scale(): number {
    return ratingScale(this.field);
  }

  get stars(): number[] {
    return Array.from({ length: this.scale }, (_, i) => i + 1);
  }

  /** The stored rating, or null when there is none or it is not a star on this scale. */
  get current(): number | null {
    const value = Number(this.control?.value);
    const raw = this.control?.value;
    if (raw === null || raw === undefined || raw === '' || !Number.isInteger(value)) return null;
    return value >= 1 && value <= this.scale ? value : null;
  }

  select(star: number): void {
    this.control?.setValue(star);
    this.control?.markAsTouched();
    this.control?.markAsDirty();
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
