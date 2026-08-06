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
      }
      .deb-palette__item span {
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ],
})
export class FieldPaletteComponent {
  readonly catalog: readonly FieldTypeMeta[] = FIELD_TYPE_CATALOG;

  @Output() pick = new EventEmitter<RichFieldType>();
}
