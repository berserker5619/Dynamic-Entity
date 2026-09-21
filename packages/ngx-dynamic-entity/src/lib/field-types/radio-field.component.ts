import { Component, Input, inject, signal, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import type { DropdownOption, NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import {
  resolveLabel,
  resolveOptionLabel,
  resolveOptionValue,
  valuesMatch,
} from '@dynamic-entity/core';
import { LookupRegistryService, refreshChoiceOptions } from '../services/lookup-registry.service';

import { fieldDescribedBy, fieldDomId, nextFieldInstanceId } from './field-dom-id';
/** Radio field: a group of radio buttons built from field.options. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-radio-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--radio"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
    >
      <fieldset class="ngx-field__fieldset">
        <legend class="ngx-field__label">
          {{ label }}
          @if (hint) {
            <!--
              Inside the legend rather than beside it: a fieldset allows exactly one legend
              and it must be the first child, so a sibling row would be invalid here.
            -->
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
          <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ getSelectedLabel() }}</span>
        } @else {
          <div class="ngx-field__radio-group">
            @for (option of options(); track getOptLabel(option)) {
              <label class="ngx-field__radio-option" [attr.for]="getRadioId(option)">
                <input
                  [id]="getRadioId(option)"
                  [attr.data-testid]="'field-' + field.id + '-option-' + optionSlug(option)"
                  type="radio"
                  class="ngx-field__radio-input"
                  [name]="domId()"
                  [attr.aria-describedby]="describedBy()"
                  [value]="getOptStoredVal(option)"
                  [checked]="isChecked(option)"
                  [attr.disabled]="field.disabled ? true : null"
                  (change)="onSelect(option)"
                />
                <span class="ngx-field__radio-label">{{ getOptLabel(option) }}</span>
              </label>
            }
          </div>
          @if (errorMessage) {
            <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'" [id]="domId('-error')">{{
              errorMessage
            }}</span>
          }
        }
      </fieldset>
    </div>
  `,
})
export class RadioFieldComponent implements OnDestroy {
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
  private readonly cdr = inject(ChangeDetectorRef);

  private _field!: NestedFieldConfig;
  private _language = 'en';
  private _control!: AbstractControl;
  private _controlSub?: Subscription;

  ngOnDestroy(): void {
    this._controlSub?.unsubscribe();
  }

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

  @Input() set control(value: AbstractControl) {
    this._control = value;
    this._controlSub?.unsubscribe();
    this._controlSub = this._control?.valueChanges?.subscribe(() => {
      this.cdr.markForCheck();
    });
  }
  get control(): AbstractControl {
    return this._control;
  }

  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  /** Inline `options`, or the field's named list resolved through the registry (§6.3). */
  readonly options = signal<DropdownOption[]>([]);

  onSelect(option: DropdownOption): void {
    this.control?.setValue(option);
    this.control?.markAsTouched();
    this.control?.markAsDirty();
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

  /**
   * Stable DOM id for one radio, so the <label for> association works.
   * Slugified because the option text is the value now — "On Leave" must not put a space
   * into an id attribute.
   */
  getRadioId(option: DropdownOption): string {
    return this.domId(`-${this.optionSlug(option)}`);
  }

  /**
   * The option's part of an id or a test hook.
   *
   * `??` cannot fire here: `resolveOptionValue` returns '' for an empty option, not null, so
   * every valueless option produced the same slug — and two radios sharing an id break the
   * `for` that ties each label to its input.
   */
  optionSlug(option: DropdownOption): string {
    const raw = String(this.getOptVal(option) ?? '').trim();
    const text = raw || 'opt';
    return text.trim().replace(/\s+/g, '_').toLowerCase();
  }

  getOptVal(option: DropdownOption): string | number | boolean {
    return resolveOptionValue(option, this.language);
  }

  getOptLabel(option: DropdownOption): string {
    return resolveOptionLabel(option, this.language);
  }

  /** Whether the given option matches the control's current value. */
  isChecked(option: DropdownOption): boolean {
    return valuesMatch(this.control?.value, option, this.language);
  }

  /** Read-only display — synchronous, per §6.2. See `DropdownFieldComponent.getLabel`. */
  getSelectedLabel(): string {
    const value = this.control?.value;
    // `typeof null === 'object'`, so without this guard an empty value fell through to
    // `resolveLabel(null)` and rendered as blank — dropdown and multiSelect both show an em dash.
    if (value === null || value === undefined || value === '') return '—';
    const selected = this.options().find(o => valuesMatch(o, value, this.language));
    if (selected) return this.getOptLabel(selected);
    const cached = this.lookups.labelFor(this.field?.listName, value, this.language);
    if (cached) return cached;
    return typeof value === 'object' ? resolveLabel(value as Record<string, string>, this.language) : String(value ?? '—');
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
