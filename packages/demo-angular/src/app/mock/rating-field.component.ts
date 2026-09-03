import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import type { AbstractControl } from '@angular/forms';
import {
  MASKED_PLACEHOLDER,
  fieldDomId,
  nextFieldInstanceId,
  resolveLabel,
  type DynamicFieldComponentContract,
  type NestedFieldConfig,
} from 'ngx-dynamic-entity';

/** The stars this control offers. A five-point scale, low to high. */
const STARS = [1, 2, 3, 4, 5] as const;

/**
 * A field type the library does not ship, written against the published contract.
 *
 * This is the main extensibility claim, and the only way to check it is to implement it from
 * outside: `DynamicFieldComponentContract` is the whole interface, the renderer assigns
 * exactly those five inputs through `setInput`, and nothing else about this component is
 * known to the library.
 *
 * Two obligations from the contract that are easy to skip and are honoured here:
 *
 *   - `masked` means *do not display the value*. The control still holds it and it is still
 *     submitted — masking is presentation, not authorization.
 *   - The DOM id comes from `fieldDomId` / `nextFieldInstanceId` rather than from `field.id`,
 *     because an `array` renders the same field once per row and `<label for>` resolves to
 *     the first match in the document.
 *
 * Registering it takes two calls, in two packages, because the two registries are
 * independent by design — see `app.config.ts`.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-rating-field',
  standalone: true,
  template: `
    <div
      class="ngx-field ngx-field--rating"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
    >
      <label class="ngx-field__label" [attr.for]="domId()">{{ label }}</label>

      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">{{
          maskedText
        }}</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ asStars() }}</span>
      } @else {
        <div class="rating" [id]="domId()" role="group" [attr.aria-label]="label">
          @for (star of stars; track star) {
            <button
              type="button"
              class="rating__star"
              [class.rating__star--on]="star <= value()"
              [attr.data-testid]="'field-' + field.id + '-star-' + star"
              [attr.aria-pressed]="star <= value()"
              [attr.aria-label]="star + ' of 5'"
              [disabled]="field.disabled"
              (click)="pick(star)"
            >
              &#9733;
            </button>
          }
          <span class="rating__value" [attr.data-testid]="'field-' + field.id + '-input'">{{ value() || '—' }}</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .rating {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .rating__star {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 22px;
        line-height: 1;
        padding: 0 2px;
        color: #cbd5e1;
      }
      .rating__star--on {
        color: #f59e0b;
      }
      .rating__value {
        margin-left: 8px;
        font-size: 13px;
        color: var(--text-muted, #64748b);
      }
    `,
  ],
})
export class RatingFieldComponent implements DynamicFieldComponentContract {
  /** Unique per instance — see the note above about `array` rows sharing a `field.id`. */
  private readonly instanceId = nextFieldInstanceId();
  protected domId(suffix = ''): string {
    return fieldDomId(this.field, this.instanceId, suffix);
  }

  /**
   * The same token the built-in field types read, so a custom type does not reintroduce the
   * second mask string this demo just finished removing.
   */
  protected readonly maskedText = inject(MASKED_PLACEHOLDER, { optional: true }) ?? 'XXXXXXXXX';

  protected readonly stars = STARS;

  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language = 'en';
  @Input() readonly = false;
  @Input() masked = false;

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  protected value(): number {
    const raw = Number(this.control?.value);
    return Number.isFinite(raw) ? raw : 0;
  }

  protected asStars(): string {
    const n = this.value();
    return n ? '\u2605'.repeat(n) + '\u2606'.repeat(STARS.length - n) : '\u2014';
  }

  protected pick(star: number): void {
    // Clicking the current rating clears it, which is the only way back to "not rated".
    this.control.setValue(star === this.value() ? null : star);
    this.control.markAsDirty();
    this.control.markAsTouched();
  }
}
