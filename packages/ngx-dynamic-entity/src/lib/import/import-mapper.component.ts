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

  ngOnChanges(): void {
    const { columns } = deriveImportColumns(this.config, { lang: this.language });
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
