import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConfigSourceService } from 'ngx-dynamic-entity';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';

@Component({
  selector: 'ngx-referenced-field-config',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
  ],
  template: `
    @if (field(); as f) {
      <div class="deb-referenced-field" style="margin-top: 16px;">
        <div class="deb-row" style="justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span class="deb-section-title" style="margin:0;">Referenced Field</span>
          <mat-slide-toggle
            data-testid="toggle-referenced"
            [ngModel]="f.isReferenced ?? false"
            (ngModelChange)="toggleReferenced(f, $event)"
          >
            Link
          </mat-slide-toggle>
        </div>

        @if (f.isReferenced) {
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full" style="margin-bottom: 8px;">
            <mat-label>Source Entity Key</mat-label>
            <input
              matInput
              data-testid="referenced-entity-key"
              [ngModel]="f.referencedEntityKey ?? ''"
              (ngModelChange)="updateEntityKey(f, $event)"
              placeholder="e.g. individuals"
            />
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full" style="margin-bottom: 8px;">
            <mat-label>Source Field ID</mat-label>
            <input
              matInput
              data-testid="referenced-field-id"
              [ngModel]="f.referencedFieldId ?? ''"
              (ngModelChange)="updateFieldId(f, $event)"
              placeholder="e.g. firstName"
            />
          </mat-form-field>

          @if (f.hasDrift) {
            <div class="deb-drift-banner" data-testid="drift-banner" style="background: #fff3e0; border: 1px solid #ffe0b2; padding: 8px 12px; border-radius: 4px; margin-top: 8px;">
              <div class="deb-row" style="gap: 8px; align-items: center; color: #e65100; font-weight: 500;">
                <mat-icon style="font-size: 18px; width:18px; height:18px;">warning</mat-icon>
                <span>Source field definition has drifted!</span>
              </div>
              <p style="margin: 4px 0 8px 0; font-size: 12px; color: #666;">
                The upstream field configuration in "{{ f.referencedEntityKey }}" has evolved.
              </p>
              <button
                mat-flat-button
                color="warn"
                type="button"
                data-testid="sync-source-btn"
                (click)="syncWithSource(f)"
              >
                Sync with Source
              </button>
            </div>
          }
        }
      </div>
    }
  `,
})
export class ReferencedFieldConfigComponent {
  protected readonly store = inject(BuilderStore);
  protected readonly configSource = inject(ConfigSourceService, { optional: true }) as ConfigSourceService | null;
  protected readonly field = computed(() => this.store.selectedField());

  protected toggleReferenced(field: NestedFieldConfig, enabled: boolean): void {
    if (enabled) {
      this.store.updateField(field.id, { isReferenced: true });
    } else {
      this.store.unlinkReferencedField(field.id);
    }
  }

  protected updateEntityKey(field: NestedFieldConfig, key: string): void {
    const trimmed = key.trim();
    this.store.updateField(field.id, { referencedEntityKey: trimmed || undefined });
    this.checkDriftForField(field.id);
  }

  protected updateFieldId(field: NestedFieldConfig, fieldId: string): void {
    const trimmed = fieldId.trim();
    this.store.updateField(field.id, { referencedFieldId: trimmed || undefined });
    this.checkDriftForField(field.id);
  }

  protected async syncWithSource(field: NestedFieldConfig): Promise<void> {
    if (!field.referencedEntityKey || !field.referencedFieldId || !this.configSource) return;
    const sourceConfig = await this.configSource.getConfig(field.referencedEntityKey);
    if (!sourceConfig) return;

    const sourceField = this.findField(sourceConfig.tabs ?? [], field.referencedFieldId);
    if (sourceField) {
      this.store.syncReferencedField(field.id, sourceField);
    }
  }

  /**
   * Both callers pass the id of the field they just edited. This used to ignore that
   * argument and read `store.selectedField()` instead, so whenever the edited field was not
   * the selected one it checked drift against the wrong field's source entity — or bailed
   * out entirely if nothing was selected.
   */
  private async checkDriftForField(fieldId: string): Promise<void> {
    const f = this.store.fields().find(field => field.id === fieldId);
    if (!f || !f.isReferenced || !f.referencedEntityKey || !f.referencedFieldId || !this.configSource) return;
    const sourceConfig = await this.configSource.getConfig(f.referencedEntityKey);
    if (sourceConfig) {
      this.store.checkDrift({ [f.referencedEntityKey]: sourceConfig });
    }
  }

  private findField(tabs: any[], id: string): NestedFieldConfig | undefined {
    for (const t of tabs) {
      for (const f of t.fields ?? []) {
        if (f.id === id) return f;
        if (f.children?.length) {
          const res = this.findFieldInList(f.children, id);
          if (res) return res;
        }
      }
    }
    return undefined;
  }

  private findFieldInList(fields: NestedFieldConfig[], id: string): NestedFieldConfig | undefined {
    for (const f of fields) {
      if (f.id === id) return f;
      if (f.children?.length) {
        const res = this.findFieldInList(f.children, id);
        if (res) return res;
      }
    }
    return undefined;
  }
}
