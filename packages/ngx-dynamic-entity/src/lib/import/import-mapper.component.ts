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
  arrayBoundFor,
  deriveImportColumns,
  upgradeLegacyRefs,
  type EntityFormConfig,
  type ImportColumn,
  type MappingEntry,
  type MappingPlan,
} from '@dynamic-entity/core';
import { UiTextService } from '../services/ui-text.service';

/** The select's value for "keep the plan's fixed value", which is not a column. */
const CONSTANT = -1;

/** One target field, and which of the sheet's columns feeds it. */
interface MappingRow {
  column: ImportColumn;
  /** Index into the sheet's headers, `CONSTANT` for a fixed value, or `null` for "not imported". */
  source: number | null;
  guessed: boolean;
  /** The incoming plan's entry for this field, emitted untouched until the user changes it. */
  entry?: MappingEntry;
  /** The user changed this row, so `entry` no longer describes it. */
  dirty: boolean;
}

/** A repeating field, for its "Add a row" button. */
interface ArraySlots {
  arrayRef: string;
  label: string;
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
                  @if (hasConstant(row)) {
                    <option [ngValue]="constant">
                      {{ ui.text('importConstant', language, { value: constantText(row.entry!) }) }}
                    </option>
                  }
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

      @if (arrays().length) {
        <p class="ngx-import-mapper__slots">
          @for (array of arrays(); track array.arrayRef) {
            <button
              type="button"
              class="ngx-import-mapper__add-slot"
              [attr.data-testid]="'import-add-slot-' + array.arrayRef"
              (click)="addSlot(array.arrayRef)"
            >
              {{ ui.text('importAddSlot', language, { label: array.label }) }}
            </button>
          }
        </p>
      }

