import { Component, EventEmitter, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { RichFieldType } from '@dynamic-entity/core';
import { FIELD_TYPE_CATALOG, type FieldTypeMeta } from '../field-catalog';

/**
 * FieldPaletteComponent — the list of buildable field types (Angular Material).
 */
@Component({
  selector: 'ngx-field-palette',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="deb-palette">
      @for (meta of catalog; track meta.type) {
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
  `,
  styles: [
    `
      .deb-palette {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .deb-palette__item {
        justify-content: flex-start;
        overflow: hidden;
        border-radius: 8px !important;
        border: 1px solid var(--border, #e2e8f0) !important;
        padding: 8px 12px !important;
        font-family: var(--font-heading, inherit) !important;
        font-weight: 600 !important;
        font-size: 13px !important;
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1) !important;
        background: #ffffff !important;
      }
      .deb-palette__item:hover {
        border-color: #6366f1 !important;
        background: #f5f3ff !important;
        color: #4f46e5 !important;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15) !important;
      }
      .deb-palette__item mat-icon {
        color: #6366f1;
        margin-right: 6px;
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .deb-palette__item span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class FieldPaletteComponent {
  readonly catalog: readonly FieldTypeMeta[] = FIELD_TYPE_CATALOG;

  @Output() pick = new EventEmitter<RichFieldType>();
}
