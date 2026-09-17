import { ChangeDetectionStrategy, Component, Input, OnChanges, inject, signal } from '@angular/core';
import {
  applyMapping,
  coerceCell,
  deriveImportColumns,
  formatDisplayValue,
  type EntityFormConfig,
  type FormRule,
  type ImportColumn,
  type ImportLookups,
  type MappingPlan,
} from '@dynamic-entity/core';
import { UiTextService } from '../services/ui-text.service';

/** One cell, already turned into the text the record will show. */
interface PreviewCell {
  text: string;
  failed: boolean;
}

/** A row of cells, plus why the import will refuse it — if it will. */
interface PreviewRow {
  cells: PreviewCell[];
  /** Empty when the row will be imported. */
  rejections: string[];
}

/**
 * The first few rows as the record will hold them, not as the sheet holds them.
 *
 * Every cell goes through the same `coerceCell` the import will use and then through
 * `formatDisplayValue`, which is what the renderer uses to show a stored value. So a
 * `dropdown` cell reading `Aktiv` shows as `Active` here if that is the option it resolved
 * to, and a cell that will fail shows its reason before anyone commits to anything.
 *
 * Showing the raw text instead would be easier and would preview the wrong thing: the point
 * of this screen is to catch a mapping that is subtly wrong, and a column of unchanged text
 * looks correct whatever field it was pointed at.
 *
 * **The rows are also run through the real import**, not just through coercion. `coerceCell`
 * alone catches a cell that will not parse and says nothing about a row that will be rejected
 * — a missing required field, a rule that forbids the combination — so a heading promising
 * "as they will be saved" was showing rows that would never be saved at all, looking exactly
 * like the ones that would. `applyMapping` over the sample answers that with the same engine
 * the commit uses, rather than a second opinion about what counts as valid.
 *
 * The whole grid is built once per input change rather than from template method calls.
 * Deriving the config's columns inside a `@for` means re-walking the entire schema for every
 * cell on every change-detection pass, which is a lot of work to produce five rows.
 */
@Component({
  selector: 'ngx-import-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <section class="ngx-import-preview" data-testid="import-preview">
      <h4 class="ngx-import-preview__heading">
        {{ ui.text('importPreviewHeading', language, { count: rows.length }) }}
      </h4>
      <div class="ngx-import-preview__scroll">
        <table class="ngx-import-preview__table">
          <thead>
            <tr>
              @for (column of columns(); track column.ref) {
                <th scope="col">{{ column.header }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of grid(); track $index) {
              <tr
                [attr.data-testid]="'import-preview-row-' + $index"
                [class.ngx-import-preview__row--rejected]="row.rejections.length"
              >
                @for (cell of row.cells; track $index) {
                  <td [class.ngx-import-preview__cell--error]="cell.failed">{{ cell.text }}</td>
                }
              </tr>
              @if (row.rejections.length) {
                <tr class="ngx-import-preview__reason">
                  <td [attr.colspan]="columns().length" [attr.data-testid]="'import-preview-rejected-' + $index">
                    {{ ui.text('importRowRejected', language, { reason: row.rejections.join('; ') }) }}
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [
    `
      .ngx-import-preview__heading {
        margin: 0 0 8px;
        font-size: var(--ngx-font-size, 14px);
      }
      /* The one place a horizontal scrollbar belongs: a sheet can have forty columns. */
      .ngx-import-preview__scroll {
        overflow-x: auto;
        border: 1px solid var(--ngx-color-border, #e5e7eb);
        border-radius: var(--ngx-radius-sm, 6px);
      }
      .ngx-import-preview__table {
        width: 100%;
        border-collapse: collapse;
        white-space: nowrap;
      }
      .ngx-import-preview__table th,
      .ngx-import-preview__table td {
        text-align: left;
        padding: 6px 10px;
        border-bottom: 1px solid var(--ngx-color-border, #f3f4f6);
      }
      .ngx-import-preview__table thead th {
        background: var(--ngx-color-surface-alt, #f9fafb);
        color: var(--ngx-color-muted, #6b7280);
      }
      .ngx-import-preview__cell--error {
        color: var(--ngx-color-error, #b91c1c);
        background: var(--ngx-color-error-soft, #fef2f2);
      }
      /* A row that will be refused is dimmed, and says why on the line beneath it. */
      .ngx-import-preview__row--rejected td {
        opacity: 0.65;
      }
      .ngx-import-preview__reason td {
        white-space: normal;
        color: var(--ngx-color-error, #b91c1c);
        background: var(--ngx-color-error-soft, #fef2f2);
      }
    `,
  ],
})
export class ImportPreviewComponent implements OnChanges {
  @Input({ required: true }) config!: EntityFormConfig;
  @Input({ required: true }) plan!: MappingPlan;
  @Input() rows: readonly (readonly string[])[] = [];
  @Input() lookups?: ImportLookups;
  /** The same rules the commit will apply; without them a rule-driven rejection is invisible. */
  @Input() rules?: readonly FormRule[];
  @Input() language = 'en';

  protected readonly ui = inject(UiTextService);

  /** The columns this plan fills, in the plan's own order. */
  protected readonly columns = signal<ImportColumn[]>([]);
  protected readonly grid = signal<PreviewRow[]>([]);

  ngOnChanges(): void {
    const byRef = new Map(
      deriveImportColumns(this.config, { lang: this.language }).columns.map(c => [c.ref, c]),
    );

    const entries = (this.plan?.entries ?? []).filter(entry => byRef.has(entry.ref));
    this.columns.set(entries.map(entry => byRef.get(entry.ref)!));

    // The same engine the commit runs, over the sample only. Row 0 of the sample is numbered
    // 0 here rather than 2, because these row numbers index the preview, not the file.
    const dryRun = applyMapping(this.rows, this.plan, this.config, {
      lang: this.language,
      lookups: this.lookups,
      rules: this.rules,
      stamp: false,
      firstRowNumber: 0,
    });
    const rejectionsByRow = new Map<number, string[]>();
    for (const error of dryRun.errors) {
      rejectionsByRow.set(error.row, [...(rejectionsByRow.get(error.row) ?? []), error.message]);
    }

    this.grid.set(
      this.rows.map((row, index) => ({
        rejections: rejectionsByRow.get(index) ?? [],
        cells: entries.map(entry => {
          const field = byRef.get(entry.ref)!.field;
          const raw = entry.column === undefined ? entry.constant : row[entry.column];
          const outcome = coerceCell(field, raw, {
            lang: this.language,
            lookups: this.lookups,
          });

          if ('error' in outcome) return { text: outcome.error, failed: true };
          return {
            text: formatDisplayValue(field.type, field.options, outcome.value, this.language),
            failed: false,
          };
        }),
      })),
    );
  }
}
