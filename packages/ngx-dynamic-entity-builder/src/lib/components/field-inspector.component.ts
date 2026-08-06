import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { FieldConfig } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';
import { getFieldTypeMeta, type FieldTypeMeta } from '../field-catalog';

/**
 * FieldInspectorComponent — edits every property of the currently selected field.
 * Sections are shown/hidden based on the field type's catalog metadata.
 * All edits flow through BuilderStore mutators (single source of truth).
 */
@Component({
  selector: 'ngx-field-inspector',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './field-inspector.component.html',
  styles: [
    `
      .deb-inspector {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .deb-inspector__empty {
        color: var(--deb-muted, #6b7280);
        text-align: center;
        padding: 24px 8px;
      }
      .deb-full {
        width: 100%;
      }
      .deb-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .deb-row > * {
        flex: 1;
      }
      .deb-toggles {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 12px;
      }
      .deb-option-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .deb-chip {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 12px;
        background: var(--deb-accent-soft, #eef2ff);
        color: var(--deb-accent, #6366f1);
        font-size: 12px;
        font-weight: 600;
      }
    `,
  ],
})
export class FieldInspectorComponent {
  protected readonly store = inject(BuilderStore);

  protected readonly field = this.store.selectedField;
  protected readonly meta = computed<FieldTypeMeta | undefined>(() => {
    const f = this.field();
    return f ? getFieldTypeMeta(f.type) : undefined;
  });

  protected lang(): string {
    return this.store.activeLanguage();
  }

  /** Commit an id rename on blur — reads the raw input value. */
  protected commitId(oldId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.store.renameField(oldId, value);
  }

  /** Coerce an input value to number|null (empty/NaN -> null, clears the validator). */
  protected toNum(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }

  protected labelValue(field: FieldConfig): string {
    return field.label?.[this.lang()] ?? field.label?.['en'] ?? '';
  }

  protected placeholderValue(field: FieldConfig): string {
    return field.placeholder?.[this.lang()] ?? '';
  }

  protected optionLabel(option: { label: Record<string, string> }): string {
    return option.label?.[this.lang()] ?? option.label?.['en'] ?? '';
  }
}
