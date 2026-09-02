import { Component, Input, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { DropdownOption, NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { getOptionStoredValue, resolveLabel, resolveOptionLabel, valuesMatch } from '@dynamic-entity/core';
import { LookupRegistryService, refreshChoiceOptions } from '../services/lookup-registry.service';

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
      <label class="ngx-field__label" [attr.for]="field.id">{{ label }}</label>
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
          [id]="field.id"
          class="ngx-field__input"
          [attr.data-testid]="'field-' + field.id + '-input'"
          [formControl]="$any(control)"
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
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class MultiSelectFieldComponent {
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
    const val = getOptionStoredValue(option);
    return typeof val === 'object' && val !== null;
  }

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  getOptStoredVal(option: DropdownOption): unknown {
    return getOptionStoredValue(option);
  }

  getOptLabel(option: DropdownOption): string {
    return resolveOptionLabel(option, this.language);
  }

  /** Read-only display — synchronous, per §6.2. See `DropdownFieldComponent.getLabel`. */
  getLabels(values: unknown): string {
    if (!Array.isArray(values) || !values.length) return '—';
    return values
      .map(v => {
        const opt = this.options().find(o => valuesMatch(getOptionStoredValue(o), v, this.language));
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
