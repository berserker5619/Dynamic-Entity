/**
 * local-import-transport.ts — the whole import, in the browser, with no server.
 *
 * This is the default `IMPORT_TRANSPORT`, and it is a thin arrangement of pure functions
 * from `@dynamic-entity/core` rather than an implementation of anything. That matters: a
 * consumer who later registers a server transport is not switching to a second set of
 * mapping rules, they are moving the same ones to a different machine.
 *
 * Its limit is the one every browser has — the file is read into memory whole. That is fine
 * for the sizes a person assembles by hand and wrong for a fifty-thousand-row export, which
 * is what a streaming server transport is for.
 */

import { Injectable, inject } from '@angular/core';
import {
  applyMapping,
  deriveImportColumns,
  suggestMapping,
  toCsv,
  type ImportResult,
  type MappingPlan,
  type TemplateSpec,
} from '@dynamic-entity/core';
import { SHEET_PARSER } from '../tokens/injection-tokens';
import { defaultSheetParser } from './sheet-parser';
import type {
  ImportContext,
  ImportPreview,
  ImportTransport,
  TemplateFormat,
} from './import-contracts';

/** How many rows the mapping screen shows under each column. */
const SAMPLE_ROWS = 5;

@Injectable({ providedIn: 'root' })
export class LocalImportTransport implements ImportTransport {
  private readonly registered = inject(SHEET_PARSER, { optional: true });

  /** The registered parser, or the built-in CSV one. */
  private get parse(): NonNullable<typeof this.registered> {
    return this.registered ?? defaultSheetParser;
  }

  async preview(file: File, context: ImportContext): Promise<ImportPreview> {
    const sheet = await this.parse(file);
    const { columns } = deriveImportColumns(context.config, { lang: context.lang });

    return {
      headers: sheet.headers,
      sample: sheet.rows.slice(0, SAMPLE_ROWS),
      rowCount: sheet.rows.length,
      suggestion: suggestMapping(sheet.headers, columns, context.config?.entity ?? ''),
    };
  }

  async commit(file: File, plan: MappingPlan, context: ImportContext): Promise<ImportResult> {
    const sheet = await this.parse(file);
    return applyMapping(sheet.rows, plan, context.config, {
      lang: context.lang,
      rules: context.rules,
      lookups: context.lookups,
    });
  }

  async template(spec: TemplateSpec, format: TemplateFormat): Promise<Blob> {
    if (format === 'xlsx') {
      // Deliberately not a silent fallback to CSV. A file named `.xlsx` that is really CSV
      // opens with a warning in Excel and imports wrongly elsewhere, and the consumer would
      // have no idea why — where this message says exactly which seam to fill.
      throw new Error(
        'This build can only write CSV templates. Register an IMPORT_TRANSPORT that writes ' +
          'xlsx — see provideNgxDynamicEntity({ importTransport }) — or request csv.',
      );
    }

    // Headers only, and `spec.notes` deliberately left out of the file.
    //
    // A guidance row under the headers reads well and breaks the round trip: CSV has one
    // header row and no concept of a second, so re-importing the template the user filled in
    // would treat the guidance as a record and report a failed row 2 on every single import.
    // The notes are shown beside each column in the picker instead, where they can be read
    // without being parsed. A format with somewhere to put them — an xlsx cell comment, a
    // second sheet — can carry them; CSV has nowhere that is not data.
    const csv = toCsv(spec.columns.map(column => column.header));
    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
  }
}

