import { Component, inject, Input, signal } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';
import { UPLOAD_HANDLER } from '../tokens/injection-tokens';

/**
 * FileRef — the value contract for image and file fields.
 * Either a persisted URL (returned by UPLOAD_HANDLER) or an unpersisted File object.
 */
export type FileRef = { url: string } | { file: File };

/**
 * Image field: preview thumbnail + upload button.
 * If UPLOAD_HANDLER is provided, uploads on select and stores { url }.
 * Without a handler, stores { file: File } for consumer to handle.
 */
@Component({
  selector: 'ngx-image-field',
  standalone: true,
  imports: [],
  template: `
    <div class="ngx-field ngx-field--image" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else {
        <div class="ngx-field__image-wrap">
          @if (previewUrl()) {
            <img
              class="ngx-field__image-preview"
              [src]="previewUrl()"
              [alt]="label"
            />
          } @else {
            <div class="ngx-field__image-placeholder">
              <span>📷</span>
              <span>No image</span>
            </div>
          }
          @if (!readonly) {
            <div class="ngx-field__image-actions">
              <label class="ngx-field__upload-btn" [class.ngx-field__upload-btn--loading]="uploading()">
                @if (uploading()) {
                  <span>Uploading…</span>
                } @else {
                  <span>{{ previewUrl() ? 'Change' : 'Upload' }}</span>
                  <input
                    type="file"
                    class="ngx-field__file-input"
                    accept="image/*"
                    [disabled]="field.disabled || uploading()"
                    (change)="onFileSelect($any($event.target).files[0])"
                  />
                }
              </label>
              @if (previewUrl()) {
                <button type="button" class="ngx-field__remove-btn" (click)="remove()">Remove</button>
              }
            </div>
          }
        </div>
        @if (uploadError()) {
          <span class="ngx-field__error">{{ uploadError() }}</span>
        }
      }
    </div>
  `,
})
export class ImageFieldComponent {
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

  get previewUrl(): ReturnType<typeof signal<string | null>> {
    const v = this.control?.value as FileRef | null | undefined;
    const url = v && 'url' in v ? v.url : null;
    return signal(url);
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
      // No upload handler — store File reference for consumer to handle
      this.control.setValue({ file });
      this.control.markAsTouched();
    }
  }

  remove(): void {
    this.control.setValue(null);
    this.control.markAsTouched();
  }
}
