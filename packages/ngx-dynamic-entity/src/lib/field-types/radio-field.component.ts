import { Component, Input, inject, signal } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { DropdownOption, NestedFieldConfig } from '@dynamic-entity/core';
import {
  getOptionStoredValue,
  resolveLabel,
  resolveOptionLabel,
  resolveOptionValue,
  valuesMatch,
} from '@dynamic-entity/core';
import { LookupRegistryService, refreshChoiceOptions } from '../services/lookup-registry.service';

/** Radio field: a group of radio buttons built from field.options. */
@Component({
  selector: 'ngx-radio-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="ngx-field ngx-field--radio"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <fieldset class="ngx-field__fieldset">
        <legend class="ngx-field__label">{{ label }}</legend>
        @if (masked) {
          <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
        } @else if (readonly) {
          <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ getSelectedLabel() }}</span>
        } @else {
          <div class="ngx-field__radio-group">
            @for (option of options(); track getOptLabel(option)) {
              <label class="ngx-field__radio-option" [attr.for]="getRadioId(option)">
                <input
                  [id]="getRadioId(option)"
                  type="radio"
                  class="ngx-field__radio-input"
                  [formControl]="$any(control)"
                  [value]="getOptStoredVal(option)"
                  [attr.disabled]="field.disabled ? true : null"
                />
                <span class="ngx-field__radio-label">{{ getOptLabel(option) }}</span>
              </label>
            }
          </div>
          @if (control.invalid && control.touched) {
            <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">This field has an error</span>
          }
        }
      </fieldset>
    </div>
  `,
})
export class RadioFieldComponent {
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

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  getOptStoredVal(option: any): any {
    return getOptionStoredValue(option);
  }

  /**
   * Stable DOM id for one radio, so the <label for> association works.
   * Slugified because the option text is the value now — "On Leave" must not put a space
   * into an id attribute.
   */
  getRadioId(option: any): string {
    const text = String(this.getOptVal(option) ?? 'opt');
    return `${this.field.id}-${text.trim().replace(/\s+/g, '_').toLowerCase()}`;
  }

  getOptVal(option: any): any {
    return resolveOptionValue(option, this.language);
  }

  getOptLabel(option: any): string {
    return resolveOptionLabel(option, this.language);
  }

  /** Read-only display — synchronous, per §6.2. See `DropdownFieldComponent.getLabel`. */
  getSelectedLabel(): string {
    const value = this.control?.value;
    // `typeof null === 'object'`, so without this guard an empty value fell through to
    // `resolveLabel(null)` and rendered as blank — dropdown and multiSelect both show an em dash.
    if (value === null || value === undefined || value === '') return '—';
    const selected = this.options().find(o => valuesMatch(getOptionStoredValue(o), value, this.language));
    if (selected) return this.getOptLabel(selected);
    const cached = this.lookups.labelFor(this.field?.listName, value, this.language);
    if (cached) return cached;
    return typeof value === 'object' ? resolveLabel(value, this.language) : (value ?? '—');
  }
}
