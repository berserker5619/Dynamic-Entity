import { ChangeDetectionStrategy, Component, Input, OnChanges, inject, signal } from '@angular/core';
import {
  coerceCell,
  deriveImportColumns,
  formatDisplayValue,
  type EntityFormConfig,
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
              <tr [attr.data-testid]="'import-preview-row-' + $index">
                @for (cell of row; track $index) {
                  <td [class.ngx-import-preview__cell--error]="cell.failed">{{ cell.text }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class ImportPreviewComponent implements OnChanges {
  @Input({ required: true }) config!: EntityFormConfig;
  @Input({ required: true }) plan!: MappingPlan;
  @Input() rows: readonly (readonly string[])[] = [];
  @Input() lookups?: ImportLookups;
  @Input() language = 'en';

  protected readonly ui = inject(UiTextService);

  /** The columns this plan fills, in the plan's own order. */
  protected readonly columns = signal<ImportColumn[]>([]);
  protected readonly grid = signal<PreviewCell[][]>([]);

  ngOnChanges(): void {
    const byRef = new Map(
      deriveImportColumns(this.config, { lang: this.language }).columns.map(c => [c.ref, c]),
    );

    const entries = (this.plan?.entries ?? []).filter(entry => byRef.has(entry.ref));
    this.columns.set(entries.map(entry => byRef.get(entry.ref)!));

    this.grid.set(
      this.rows.map(row =>
        entries.map(entry => {
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
      ),
    );
  }
}
