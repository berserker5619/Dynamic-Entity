/**
 * write-template.ts — a template a user downloads, fills in, and uploads again.
 *
 * Since 3.0 the writer is sheet-to-schema's, which takes a sheet name, headers and notes. This
 * is Dynamic Entity's signature over it: a `TemplateSpec`, as `buildTemplateSpec` makes one.
 * The bytes are the same bytes.
 */

import type { TemplateSpec } from '@dynamic-entity/core';
import type { Writable } from 'node:stream';
import {
  TEMPLATE_EXTENSION as IMPORTER_TEMPLATE_EXTENSION,
  TEMPLATE_MEDIA_TYPE as IMPORTER_TEMPLATE_MEDIA_TYPE,
  writeTemplate as writeSheetTemplate,
  type TemplateFormat as ImporterTemplateFormat,
  type TemplateSheet,
} from 'sheet-to-schema/node';
import type { ImportLimits } from './limits';

/** @deprecated Import `TemplateFormat` from `sheet-to-schema/node`. Removed in 4.0. */
export type TemplateFormat = ImporterTemplateFormat;
/** @deprecated Import `TEMPLATE_EXTENSION` from `sheet-to-schema/node`. Removed in 4.0. */
export const TEMPLATE_EXTENSION = IMPORTER_TEMPLATE_EXTENSION;
/** @deprecated Import `TEMPLATE_MEDIA_TYPE` from `sheet-to-schema/node`. Removed in 4.0. */
export const TEMPLATE_MEDIA_TYPE = IMPORTER_TEMPLATE_MEDIA_TYPE;

export interface WriteTemplateOptions {
  spec: TemplateSpec;
  format: TemplateFormat;
  /** Where the bytes go. An HTTP response, a file stream, anything writable. */
  out: Writable;
  limits?: Partial<ImportLimits>;
}

/** A `TemplateSpec` as the sheet the writer takes: its name, its headers, a note per header. */
export function templateSheetOf(spec: TemplateSpec): TemplateSheet {
  return { sheetName: spec.sheetName, headers: spec.columns.map(column => column.header), notes: spec.notes };
}

/**
 * Write a blank template: the header row, and for a workbook a note on each header cell.
 *
 * A CSV carries no notes, because it has nowhere to put them. Either way the file holds
 * headers and no formulas, and a header that would run as one is neutralised.
 */
export function writeTemplate(options: WriteTemplateOptions): Promise<void> {
  return writeSheetTemplate({ sheet: templateSheetOf(options.spec), format: options.format, out: options.out, limits: options.limits });
}
