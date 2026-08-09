import { Component, OnDestroy, inject, Input, signal } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import type { FileRef, NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';
import { FileUploadService } from '../services/file-upload.service';

/**
 * Image field: preview thumbnail + upload button.
 *
 * With `UPLOAD_HANDLER` registered the file is persisted and stored as `{ url }`; without one
 * it is stored as `{ file }` and previewed from an object URL (revoked when replaced/destroyed).
 */
@Component({
  selector: 'ngx-image-field',
  standalone: true,
  imports: [],
  template: `
    <div class="ngx-field ngx-field--image" [class.ngx-field--readonly]="readonly" [class.ngx-field--masked]="masked">
      <label class="ngx-field__label" [attr.for]="'field-' + field.id">{{ label }}</label>
      @if (masked) {
        <span class="ngx-field__value ngx-field__value--masked">XXXXXXXXX</span>
      } @else {
        <div class="ngx-field__image-wrap">
          @if (previewUrl()) {
            <img class="ngx-field__image-preview" [src]="previewUrl()" [alt]="label" />
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
                    [id]="'field-' + field.id"
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
export class ImageFieldComponent implements OnDestroy {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() masked: boolean = false;

  private readonly uploads = inject(FileUploadService);

  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);

  /** Cached so an object URL is minted once per File, not once per change-detection pass. */
  private previewSource: FileRef | null = null;
  private previewCache: string | null = null;

  get label(): string {
    return resolveLabel(this.field?.label, this.language);
  }

  previewUrl(): string | null {
    const value = (this.control?.value as FileRef | null) ?? null;
    if (value === this.previewSource) return this.previewCache;

    this.uploads.revokePreviewUrl(this.previewCache);
    this.previewSource = value;
    this.previewCache = this.uploads.previewUrlFor(value);
    return this.previewCache;
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

  ngOnDestroy(): void {
    this.uploads.revokePreviewUrl(this.previewCache);
  }
}
