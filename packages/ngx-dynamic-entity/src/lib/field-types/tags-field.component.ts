import { Component, Input, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy, inject } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { normalizeTags, resolveLabel } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { UiTextService } from '../services/ui-text.service';
import { fieldDescribedBy, fieldDomId, nextFieldInstanceId } from './field-dom-id';

/** What ends a tag while typing, or separates several in pasted text. */
const TAG_SEPARATOR = /[,;\n]/;

/**
 * Tags field: free text entered as a list of chips, stored as `string[]`.
 *
 * Unlike `multiSelect`, the values are whatever the user types, so there is no option list to
 * keep in step. Enter or a comma ends a tag, Backspace in an empty box removes the last one,
 * and pasted text is split on commas, semicolons and line breaks. Leaving the box commits
 * what is in it, so a tag someone typed and then tabbed away from is not silently lost.
 *
 * The control holds the array. The text box is only a draft, which is why it is not bound
 * with a form directive.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-tags-field',
  standalone: true,
  template: `
    <div
      class="ngx-field ngx-field--tags"
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
        <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">
          @if (tags.length) {
            <span class="ngx-field__tags ngx-field__tags--readonly">
              @for (tag of tags; track tag) {
                <span class="ngx-field__tag">{{ tag }}</span>
              }
            </span>
          } @else {
            —
          }
        </span>
      } @else {
        <div class="ngx-field__tags" [class.ngx-field__tags--disabled]="field.disabled">
          @for (tag of tags; track tag) {
            <span class="ngx-field__tag" [attr.data-testid]="'field-' + field.id + '-tag'">
              {{ tag }}
              @if (!field.disabled) {
                <button
                  type="button"
                  class="ngx-field__tag-remove"
                  [attr.aria-label]="ui.text('removeTag', language, { tag: tag })"
                  (click)="remove(tag)"
                >
                  ×
                </button>
              }
            </span>
          }
          <input
            #entry
            [id]="domId()"
            type="text"
            class="ngx-field__tags-input"
            [attr.data-testid]="'field-' + field.id + '-input'"
            [attr.aria-invalid]="control.invalid && control.touched"
            [attr.aria-describedby]="describedBy()"
            [placeholder]="placeholder || ui.text('addTagPlaceholder', language)"
            [attr.disabled]="field.disabled ? true : null"
            (keydown)="onKeydown($event, entry)"
            (paste)="onPaste($event, entry)"
            (blur)="onBlur(entry)"
          />
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
export class TagsFieldComponent implements OnDestroy {
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

  /** Subscribed for the same reason as the rating field: nothing here is a form directive. */
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

  get placeholder(): string {
    return resolveLabel(this.field?.placeholder, this.language);
  }

  /** Author help text, shown under the control and named by `aria-describedby`. */
  get hint(): string {
    return resolveLabel(this.field?.hint, this.language);
  }

  /** The stored tags, read leniently. A record may hold a single string or anything else. */
  get tags(): string[] {
    return normalizeTags(this.control?.value);
  }

  onKeydown(event: KeyboardEvent, entry: HTMLInputElement): void {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      // Enter inside a form submits it. Adding a tag is what the user meant.
      event.preventDefault();
      this.commit(entry);
    } else if (event.key === 'Backspace' && entry.value === '' && this.tags.length) {
      this.remove(this.tags[this.tags.length - 1]);
    }
  }

  onPaste(event: ClipboardEvent, entry: HTMLInputElement): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!TAG_SEPARATOR.test(text)) return;
    event.preventDefault();
    // Split here, not by writing the text into the box first: a single-line input strips line
    // breaks on assignment, which would join "z\nw" into one tag.
    const draft = entry.value;
    entry.value = '';
    this.add([draft, ...text.split(TAG_SEPARATOR)]);
  }

  onBlur(entry: HTMLInputElement): void {
    this.commit(entry);
    this.control?.markAsTouched();
  }

  /** Add whatever is in the draft box, split on separators, and empty it. */
  commit(entry: HTMLInputElement): void {
    const added = entry.value.split(TAG_SEPARATOR);
    entry.value = '';
    this.add(added);
  }

  private add(candidates: string[]): void {
    const next = normalizeTags([...this.tags, ...candidates]);
    if (next.length !== this.tags.length) this.write(next);
  }

  remove(tag: string): void {
    this.write(this.tags.filter(t => t !== tag));
  }

  /**
   * An empty list is stored as `[]`, not `null`. `required` treats both as empty, and `[]`
   * stays the same shape as every other value this field holds.
   */
  private write(tags: string[]): void {
    this.control?.setValue(tags);
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