      @if (stale().length) {
        <div class="ngx-import-mapper__stale" data-testid="import-stale" role="alert">
          <p>
            <strong>{{ ui.text('importStaleHeading', language) }}</strong>
            {{ ui.text('importStaleExplain', language) }}
          </p>
          <ul>
            @for (entry of stale(); track entry.ref) {
              <li [attr.data-testid]="'import-stale-' + entry.ref">
                <code>{{ entry.ref }}</code>
                <button
                  type="button"
                  class="ngx-import-mapper__remove"
                  [attr.data-testid]="'import-remove-' + entry.ref"
                  (click)="removeStale(entry)"
                >
                  {{ ui.text('importRemoveEntry', language) }}
                </button>
              </li>
            }
          </ul>
        </div>
      }
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
      .ngx-import-mapper__slots {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 10px 0 0;
      }
      .ngx-import-mapper__add-slot,
      .ngx-import-mapper__remove {
        padding: 4px 10px;
        border: 1px solid var(--ngx-color-border, #d1d5db);
        border-radius: var(--ngx-radius-sm, 6px);
        background: var(--ngx-color-surface, #ffffff);
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .ngx-import-mapper__remove {
        margin-left: 8px;
      }
      .ngx-import-mapper__stale {
        margin-top: 12px;
        padding: 8px 12px;
        color: var(--ngx-color-error, #b91c1c);
        background: var(--ngx-color-error-soft, #fef2f2);
        border-radius: var(--ngx-radius-sm, 6px);
      }
      .ngx-import-mapper__stale p,
      .ngx-import-mapper__stale ul {
        margin: 0 0 6px;
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

  /** A plan entry whose field this config no longer has. Kept, and emitted, until removed. */
  protected readonly stale = signal<MappingEntry[]>([]);
  /** Repeating fields the user can add a row to. */
  protected readonly arrays = signal<ArraySlots[]>([]);
  protected readonly constant = CONSTANT;

  /** Rows added by hand per repeating field, on top of what the sheet and plan imply. */
  private readonly extraSlots = new Map<string, number>();
  /** The incoming plan, read through the 2.2 alias. Every entry in it survives `toPlan`. */
  private incoming: MappingPlan | null = null;

  ngOnChanges(): void {
    this.incoming = this.plan ? upgradeLegacyRefs(this.plan, this.config) : null;
    this.extraSlots.clear();
    this.rows.set([]);
    this.rebuild();
  }

  /**
   * Rows for every field, sized so nothing the plan or the sheet names is out of reach.
   *
   * Sizing from the default three meant a sheet with `Phone 4` could not be mapped at all,
   * and a stored plan reaching further lost those entries on the next change — `toPlan` only
   * ever emitted rows, and there were none for them.
   */
  private rebuild(): void {
    const entries = (this.incoming?.entries ?? []).filter(Boolean);
    const base = arrayBoundFor(this.headers, this.config, this.incoming, this.language);
    const extra = Math.max(0, ...this.extraSlots.values());
    // Readonly and system fields are derived so a plan that maps one keeps it, but only
    // offered as a row when the plan does — nobody maps a column onto a field the form fills.
    const { columns, unsupported } = deriveImportColumns(this.config, {
      lang: this.language,
      maxArrayRows: base + extra,
      includeReadonly: true,
      includeSystemDefault: true,
    });
    this.unsupported.set(unsupported.length);

    const byRef = new Map(entries.map(entry => [entry.ref, entry]));
    const known = new Set(columns.map(column => column.ref));
    const previous = new Map(this.rows().map(row => [row.column.ref, row]));
    const offered = columns.filter(
      column =>
        (byRef.has(column.ref) || (!column.field.readonly && !column.field.systemDefault)) &&
        (column.arrayRef === undefined ||
          byRef.has(column.ref) ||
          column.arrayIndex! < base + (this.extraSlots.get(column.arrayRef) ?? 0)),
    );

    this.rows.set(
      offered.map(column => {
        // A choice already made survives a rebuild for an added slot.
        const kept = previous.get(column.ref);
        if (kept) return { ...kept, column };
        const entry = byRef.get(column.ref);
        return {
          column,
          source: entry?.column ?? (entry?.constant !== undefined ? CONSTANT : null),
          guessed: entry?.confidence === 'guess',
          entry,
          dirty: false,
        };
      }),
    );
    this.stale.set(entries.filter(entry => !known.has(entry.ref)));

    const arrays = new Map<string, string>();
    for (const column of offered) {
      if (column.arrayRef !== undefined && !arrays.has(column.arrayRef)) {
        arrays.set(column.arrayRef, column.arrayLabel ?? column.arrayRef);
      }
    }
    this.arrays.set([...arrays].map(([arrayRef, label]) => ({ arrayRef, label })));
  }

  protected mappedCount(): number {
    return this.rows().filter(row => row.source !== null).length;
  }

  protected missingRequired(): number {
    return this.rows().filter(row => row.column.required && row.source === null).length;
  }

  protected hasConstant(row: MappingRow): boolean {
    return !!row.entry && row.entry.constant !== undefined && row.entry.column === undefined;
  }

  protected constantText(entry: MappingEntry): string {
    const value = entry.constant;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  protected choose(row: MappingRow, source: number | null): void {
    this.rows.update(rows =>
      rows.map(candidate =>
        candidate.column.ref === row.column.ref
          ? // A hand-made choice is not a guess any more, so the badge goes. Going back to
            // the plan's fixed value is going back to its entry, untouched.
            { ...candidate, source, guessed: false, dirty: source !== CONSTANT }
          : candidate,
      ),
    );
    this.planChange.emit(this.toPlan());
  }

  /** One more row for one repeating field, for this session. */
  protected addSlot(arrayRef: string): void {
    this.extraSlots.set(arrayRef, (this.extraSlots.get(arrayRef) ?? 0) + 1);
    this.rebuild();
  }

  protected removeStale(entry: MappingEntry): void {
    this.stale.update(stale => stale.filter(candidate => candidate !== entry));
    this.planChange.emit(this.toPlan());
  }

  /**
   * The current selections as the plan that will be applied.
   *
   * Every entry of the incoming plan survives in its own position — a fixed value, a ref the
   * config no longer has — unless the user changed or removed it, and an untouched entry is
   * emitted exactly as it arrived. New selections follow, in field order.
   */
  private toPlan(): MappingPlan {
    const rowByRef = new Map(this.rows().map(row => [row.column.ref, row]));
    const stale = new Set(this.stale());
    const emitted = new Set<string>();
    const entries: MappingEntry[] = [];

    const entryOf = (row: MappingRow): MappingEntry | null => {
      if (!row.dirty && row.entry) return row.entry;
      if (row.source === null || row.source === CONSTANT) return null;
      return {
        ref: row.column.ref,
        column: row.source,
        header: this.headers[row.source],
        confidence: row.guessed ? 'guess' : 'exact',
      };
    };

    for (const original of this.incoming?.entries ?? []) {
      const row = original ? rowByRef.get(original.ref) : undefined;
      if (row) {
        emitted.add(row.column.ref);
        const entry = entryOf(row);
        if (entry) entries.push(entry);
      } else if (stale.has(original)) {
        entries.push(original);
      }
    }
    for (const row of this.rows()) {
      if (emitted.has(row.column.ref)) continue;
      const entry = entryOf(row);
      if (entry) entries.push(entry);
    }

    return {
      ...this.incoming,
      entity: this.config?.entity ?? '',
      configVersion: this.config?.version,
      sourceHeaders: [...this.headers],
      entries,
    };
  }
}
