import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { UiTextService } from '../services/ui-text.service';
import { resolveLabel } from '@dynamic-entity/core';
import { MARKDOWN_RENDERER, MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { fieldDomId, nextFieldInstanceId } from './field-dom-id';

/**
 * Markdown field: a long-form input that stores **markdown source**, never HTML.
 *
 * Storing the source rather than rendered HTML is the whole design. The record stays plain
 * text — diffable, portable, safe to log, and impossible to turn into stored XSS by writing
 * it into a database. Rendering happens at display time and only when a consumer asks for
 * it, via `MARKDOWN_RENDERER`.
 *
 * Without a renderer this degrades to exactly what `textarea` does, plus preserved line
 * breaks: the source is shown as text with nothing interpreted. That is the default because
 * these packages declare no runtime dependencies beyond `tslib`, and a markdown parser is a
 * large thing to force on a consumer who wanted a form library.
 *
 * With a renderer, its HTML is bound through `[innerHTML]`, which Angular sanitizes — see
 * the token's own note on why that is a backstop rather than a licence.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-markdown-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div
      class="ngx-field ngx-field--markdown"
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
        @if (rendered(); as html) {
          <div
            class="ngx-field__value ngx-field__markdown"
            [attr.data-testid]="'field-' + field.id + '-value'"
            [innerHTML]="html"
          ></div>
        } @else {
          <!-- No renderer: the source is the display. The stylesheet keeps its line
               breaks with white-space: pre-wrap, and interpolation escapes it. -->
          <span class="ngx-field__value ngx-field__markdown--source" [attr.data-testid]="'field-' + field.id + '-value'">{{
            control.value
          }}</span>
        }
      } @else {
        <div class="ngx-field__markdown-editor">
          @if (canPreview) {
            <div
              class="ngx-field__markdown-tabs"
              role="group"
              [attr.aria-label]="ui.text('markdownEditorMode', language, { label })"
            >
              <button
                type="button"
                class="ngx-field__markdown-tab"
                [attr.data-testid]="'field-' + field.id + '-write'"
                [attr.aria-pressed]="!previewing()"
                (click)="previewing.set(false)"
              >
                {{ ui.text('write', language) }}
              </button>
              <button
                type="button"
                class="ngx-field__markdown-tab"
                [attr.data-testid]="'field-' + field.id + '-preview'"
                [attr.aria-pressed]="previewing()"
                (click)="previewing.set(true)"
              >
                {{ ui.text('preview', language) }}
              </button>
            </div>
          }

          @if (previewing()) {
            <div
              class="ngx-field__markdown ngx-field__markdown--preview"
              [attr.data-testid]="'field-' + field.id + '-preview-body'"
              [innerHTML]="rendered()"
            ></div>
          } @else {
            <textarea
              [id]="domId()"
              class="ngx-field__input ngx-field__input--markdown"
              [attr.data-testid]="'field-' + field.id + '-input'"
              [formControl]="$any(control)"
              [placeholder]="placeholder"
              [attr.disabled]="field.disabled ? true : null"
              rows="6"
            ></textarea>
          }
        </div>

        @if (errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">{{ errorMessage }}</span>
        }
      }
    </div>
  `,
})
export class MarkdownFieldComponent implements OnChanges {
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
  /** Library chrome, overridable via UI_TEXT. */
  protected readonly ui = inject(UiTextService);
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  /** Optional — the field is fully usable without one. */
  private readonly render = inject(MARKDOWN_RENDERER, { optional: true });
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly previewing = signal(false);

  private valueSub?: { unsubscribe(): void };

  /**
   * Re-render when the value changes from outside this component.
   *
   * `rendered()` reads `control.value`, which under OnPush is neither an input nor a
   * template event: typing in the textarea updates through `formControl`, but a host
   * calling `patchValue`, a rule, or an `autoPatch` mapping does not mark this component
   * dirty. The preview and the read-only view would keep showing the previous document
   * while the record already held a different one.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['control']) return;
    this.valueSub?.unsubscribe();
    this.valueSub = this.control?.valueChanges?.subscribe(() => this.cdr.markForCheck());
    if (this.valueSub) this.destroyRef.onDestroy(() => this.valueSub?.unsubscribe());
  }

  /** A Preview tab that can only ever show the source back is worse than no tab. */
  protected get canPreview(): boolean {
    return !!this.render;
  }

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  get placeholder(): string {
    return resolveLabel(this.field?.placeholder, this.language);
  }

  /**
   * Rendered HTML, or null when there is no renderer or nothing to render.
   *
   * A renderer is consumer code and may throw on input it does not like. Letting that
   * escape would take down the whole form over one malformed field, so it falls back to the
   * source text — which is what the field would have shown with no renderer at all.
   */
  protected rendered(): string | null {
    const source = this.control?.value;
    if (!this.render || typeof source !== 'string' || source === '') return null;
    try {
      return this.render(source);
    } catch {
      return null;
    }
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
