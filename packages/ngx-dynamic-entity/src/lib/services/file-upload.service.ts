import { Injectable, inject } from '@angular/core';
import type { FileRef, Subscribable, UploadResult } from '@dynamic-entity/core';
import { UPLOAD_HANDLER } from '../tokens/injection-tokens';

/**
 * FileUploadService — the single place image-field and file-field agree on how a
 * selected `File` becomes a `FileRef`.
 *
 * With `UPLOAD_HANDLER` registered the file is persisted and stored as `{ url }`;
 * without one it is stored as `{ file }` for the consumer to upload at submit time.
 */
@Injectable({ providedIn: 'root' })
export class FileUploadService {
  private readonly handler = inject(UPLOAD_HANDLER, { optional: true });

  get hasHandler(): boolean {
    return !!this.handler;
  }

  /** Metadata common to both persisted and unpersisted refs. */
  private describe(file: File): FileRef {
    return { name: file.name, size: file.size, mimeType: file.type };
  }

  /**
   * Turn a selected File into the value to store on the control.
   * @throws when a registered handler rejects — callers surface it as a field error.
   */
  async toFileRef(file: File): Promise<FileRef> {
    const meta = this.describe(file);
    if (!this.handler) return { ...meta, file };

    const result = await this.normalize(this.handler(file));
    return { ...meta, url: result.url, name: result.name ?? meta.name };
  }

  /** Object URL for previewing an unpersisted File. Callers must revoke it. */
  previewUrlFor(ref: FileRef | null | undefined): string | null {
    if (!ref) return null;
    if (ref.url) return ref.url;
    if (ref.file && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      return URL.createObjectURL(ref.file);
    }
    return null;
  }

  revokePreviewUrl(url: string | null): void {
    if (!url || !url.startsWith('blob:')) return;
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  }

  private normalize(
    result: UploadResult | Promise<UploadResult> | Subscribable<UploadResult>,
  ): Promise<UploadResult> {
    if (this.isSubscribable(result)) {
      return new Promise<UploadResult>((resolve, reject) => {
        let settled = false;
        result.subscribe({
          next: value => {
            if (settled) return;
            settled = true;
            resolve(value);
          },
          error: err => {
            if (settled) return;
            settled = true;
            reject(err);
          },
          complete: () => {
            if (settled) return;
            settled = true;
            reject(new Error('Upload handler completed without emitting a result.'));
          },
        });
      });
    }
    return Promise.resolve(result as UploadResult | Promise<UploadResult>);
  }

  private isSubscribable(value: unknown): value is Subscribable<UploadResult> {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Subscribable<UploadResult>).subscribe === 'function'
    );
  }
}
