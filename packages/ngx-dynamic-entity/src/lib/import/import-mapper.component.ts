import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  deriveImportColumns,
  type EntityFormConfig,
  type ImportColumn,
  type MappingEntry,
  type MappingPlan,
} from '@dynamic-entity/core';
import { UiTextService } from '../services/ui-text.service';

/** One target field, and which of the sheet's columns feeds it. */
interface MappingRow {
  column: ImportColumn;
  /** Index into the sheet's headers, or `null` for "not imported". */
  source: number | null;
  guessed: boolean;
}

/**
 * Match the sheet's columns to the config's fields.
 *
 * The table is driven by the **target fields**, not by the sheet's columns, which is the
 * choice that decides how the screen reads. A user is answering "where does Start Date come
 * from?", which they can do; column-first would ask "what is column G?", which they often
 * cannot, and would make a sheet with forty irrelevant columns forty questions long.
 *
 * A selection is a **column index**, never header text. Two columns headed "Notes" are two
 * different answers, and text cannot tell them apart.
 */
@Component({
  selector: 'ngx-import-mapper',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <section class="ngx-import-mapper" data-testid="import-mapper">
      <p class="ngx-import-mapper__summary" data-testid="import-mapped-count">
        {{ ui.text('importMappedCount', language, { mapped: mappedCount(), total: rows().length }) }}
      </p>
      @if (missingRequired() > 0) {
        <p class="ngx-import-mapper__warning" data-testid="import-required-unmapped" role="status">
          {{ ui.text('importRequiredUnmapped', language, { count: missingRequired() }) }}
        </p>
      }
      @if (unsupported() > 0) {
        <p class="ngx-import-mapper__note" data-testid="import-mapper-unsupported">
          {{ ui.text('importTemplateUnsupported', language, { count: unsupported() }) }}
        </p>
      }

      <table class="ngx-import-mapper__table">
        <thead>
          <tr>
            <th scope="col">{{ ui.text('importTargetField', language) }}</th>
            <th scope="col">{{ ui.text('importColumnInFile', language) }}</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.column.ref) {
            <tr [attr.data-testid]="'import-map-' + row.column.ref">
              <th scope="row">
                {{ row.column.header }}
                @if (row.column.required) {
                  <span class="ngx-import-mapper__required" aria-hidden="true">*</span>
                }
              </th>
              <td>
                <select
                  class="ngx-import-mapper__select"
                  [attr.data-testid]="'import-select-' + row.column.ref"
                  [attr.aria-label]="row.column.header"
                  [ngModel]="row.source"
                  (ngModelChange)="choose(row, $event)"
                >
                  <option [ngValue]="null">{{ ui.text('importUnmapped', language) }}</option>
                  @for (header of headers; track $index) {
                    <option [ngValue]="$index">{{ header || '—' }}</option>
                  }
                </select>
                @if (row.guessed && row.source !== null) {
                  <span class="ngx-import-mapper__guess" [attr.data-testid]="'import-guess-' + row.column.ref">
                    {{ ui.text('importGuessed', language) }}
                  </span>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: [
    `
      .ngx-import-mapper__summary,
      .ngx-import-mapper__warning,
      .ngx-import-mapper__note {
        margin: 0 0 10px;
      }
      .ngx-import-mapper__warning {
        color: var(--ngx-color-warning, #b45309);
        background: var(--ngx-color-warning-soft, #fffbeb);
        border: 1px solid var(--ngx-color-border, #fef3c7);
        border-radius: var(--ngx-radius-sm, 6px);
        padding: 8px 12px;
      }
      .ngx-import-mapper__note {
        color: var(--ngx-color-muted, #6b7280);
      }
      .ngx-import-mapper__table {
        width: 100%;
        border-collapse: collapse;
      }
      .ngx-import-mapper__table th,
      .ngx-import-mapper__table td {
        text-align: left;
        padding: 8px 10px;
        border-bottom: 1px solid var(--ngx-color-border, #e5e7eb);
        vertical-align: middle;
      }
      .ngx-import-mapper__table thead th {
        color: var(--ngx-color-muted, #6b7280);
        font-size: var(--ngx-font-size, 13px);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .ngx-import-mapper__required {
        color: var(--ngx-color-error, #b91c1c);
        margin-left: 2px;
      }
      .ngx-import-mapper__select {
        min-width: 220px;
        max-width: 100%;
        padding: 6px 8px;
        border: 1px solid var(--ngx-color-border, #d1d5db);
        border-radius: var(--ngx-radius-sm, 6px);
        background: var(--ngx-color-surface, #ffffff);
        color: inherit;
        font: inherit;
      }
      .ngx-import-mapper__guess {
        margin-left: 8px;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 12px;
        color: var(--ngx-color-info, #1d4ed8);
        background: var(--ngx-color-info-soft, #eff6ff);
      }
      @media (max-width: 640px) {
        .ngx-import-mapper__select {
          min-width: 0;
          width: 100%;
        }
      }
    `,
  ],
})
export class ImportMapperComponent implements OnChanges {
  @Input({ required: true }) config!: EntityFormConfig;
  @Input() headers: readonly string[] = [];
  /** The starting point, normally `suggestMapping`'s output. */
  @Input() plan: MappingPlan | null = null;
  @Input() language = 'en';

  /** Emitted whenever the user changes a selection. */
  @Output() readonly planChange = new EventEmitter<MappingPlan>();

  protected readonly ui = inject(UiTextService);
  protected readonly rows = signal<MappingRow[]>([]);
  /**
   * How many fields a spreadsheet cannot carry at all.
   *
   * Shown here as well as in the template picker, because a user who already had a sheet
   * skipped that screen — and this is the only place they would otherwise find out that an
   * attachment column was never going to arrive.
   */
  protected readonly unsupported = signal(0);

  ngOnChanges(): void {
    const { columns, unsupported } = deriveImportColumns(this.config, { lang: this.language });
    this.unsupported.set(unsupported.length);
    const byRef = new Map((this.plan?.entries ?? []).map(entry => [entry.ref, entry]));

    this.rows.set(
      columns.map(column => {
        const entry = byRef.get(column.ref);
        return {
          column,
          source: entry?.column ?? null,
          guessed: entry?.confidence === 'guess',
        };
      }),
    );
  }

  protected mappedCount(): number {
    return this.rows().filter(row => row.source !== null).length;
  }

  protected missingRequired(): number {
    return this.rows().filter(row => row.column.required && row.source === null).length;
  }

  protected choose(row: MappingRow, source: number | null): void {
    this.rows.update(rows =>
      rows.map(candidate =>
        candidate.column.ref === row.column.ref
          ? // A hand-made choice is not a guess any more, so the badge goes.
            { ...candidate, source, guessed: false }
          : candidate,
      ),
    );
    this.planChange.emit(this.toPlan());
  }

  /** The current selections as the plan that will be applied. */
  private toPlan(): MappingPlan {
    const entries: MappingEntry[] = this.rows()
      .filter(row => row.source !== null)
      .map(row => ({
        ref: row.column.ref,
        column: row.source as number,
        header: this.headers[row.source as number],
        confidence: row.guessed ? ('guess' as const) : ('exact' as const),
      }));

    return {
      entity: this.config?.entity ?? '',
      configVersion: this.config?.version,
      sourceHeaders: [...this.headers],
      entries,
    };
  }
}
