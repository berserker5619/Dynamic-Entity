import { Component, inject, Input, signal } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';
import { UPLOAD_HANDLER } from '../tokens/injection-tokens';
import type { FileRef } from './image-field.component';

/**
 * File field: file input with filename display and download link.
 * Follows same FileRef / UPLOAD_HANDLER contract as image-field.
 */
@Component({
  selector: 'ngx-file-field',
  standalone: true,
  imports: [],
  template: `
    <div class="ngx-field ngx-field--file" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else if (readonly) {
        @if (fileUrl()) {
          <a class="ngx-field__file-link" [href]="fileUrl()!" target="_blank" rel="noopener">
            📎 {{ fileName() || 'Download file' }}
          </a>
        } @else {
          <span class="ngx-field__value">—</span>
        }
      } @else {
        <div class="ngx-field__file-wrap">
          @if (fileName()) {
            <div class="ngx-field__file-selected">
              <span class="ngx-field__file-name">📎 {{ fileName() }}</span>
              <button type="button" class="ngx-field__remove-btn" (click)="remove()">✕</button>
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
                [accept]="field.disabled ? '' : '*'"
                [disabled]="field.disabled || uploading()"
                (change)="onFileSelect($any($event.target).files[0])"
              />
            }
          </label>
        </div>
        @if (uploadError()) {
          <span class="ngx-field__error">{{ uploadError() }}</span>
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

  private readonly uploadHandler = inject(UPLOAD_HANDLER, { optional: true });

  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  fileUrl(): string | null {
    const v = this.control?.value as FileRef | null | undefined;
    return v && 'url' in v ? v.url : null;
  }

  fileName(): string | null {
    const v = this.control?.value as (FileRef & { name?: string }) | null | undefined;
    if (!v) return null;
    if ('file' in v) return (v.file as File).name;
    if ('url' in v) return v.url.split('/').pop() ?? 'file';
    return null;
  }

  async onFileSelect(file: File | undefined): Promise<void> {
    if (!file) return;
    this.uploadError.set(null);

    if (this.uploadHandler) {
      this.uploading.set(true);
      try {
        const result = await new Promise<{ url: string }>((resolve, reject) => {
          this.uploadHandler!(file).subscribe({ next: resolve, error: reject });
        });
        this.control.setValue({ url: result.url });
        this.control.markAsTouched();
      } catch {
        this.uploadError.set('Upload failed. Please try again.');
      } finally {
        this.uploading.set(false);
      }
    } else {
      this.control.setValue({ file });
      this.control.markAsTouched();
    }
  }

  remove(): void {
    this.control.setValue(null);
    this.control.markAsTouched();
  }
}
