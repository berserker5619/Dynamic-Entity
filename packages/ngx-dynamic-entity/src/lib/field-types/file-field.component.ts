import { Component, inject, Input, signal, ChangeDetectionStrategy } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import type { FileRef, NestedFieldConfig } from '@dynamic-entity/core';
import { MASKED_PLACEHOLDER } from '../tokens/injection-tokens';
import { ValidationMessagesService } from '../services/validation-messages.service';
import { fileRefName, resolveLabel } from '@dynamic-entity/core';
import { FileUploadService } from '../services/file-upload.service';
import { UiTextService } from '../services/ui-text.service';
import { fieldDomId, nextFieldInstanceId } from './field-dom-id';

/**
 * File field: file input with filename display and download link.
 * Shares the `FileRef` / `UPLOAD_HANDLER` contract with image-field via FileUploadService.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-file-field',
  standalone: true,
  imports: [],
  template: `
    <div
      class="ngx-field ngx-field--file"
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
        @if (fileUrl()) {
          <a class="ngx-field__file-link" [href]="fileUrl()!" target="_blank" rel="noopener">
            📎 {{ fileName() || ui.text('downloadFile', language) }}
          </a>
        } @else {
          <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">—</span>
        }
      } @else {
        <div class="ngx-field__file-wrap">
          @if (fileName()) {
            <div class="ngx-field__file-selected">
              <span class="ngx-field__file-name">📎 {{ fileName() }}</span>
              <button
                type="button"
                class="ngx-field__remove-btn"
                (click)="remove()"
                [attr.aria-label]="ui.text('removeFile', language)"
              >
                ✕
              </button>
            </div>
          }
          <label class="ngx-field__upload-btn" [class.ngx-field__upload-btn--loading]="uploading()">
            @if (uploading()) {
              <span>{{ ui.text('uploading', language) }}</span>
            } @else {
              <span>{{ fileName() ? ui.text('replaceFile', language) : ui.text('chooseFile', language) }}</span>
              <input
                type="file"
                class="ngx-field__file-input"
                [id]="domId()"
                [disabled]="field.disabled || uploading()"
                (change)="onFileSelect($any($event.target).files[0])"
              />
            }
          </label>
        </div>
        <!-- An upload failure and an unmet validator are different problems, and this only
             ever showed the first. A required file left unchosen said nothing, and a
             configured required message had no element to appear in. -->
        @if (uploadError() || errorMessage) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'" role="alert">{{
            uploadError() || errorMessage
          }}</span>
        }
      }
    </div>
  `,
})
export class FileFieldComponent {
  /**
   * Unique to this component instance: an `array` renders the same field once per row, and a
   * DOM id may not repeat. See `field-dom-id.ts`.
   */
  private readonly instanceId = nextFieldInstanceId();
  protected domId(suffix = ''): string {
    return fieldDomId(this.field, this.instanceId, suffix);
  }

  /** Library chrome, overridable via UI_TEXT. */
  protected readonly ui = inject(UiTextService);
  /** Overridable via MASKED_PLACEHOLDER; the default is the historic literal. */
  protected readonly maskedText = inject(MASKED_PLACEHOLDER, { optional: true }) ?? 'XXXXXXXXX';
  private readonly messages = inject(ValidationMessagesService);
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  private readonly uploads = inject(FileUploadService);

  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  private get value(): FileRef | null {
    return (this.control?.value as FileRef | null) ?? null;
  }

  fileUrl(): string | null {
    return this.value?.url ?? null;
  }

  fileName(): string | null {
    return fileRefName(this.value) || null;
  }

  async onFileSelect(file: File | undefined): Promise<void> {
    if (!file) return;
    this.uploadError.set(null);
    this.uploading.set(true);
    try {
      this.control.setValue(await this.uploads.toFileRef(file));
      this.control.markAsTouched();
    } catch {
      this.uploadError.set('Upload failed. Please try again.');
    } finally {
      this.uploading.set(false);
    }
  }

  remove(): void {
    this.control.setValue(null);
    this.control.markAsTouched();
  }
  /** Validation, as distinct from the upload failures this field already reported. */
  get errorMessage(): string {
    if (!this.control?.errors || !this.control.touched) return '';
    return this.messages.resolve(this.control.errors, this.language, ['required', 'pattern']);
  }
}
