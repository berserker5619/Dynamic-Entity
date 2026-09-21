import { Component, Input, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { DropdownOption, NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { resolveLabel, resolveOptionLabel, valuesMatch } from '@dynamic-entity/core';
import { LookupRegistryService, refreshChoiceOptions } from '../services/lookup-registry.service';
import { fieldDescribedBy, fieldDomId, nextFieldInstanceId } from './field-dom-id';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-multi-select-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--multiSelect"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
    >
      <div class="ngx-field__label-row">
        <label class="ngx-field__label" [attr.for]="domId()">{{ label }}</label>
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
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{
          getLabels(control.value)
        }}</span>
      } @else {
        <select
          [id]="domId()"
          class="ngx-field__input"
          [attr.data-testid]="'field-' + field.id + '-input'"
          [formControl]="$any(control)"
          [attr.aria-describedby]="describedBy()"
          [compareWith]="compareFn"
          [attr.disabled]="field.disabled ? true : null"
          multiple
          size="4"
        >
          @for (option of options(); track getOptLabel(option)) {
            @if (isObjectVal(option)) {
              <option [ngValue]="getOptStoredVal(option)">{{ getOptLabel(option) }}</option>
            } @else {
              <option [value]="getOptStoredVal(option)">{{ getOptLabel(option) }}</option>
            }
          }
        </select>
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'" [id]="domId('-error')">{{
            errorMessage
          }}</span>
        }
      }
    </div>
  `,
})
export class MultiSelectFieldComponent {
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
  private readonly lookups = inject(LookupRegistryService);

  private _field!: NestedFieldConfig;
  private _language = 'en';

  /** Setter-based so options resolve however the input is set — see `refreshChoiceOptions`. */
  @Input() set field(value: NestedFieldConfig) {
    this._field = value;
    refreshChoiceOptions(this, this.lookups);
  }
  get field(): NestedFieldConfig {
    return this._field;
  }

  @Input() set language(value: string) {
    this._language = value || 'en';
    refreshChoiceOptions(this, this.lookups);
  }
  get language(): string {
    return this._language;
  }

  @Input() control!: AbstractControl;
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  /** Inline `options`, or the field's named list resolved through the registry (§6.3). */
  readonly options = signal<DropdownOption[]>([]);

  readonly compareFn = (o1: unknown, o2: unknown): boolean => valuesMatch(o1, o2, this.language);

  isObjectVal(option: DropdownOption): boolean {
    return typeof option === 'object' && option !== null;
  }

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  /**
   * The value this option stores — the option object itself.
   *
   * Kept as a method rather than binding `option` straight into the template, because it is
   * the one place that says *why* the two are the same thing. It used to delegate to
   * `getOptionStoredValue`, an exported identity function whose two branches returned their
   * argument unchanged; naming a transformation that does not happen is worse than naming
   * nothing, because a reader has to go and check.
   */
  getOptStoredVal(option: DropdownOption): unknown {
    return option;
  }

  getOptLabel(option: DropdownOption): string {
    return resolveOptionLabel(option, this.language);
  }

  /** Read-only display — synchronous, per §6.2. See `DropdownFieldComponent.getLabel`. */
  getLabels(values: unknown): string {
    if (!Array.isArray(values) || !values.length) return '—';
    return values
      .map(v => {
        const opt = this.options().find(o => valuesMatch(o, v, this.language));
        if (opt) return this.getOptLabel(opt);
        const cached = this.lookups.labelFor(this.field?.listName, v, this.language);
        if (cached) return cached;
        return typeof v === 'object' && v !== null ? resolveLabel(v as Record<string, string>, this.language) : String(v);
      })
      .join(', ');
  }
  /**
   * Resolved through `ValidationMessagesService`, so `provideNgxDynamicEntity({
   * validationMessages })` reaches this field. It used to render a fixed
   * "This field has an error", which made a documented, configurable feature work on three
   * of fifteen field types.
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
