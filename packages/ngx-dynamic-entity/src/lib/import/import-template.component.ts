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
import {
  buildTemplateSpec,
  deriveImportColumns,
  stripIndices,
  type EntityFormConfig,
  type UnsupportedColumn,
} from '@dynamic-entity/core';
import { UiTextService } from '../services/ui-text.service';

/** One field offered for the template, with the guidance that belongs to it. */
interface TemplateChoice {
  /** The ref with any row number removed, so a repeating field is offered once. */
  ref: string;
  header: string;
  note: string;
  selected: boolean;
}

/**
 * Pick the fields a template should carry, then download it.
 *
 * The guidance for each field is shown **here**, beside the checkbox, rather than written
 * into the file as a second header row. CSV has one header row and no concept of a second,
 * so a guidance row inside the file would come back as a record on re-import and fail row 2
 * of every import the user ever ran.
 *
 * A repeating field is offered once, not once per row number: "Contacts / Name" is a decision,
 * and "Contacts / Name 1", "Contacts / Name 2", "Contacts / Name 3" is the same decision
 * asked three times.
 */
@Component({
  selector: 'ngx-import-template',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <section class="ngx-import-template" data-testid="import-template">
      <h4 class="ngx-import-template__heading">{{ ui.text('importTemplateHeading', language) }}</h4>
      <p class="ngx-import-template__explain">{{ ui.text('importTemplateExplain', language) }}</p>

      <div class="ngx-import-template__bulk">
        <button type="button" (click)="selectAll(true)" data-testid="import-template-all">
          {{ ui.text('importTemplateSelectAll', language) }}
        </button>
        <button type="button" (click)="selectAll(false)" data-testid="import-template-none">
          {{ ui.text('importTemplateSelectNone', language) }}
        </button>
      </div>

      <ul class="ngx-import-template__list">
        @for (choice of choices(); track choice.ref) {
          <li class="ngx-import-template__item">
            <label>
              <input
                type="checkbox"
                [checked]="choice.selected"
                (change)="toggle(choice.ref)"
                [attr.data-testid]="'import-template-field-' + choice.ref"
              />
              <span class="ngx-import-template__label">{{ choice.header }}</span>
            </label>
            @if (choice.note) {
              <span class="ngx-import-template__note">{{ choice.note }}</span>
            }
          </li>
        }
      </ul>

      @if (unsupported().length) {
        <p class="ngx-import-template__unsupported" data-testid="import-template-unsupported">
          {{ ui.text('importTemplateUnsupported', language, { count: unsupported().length }) }}
        </p>
      }

      <button
        type="button"
        class="ngx-import-template__download"
        data-testid="import-template-download"
        [disabled]="!selectedCount()"
        (click)="download.emit(selectedRefs())"
      >
        {{ ui.text('importTemplateDownload', language) }}
      </button>
    </section>
  `,
  styles: [
    `
      .ngx-import-template {
        padding: 14px;
        border: 1px solid var(--ngx-color-border, #e5e7eb);
        border-radius: var(--ngx-radius-sm, 6px);
        background: var(--ngx-color-surface-alt, #f9fafb);
      }
      .ngx-import-template__heading {
        margin: 0 0 4px;
        font-size: var(--ngx-font-size, 14px);
      }
      .ngx-import-template__explain {
        margin: 0 0 10px;
        color: var(--ngx-color-muted, #6b7280);
      }
      .ngx-import-template__bulk {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
      }
      .ngx-import-template__list {
        list-style: none;
        margin: 0 0 10px;
        padding: 0;
        max-height: 240px;
        overflow-y: auto;
        display: grid;
        gap: 4px;
      }
      .ngx-import-template__item {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 8px;
      }
      .ngx-import-template__item label {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .ngx-import-template__note {
        color: var(--ngx-color-muted, #6b7280);
        font-size: 12px;
      }
      .ngx-import-template__unsupported {
        margin: 0 0 10px;
        color: var(--ngx-color-muted, #6b7280);
      }
      .ngx-import-template button {
        padding: 6px 12px;
        border: 1px solid var(--ngx-color-border, #d1d5db);
        border-radius: var(--ngx-radius-sm, 6px);
        background: var(--ngx-color-surface, #ffffff);
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .ngx-import-template button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
    `,
  ],
})
export class ImportTemplateComponent implements OnChanges {
  @Input({ required: true }) config!: EntityFormConfig;
  @Input() language = 'en';

  /** The refs to include, with row numbers stripped — the caller builds the spec. */
  @Output() readonly download = new EventEmitter<string[]>();

  protected readonly ui = inject(UiTextService);
  protected readonly choices = signal<TemplateChoice[]>([]);
  protected readonly unsupported = signal<UnsupportedColumn[]>([]);

  ngOnChanges(): void {
    const spec = buildTemplateSpec(this.config, { lang: this.language });
    const derived = deriveImportColumns(this.config, { lang: this.language });

    // One entry per field, keyed on the ref with its row number removed, so a repeating
    // field collapses back into the single choice it is.
    const seen = new Map<string, TemplateChoice>();
    spec.columns.forEach((column, i) => {
      const ref = stripIndices(column.ref);
      if (seen.has(ref)) return;
      seen.set(ref, {
        ref,
        header: column.arrayIndex === undefined ? column.header : stripRowNumber(column.header),
        note: spec.notes[i] ?? '',
        selected: true,
      });
    });

    this.choices.set([...seen.values()]);
    this.unsupported.set(derived.unsupported);
  }

  protected selectedCount(): number {
    return this.choices().filter(choice => choice.selected).length;
  }

  protected selectedRefs(): string[] {
    return this.choices()
      .filter(choice => choice.selected)
      .map(choice => choice.ref);
  }

  protected toggle(ref: string): void {
    this.choices.update(choices =>
      choices.map(choice =>
        choice.ref === ref ? { ...choice, selected: !choice.selected } : choice,
      ),
    );
  }

  protected selectAll(selected: boolean): void {
    this.choices.update(choices => choices.map(choice => ({ ...choice, selected })));
  }
}

/** "Contacts / Name 1" → "Contacts / Name", for the collapsed choice. */
function stripRowNumber(header: string): string {
  return header.replace(/ \d+$/, '');
}
