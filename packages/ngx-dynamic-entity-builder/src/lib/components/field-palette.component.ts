import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { RichFieldType } from '@dynamic-entity/core';
import { FIELD_TYPE_CATALOG, type FieldTypeMeta } from '../field-catalog';
import { BuilderTextService } from '../builder-text';

/**
 * Which drawer of the palette a field type belongs in.
 *
 * Kept here rather than on `FieldTypeMeta` in core: the catalogue is a data model shared with
 * the renderer, and how a picker arranges twenty-two buttons is a decision about this panel.
 * A type absent from the map — a consumer's custom type, or one added to core later — falls
 * into `other`, so the palette degrades to "listed, just not filed" rather than dropping it.
 */
const PALETTE_GROUPS = ['basic', 'choice', 'datetime', 'rich', 'structure', 'other'] as const;
type PaletteGroup = (typeof PALETTE_GROUPS)[number];

const GROUP_OF: Readonly<Record<string, PaletteGroup>> = {
  text: 'basic',
  textarea: 'basic',
  number: 'basic',
  currency: 'basic',
  email: 'basic',
  password: 'basic',

  dropdown: 'choice',
  radio: 'choice',
  multiSelect: 'choice',
  checkbox: 'choice',
  boolean: 'choice',
  'entity-ref': 'choice',

  date: 'datetime',
  datetime: 'datetime',
  time: 'datetime',
  monthYear: 'datetime',

  markdown: 'rich',
  image: 'rich',
  file: 'rich',

  group: 'structure',
  array: 'structure',
};

/** The heading text key for each group, so the labels translate with the rest of the chrome. */
const GROUP_TEXT_KEY = {
  basic: 'paletteGroupBasic',
  choice: 'paletteGroupChoice',
  datetime: 'paletteGroupDateTime',
  rich: 'paletteGroupRich',
  structure: 'paletteGroupStructure',
  other: 'paletteGroupOther',
} as const;

interface PaletteSection {
  group: PaletteGroup;
  heading: string;
  items: FieldTypeMeta[];
}

