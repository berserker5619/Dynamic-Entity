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

/** The points on a Net Promoter scale: 0 ("not at all likely") to 10 ("extremely likely"). */
const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * A field type the library does not ship, written against the published contract.
 *
 * "How likely are you to recommend us?", scored 0 to 10. It is deliberately not the built-in
 * `rating`. Zero is a real answer here, where a rating starts at one star. Adding a type is
 * what this demonstrates, so it has to be one the library does not already have.
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
  selector: 'app-nps-field',
  standalone: true,
  template: `
    <div
      class="ngx-field ngx-field--nps"
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
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ asText() }}</span>
      } @else {
        <div class="nps" [id]="domId()" role="group" [attr.aria-label]="label">
          @for (score of scores; track score) {
            <button
              type="button"
              class="nps__score"
              [class.nps__score--on]="score === value()"
              [attr.data-testid]="'field-' + field.id + '-score-' + score"
              [attr.aria-pressed]="score === value()"
              [attr.aria-label]="score + ' of 10'"
              [disabled]="field.disabled"
              (click)="pick(score)"
            >
              {{ score }}
            </button>
          }
          <span class="nps__value" [attr.data-testid]="'field-' + field.id + '-input'">{{ value() ?? '—' }}</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .nps {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
      }
      .nps__score {
        min-width: 30px;
        height: 30px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        background: none;
        color: inherit;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
      }
      .nps__score--on {
        border-color: #2563a8;
        background: #2563a8;
        color: #fff;
      }
      .nps__value {
        margin-left: 8px;
        font-size: 13px;
        color: var(--text-muted, #64748b);
      }
    `,
  ],
})
export class NpsFieldComponent implements DynamicFieldComponentContract {
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

  protected readonly scores = SCORES;

  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language = 'en';
  @Input() readonly = false;
  @Input() masked = false;

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  /** The score, or null for no answer. Zero is an answer, so it cannot stand for "none". */
  protected value(): number | null {
    const raw = this.control?.value;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 10 ? n : null;
  }

  protected asText(): string {
    const n = this.value();
    return n === null ? '—' : `${n} / 10`;
  }

  protected pick(score: number): void {
    // Clicking the current score clears it, which is the only way back to "not answered".
    this.control.setValue(score === this.value() ? null : score);
    this.control.markAsDirty();
    this.control.markAsTouched();
  }
}
