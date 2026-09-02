import { Component, Input, OnDestroy, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { resolveLabel } from '@dynamic-entity/core';
import { ValidationMessagesService } from '../services/validation-messages.service';

import { fieldDomId, nextFieldInstanceId } from './field-dom-id';
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-text-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--text"
      [attr.data-testid]="'field-' + field.id"
      [attr.data-field-type]="field.type"
      [class.ngx-field--readonly]="readonly"
      [class.ngx-field--masked]="masked"
      [class.ngx-field--invalid]="control && control.invalid && control.touched"
    >
      <label class="ngx-field__label" [attr.for]="domId()"
        >{{ label }}
        @if (field.validators?.required) {
          <span class="ngx-field__req">*</span>
        }
      </label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">{{
          maskedText
        }}</span>
      } @else if (readonly) {
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">{{ displayValue() ?? '—' }}</span>
      } @else {
        <input
          [id]="domId()"
          type="text"
          class="ngx-field__input"
          [attr.data-testid]="'field-' + field.id + '-input'"
          [formControl]="$any(control)"
          [placeholder]="placeholder"
          [attr.disabled]="field.disabled ? true : null"
          [attr.aria-invalid]="control.invalid && control.touched"
          [attr.aria-describedby]="errorMessage ? domId('-error') : null"
        />
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
export class TextFieldComponent implements OnDestroy {
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
  private displaySub?: Subscription;

  @Input() field!: NestedFieldConfig;
  @Input()
  set control(value: AbstractControl) {
    this._control = value;
    this.displaySub?.unsubscribe();
    this.displayValue.set(value?.value ?? null);
    this.displaySub = value?.valueChanges.subscribe(v => this.displayValue.set(v));
  }
  get control(): AbstractControl {
    return this._control;
  }
  private _control!: AbstractControl;

  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  /** Readonly markup reads this signal so an external patch (autoPatch) is visible under OnPush. */
  readonly displayValue = signal<unknown>(null);

  ngOnDestroy(): void {
    this.displaySub?.unsubscribe();
  }

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  get placeholder(): string {
    return resolveLabel(this.field?.placeholder, this.language);
  }

  get errorMessage(): string {
    if (!this.control || !this.control.errors || !this.control.touched) return '';
    return this.messages.resolve(this.control.errors, this.language, [
      'required',
      'email',
      'minlength',
      'maxlength',
      'pattern',
    ]);
  }
}
