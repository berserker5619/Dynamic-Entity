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
import type { DropdownOption, NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel, resolveOptionLabel } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';
import { getFieldTypeMeta, type FieldTypeMeta } from '../field-catalog';
import { EntityReferenceConfigComponent } from './entity-reference-config.component';
import { FieldRulesListComponent } from './field-rules-list.component';
import { ReferencedFieldConfigComponent } from './referenced-field-config.component';

/**
 * FieldInspectorComponent — edits every property of the currently selected field.
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
    EntityReferenceConfigComponent,
    FieldRulesListComponent,
    ReferencedFieldConfigComponent,
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
      .deb-row--split {
        justify-content: space-between;
      }
      .deb-row--split > * {
        flex: 0 0 auto;
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


  protected toNum(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }

  protected labelValue(field: NestedFieldConfig): string {
    return resolveLabel(field.label, this.lang());
  }

  protected placeholderValue(field: NestedFieldConfig): string {
    return resolveLabel(field.placeholder, this.lang());
  }

  protected optionLabel(option: DropdownOption): string {
    return resolveOptionLabel(option, this.lang());
  }

  // ─── showWhen editing ───────────────────────────────────────────────────────

  protected showWhenEntries(field: NestedFieldConfig): { key: string; display: string }[] {
    return Object.entries(field.showWhen ?? {}).map(([key, value]) => ({
      key,
      display: this.stringifyShowWhen(value),
    }));
  }

  protected addShowWhen(field: NestedFieldConfig): void {
    const next = { ...(field.showWhen ?? {}) };
    let key = 'field';
    let n = 1;
    while (key in next) key = `field_${++n}`;
    next[key] = true;
    this.store.setShowWhen(field.id, next);
  }

  protected renameShowWhen(field: NestedFieldConfig, oldKey: string, newKey: string): void {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed === oldKey) return;
    const current = field.showWhen ?? {};
    if (trimmed in current) return;
    const next: Record<string, unknown> = {};
    // Rebuild in order so the row does not jump while the user is typing.
    for (const [k, v] of Object.entries(current)) next[k === oldKey ? trimmed : k] = v;
    this.store.setShowWhen(field.id, next);
  }

  protected setShowWhenValue(field: NestedFieldConfig, key: string, raw: string): void {
    this.store.setShowWhen(field.id, { ...(field.showWhen ?? {}), [key]: this.parseShowWhen(raw) });
  }

  protected removeShowWhen(field: NestedFieldConfig, key: string): void {
    const next = { ...(field.showWhen ?? {}) };
    delete next[key];
    this.store.setShowWhen(field.id, next);
  }

  /**
   * `showWhen` compares with `!==`, so the authored type has to survive the round trip:
   * "true"/"false" become booleans and numeric text becomes a number.
   */
  private parseShowWhen(raw: string): unknown {
    const trimmed = raw.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
    return raw;
  }

  private stringifyShowWhen(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
