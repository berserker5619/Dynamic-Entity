import { Component, Input, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { DropdownOption, NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import {
  getOptionStoredValue,
  resolveLabel,
  resolveOptionLabel,
  valuesMatch,
} from '@dynamic-entity/core';
import { LookupRegistryService, refreshChoiceOptions } from '../services/lookup-registry.service';
import { ValidationMessagesService } from '../services/validation-messages.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-dropdown-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--dropdown"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
      [class.ngx-field--invalid]="control && control.invalid && control.touched"
    >
      <label class="ngx-field__label" [attr.for]="field.id">
        {{ label }}
        @if (field.validators?.required) { <span class="ngx-field__req">*</span> }
      </label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">{{ maskedText }}</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ getLabel(control.value) }}</span>
      } @else {
        <select
          [id]="field.id"
          class="ngx-field__input" [attr.data-testid]="'field-' + field.id + '-input'"
          [formControl]="$any(control)"
          [compareWith]="compareFn"
          [attr.disabled]="field.disabled ? true : null"
          [attr.aria-invalid]="control.invalid && control.touched"
          [attr.aria-describedby]="errorMessage ? field.id + '-error' : null"
        >
          <option [value]="''">{{ placeholder || 'Select...' }}</option>
          @for (option of options(); track getOptLabel(option)) {
            @if (isObjectVal(option)) {
              <option [ngValue]="getOptStoredVal(option)">{{ getOptLabel(option) }}</option>
            } @else {
              <option [value]="getOptStoredVal(option)">{{ getOptLabel(option) }}</option>
            }
          }
        </select>
        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'" [id]="field.id + '-error'" role="alert">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class DropdownFieldComponent {
  /** Overridable via MASKED_PLACEHOLDER; the default is the historic literal. */
  protected readonly maskedText = inject(MASKED_PLACEHOLDER, { optional: true }) ?? 'XXXXXXXXX';
  private readonly lookups = inject(LookupRegistryService);
  private readonly messages = inject(ValidationMessagesService);

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

  get placeholder(): string {
    return resolveLabel(this.field?.placeholder, this.language);
  }

  getOptStoredVal(option: DropdownOption): unknown {
    return getOptionStoredValue(option);
  }

  getOptLabel(option: DropdownOption): string {
    return resolveOptionLabel(option, this.language);
  }

  /**
   * Read-only display. Never awaits (§6.2): a warm list resolves the label, a cold one falls
   * back to the stored text — which under the §2 contract *is* the display value, so it is
   * never wrong, only unlocalised.
   */
  getLabel(value: unknown): string {
    if (value == null || value === '') return '—';
    const option = this.options().find(o => valuesMatch(getOptionStoredValue(o), value, this.language));
    if (option) return this.getOptLabel(option);
    const cached = this.lookups.labelFor(this.field?.listName, value, this.language);
    if (cached) return cached;
    return typeof value === 'object' ? resolveLabel(value as Record<string, string>, this.language) : String(value ?? '—');
  }

  get errorMessage(): string {
    if (!this.control || !this.control.errors || !this.control.touched) return '';
    // `requiredSelection` rather than `required`: "Please select an option" reads better on a
    // dropdown than "This field is required", and both stay independently overridable.
    return this.messages.resolve(
      this.control.errors,
      this.language,
      [['required', 'requiredSelection']],
      'invalidSelection',
    );
  }
}
