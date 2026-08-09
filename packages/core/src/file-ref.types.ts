/**
 * file-ref.types.ts — value contracts for file attachment & image upload fields.
 *
 * The canonical `FileRef`: a field holds either a **persisted** reference (`url`, set by the
 * consumer's upload handler) or an **unpersisted** one (`file`, when no handler is registered
 * and the consumer uploads on submit). Both carry optional display metadata.
 */

import type { Subscribable } from './entity-reference.types';

export interface FileRef {
  url?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  file?: File;
}

/** What an upload handler resolves to. `name` overrides the browser-supplied file name. */
export interface UploadResult {
  url: string;
  name?: string;
}

/**
 * Consumer-provided upload handler. May return the result directly, as a Promise,
 * or as an Observable — the renderer normalises all three.
 */
export type FileUploadHandler = (
  file: File,
) => UploadResult | Promise<UploadResult> | Subscribable<UploadResult>;

/** True when the ref points at a persisted URL. */
export function isPersistedFileRef(ref: FileRef | null | undefined): boolean {
  return !!ref?.url;
}

/** Display name for a ref: explicit name → the File's name → the URL's last segment. */
export function fileRefName(ref: FileRef | null | undefined): string {
  if (!ref) return '';
  if (ref.name) return ref.name;
  if (ref.file?.name) return ref.file.name;
  if (ref.url) return ref.url.split('/').pop() ?? ref.url;
  return '';
}