/**
 * FieldPaletteComponent — the list of buildable field types.
 *
 * Two things changed the day this stopped being a flat grid of twenty-two buttons. The labels
 * were clipped mid-word — "Boolean Toggl", "Entity Referen", "File Attachmen" — because the
 * grid forced two equal columns and the button refused to wrap, so a third of the palette
 * could not be read. And with no order to them, finding "Month & Year" meant scanning the
 * whole list: the grouping and the filter are what make a palette this size navigable.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-field-palette',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="deb-palette">
      <div class="deb-palette__search">
        <mat-icon aria-hidden="true">search</mat-icon>
        <input
          type="search"
          data-testid="palette-search"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          [attr.placeholder]="ui.text('paletteSearchPlaceholder')"
          [attr.aria-label]="ui.text('paletteSearchLabel')"
        />
        @if (query()) {
          <button
            type="button"
            class="deb-palette__clear"
            data-testid="palette-search-clear"
            [attr.aria-label]="ui.text('paletteSearchClear')"
            (click)="query.set('')"
          >
            <mat-icon>close</mat-icon>
          </button>
        }
      </div>

      @for (section of sections(); track section.group) {
        <div class="deb-palette__section">
          <span class="deb-section-title">{{ section.heading }}</span>
          <div class="deb-palette__grid">
            @for (meta of section.items; track meta.type) {
              <button
                mat-stroked-button
                type="button"
                class="deb-palette__item"
                [attr.data-testid]="'palette-' + meta.type"
                [matTooltip]="meta.description"
                (click)="pick.emit(meta.type)"
              >
                <mat-icon>{{ meta.icon }}</mat-icon>
                <span>{{ meta.label }}</span>
              </button>
            }
          </div>
        </div>
      } @empty {
        <p class="deb-hint" data-testid="palette-no-match">{{ ui.text('paletteNoMatch', { query: query() }) }}</p>
      }
    </div>
  `,
  styles: [
    `
      .deb-palette {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      /*
       * A plain input rather than a mat-form-field: this sits inside a card that is already a
       * stack of outlined Material fields, and giving the filter the same chrome made it read
       * as one more property to fill in rather than a control over the list below it.
       */
      .deb-palette__search {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 10px;
        height: 36px;
        border: 1px solid var(--deb-border, #e2e8f0);
        border-radius: 8px;
        background: #f8fafc;
      }
      .deb-palette__search:focus-within {
        border-color: var(--deb-accent, #6366f1);
        background: #ffffff;
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.16);
      }
      .deb-palette__search mat-icon {
        font-size: 17px;
        width: 17px;
        height: 17px;
        color: var(--deb-muted, #64748b);
        flex: none;
      }
      .deb-palette__search input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: 0;
        background: transparent;
        font: inherit;
        font-size: 13px;
        color: inherit;
      }
      /* The platform's own clear affordance, replaced by one that matches the rest. */
      .deb-palette__search input::-webkit-search-cancel-button {
        display: none;
      }
      .deb-palette__clear {
        appearance: none;
        border: 0;
        background: none;
        padding: 0;
        cursor: pointer;
        display: flex;
        color: var(--deb-muted, #64748b);
      }
      .deb-palette__clear:hover {
        color: #0f172a;
      }

      .deb-palette__section {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .deb-palette__grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }

      /*
       * An auto height and a wrapping label are the fix for the clipped names. Material's
       * button locks a line height and hides the overflow, which is right for a toolbar and
       * wrong for a 140px-wide tile holding "Entity Reference".
       */
      .deb-palette__item {
        justify-content: flex-start !important;
        height: auto !important;
        min-height: 38px;
        line-height: 1.25 !important;
        border-radius: 8px !important;
        border: 1px solid var(--deb-border, #e2e8f0) !important;
        padding: 7px 10px !important;
        font-family: var(--font-heading, inherit) !important;
        font-weight: 600 !important;
        font-size: 12.5px !important;
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1) !important;
        background: #ffffff !important;
        text-align: left !important;
      }
      .deb-palette__item:hover {
        border-color: #6366f1 !important;
        background: #f5f3ff !important;
        color: #4f46e5 !important;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15) !important;
      }
      .deb-palette__item mat-icon {
        color: #4338ca;
        margin-right: 7px;
        font-size: 17px;
        width: 17px;
        height: 17px;
        flex: none;
      }
      .deb-palette__item span {
        white-space: normal;
        overflow-wrap: anywhere;
      }

      @media (prefers-reduced-motion: reduce) {
        .deb-palette__item {
          transition: none !important;
        }
        .deb-palette__item:hover {
          transform: none;
        }
      }
    `,
  ],
})
export class FieldPaletteComponent {
  /** Builder chrome, overridable via BUILDER_TEXT. */
  protected readonly ui = inject(BuilderTextService);

  readonly catalog: readonly FieldTypeMeta[] = FIELD_TYPE_CATALOG;

  /** The filter text. Matched against the label, the type and the description. */
  protected readonly query = signal('');

  /**
   * The catalogue, filtered and filed.
   *
   * Matching the description as well as the label is what makes the filter worth having: a
   * person looking for a currency input types "money", which appears in no label but is
   * exactly the sort of word a description carries. An empty group is dropped rather than
   * rendered as a heading with nothing under it.
   */
  protected readonly sections = computed<PaletteSection[]>(() => {
    const needle = this.query().trim().toLowerCase();
    const matches = (meta: FieldTypeMeta) =>
      !needle ||
      meta.label.toLowerCase().includes(needle) ||
      meta.type.toLowerCase().includes(needle) ||
      meta.description.toLowerCase().includes(needle);

    return PALETTE_GROUPS.map(group => ({
      group,
      heading: this.ui.text(GROUP_TEXT_KEY[group]),
      items: this.catalog.filter(meta => (GROUP_OF[meta.type] ?? 'other') === group && matches(meta)),
    })).filter(section => section.items.length > 0);
  });

  @Output() pick = new EventEmitter<RichFieldType>();
}
