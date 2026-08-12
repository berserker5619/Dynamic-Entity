import { Component, inject, Input, signal } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import type { FileRef, NestedFieldConfig } from '@dynamic-entity/core';
import { fileRefName, resolveLabel } from '@dynamic-entity/core';
import { FileUploadService } from '../services/file-upload.service';

/**
 * File field: file input with filename display and download link.
 * Shares the `FileRef` / `UPLOAD_HANDLER` contract with image-field via FileUploadService.
 */
@Component({
  selector: 'ngx-file-field',
  standalone: true,
  imports: [],
  template: `
    <div class="ngx-field ngx-field--file"
      [attr.data-testid]="'field-' + field.id" [attr.data-field-type]="field.type" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label" [attr.for]="'field-' + field.id">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked" [attr.data-testid]="'field-' + field.id + '-masked'">XXXXXXXXX</span>
      } @else if (readonly) {
        @if (fileUrl()) {
          <a class="ngx-field__file-link" [href]="fileUrl()!" target="_blank" rel="noopener">
            📎 {{ fileName() || 'Download file' }}
          </a>
        } @else {
          <span class="ngx-field__value" [attr.data-testid]="'field-' + field.id + '-value'">—</span>
        }
      } @else {
        <div class="ngx-field__file-wrap">
          @if (fileName()) {
            <div class="ngx-field__file-selected">
              <span class="ngx-field__file-name">📎 {{ fileName() }}</span>
              <button type="button" class="ngx-field__remove-btn" (click)="remove()" aria-label="Remove file">✕</button>
            </div>
          }
          <label class="ngx-field__upload-btn" [class.ngx-field__upload-btn--loading]="uploading()">
            @if (uploading()) {
              <span>Uploading…</span>
            } @else {
              <span>{{ fileName() ? 'Replace file' : 'Choose file' }}</span>
              <input
                type="file"
                class="ngx-field__file-input"
                [id]="'field-' + field.id"
                [disabled]="field.disabled || uploading()"
                (change)="onFileSelect($any($event.target).files[0])"
              />
            }
          </label>
        </div>
        @if (uploadError()) {
          <span class="ngx-field__error" [attr.data-testid]="'field-' + field.id + '-error'">{{ uploadError() }}</span>
        }
      }
    </div>
  `,
})
export class FileFieldComponent {
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
}
