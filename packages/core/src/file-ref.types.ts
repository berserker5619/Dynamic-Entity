/**
 * file-ref.types.ts — value contracts for file attachment & image upload fields.
 */

export interface FileRef {
  url?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  file?: File;
}

export type FileUploadHandler = (
  file: File,
) => Promise<{ url: string; name?: string }>;
