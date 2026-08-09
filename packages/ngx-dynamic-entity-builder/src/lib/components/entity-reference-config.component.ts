import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';

/**
 * EntityReferenceConfigComponent — authors the `entityReference` block of an entity-ref field:
 * registry key, display fields, static filters, and the parent→child cascade.
 *
 * Also authors `autoPatch`, since the mappings only make sense against the record the
 * selected reference returns.
 */
@Component({
  selector: 'ngx-entity-reference-config',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  template: `
    @if (field(); as f) {
      <div class="deb-entity-ref">
        <span class="deb-section-title">Entity reference</span>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>Registry key</mat-label>
          <input
            matInput
            data-testid="entity-ref-key"
            [ngModel]="ref(f).linkedEntityKey ?? ''"
            (ngModelChange)="patchRef(f, { linkedEntityKey: $event || undefined })"
          />
          <mat-hint>Key the consumer registered a loader under. Defaults to the field id.</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>Display fields</mat-label>
          <input
            matInput
            data-testid="entity-ref-display-fields"
            [ngModel]="displayFieldsText(f)"
            (ngModelChange)="setDisplayFields(f, $event)"
          />
          <mat-hint>Comma-separated record paths used to build each option label.</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>Static filters (JSON)</mat-label>
          <input
            matInput
            data-testid="entity-ref-filters"
            [ngModel]="filtersText(f)"
            (ngModelChange)="setFilters(f, $event)"
          />
          @if (filtersError()) {
            <mat-hint class="deb-error-hint">{{ filtersError() }}</mat-hint>
          } @else {
            <mat-hint>Passed to the loader, e.g. &#123;"isEmployee": false&#125;.</mat-hint>
          }
        </mat-form-field>

        <mat-divider></mat-divider>

        <!-- Cascade -->
        <span class="deb-section-title">Cascade</span>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>Parent field</mat-label>
          <mat-select
            data-testid="entity-ref-parent"
            [ngModel]="ref(f).parentField ?? ''"
            (ngModelChange)="patchRef(f, { parentField: $event || undefined })"
          >
            <mat-option value="">None — load all options</mat-option>
            @for (candidate of parentCandidates(); track candidate.id) {
              <mat-option [value]="candidate.id">{{ fieldLabel(candidate) }} ({{ candidate.id }})</mat-option>
            }
          </mat-select>
          <mat-hint>This field's options reload whenever the parent changes.</mat-hint>
        </mat-form-field>

        @if (ref(f).parentField) {
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
            <mat-label>Lookup filter path</mat-label>
            <input
              matInput
              data-testid="entity-ref-lookup-filter"
              [ngModel]="ref(f).lookupFilter ?? ''"
              (ngModelChange)="patchRef(f, { lookupFilter: $event || undefined })"
            />
            <mat-hint>Keep options whose record matches the parent value at this path.</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
            <mat-label>Lookup path (nested options)</mat-label>
            <input
              matInput
              data-testid="entity-ref-lookup-path"
              [ngModel]="ref(f).lookupPath ?? ''"
              (ngModelChange)="patchRef(f, { lookupPath: $event || undefined })"
            />
            <mat-hint>Take options from this array on the selected parent's record instead.</mat-hint>
          </mat-form-field>
        }

        <mat-divider></mat-divider>

        <!-- autoPatch -->
        <div class="deb-row deb-row--split">
          <span class="deb-section-title">Auto-patch on select</span>
          <button
            mat-stroked-button
            type="button"
            data-testid="add-auto-patch"
            (click)="store.addAutoPatchMapping(f.id)"
          >
            <mat-icon>add</mat-icon> Mapping
          </button>
        </div>

        @if (f.autoPatch) {
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
            <mat-label>Target tab</mat-label>
            <mat-select
              data-testid="auto-patch-tab"
              [ngModel]="f.autoPatch.targetTab"
              (ngModelChange)="store.setAutoPatchTargetTab(f.id, $event)"
            >
              @for (tab of store.tabs(); track tab.id) {
                <mat-option [value]="tab.id">{{ tabLabel(tab.id) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          @for (mapping of f.autoPatch.mappings; track $index) {
            <div class="deb-option-row">
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Source (linked record)</mat-label>
                <input
                  matInput
                  [ngModel]="mapping.source"
                  (ngModelChange)="store.updateAutoPatchMapping(f.id, $index, { source: $event })"
                />
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Target field</mat-label>
                <input
                  matInput
                  [ngModel]="mapping.target"
                  (ngModelChange)="store.updateAutoPatchMapping(f.id, $index, { target: $event })"
                />
              </mat-form-field>
              <button
                mat-icon-button
                type="button"
                color="warn"
                matTooltip="Remove mapping"
                (click)="store.removeAutoPatchMapping(f.id, $index)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          }
        } @else {
          <p class="deb-hint">
            No auto-patch configured — selecting a reference will not copy any values.
          </p>
        }
      </div>
    }
  `,
  styles: [
    `
      .deb-entity-ref {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .deb-full {
        width: 100%;
      }
      .deb-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .deb-row--split {
        justify-content: space-between;
      }
      .deb-option-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .deb-option-row > mat-form-field {
        flex: 1;
      }
      .deb-error-hint {
        color: #b91c1c;
      }
    `,
  ],
})
export class EntityReferenceConfigComponent {
  protected readonly store = inject(BuilderStore);

  protected readonly field = this.store.selectedField;

  /** Sibling fields that can drive a cascade — anything but this field itself. */
  protected readonly parentCandidates = computed<NestedFieldConfig[]>(() => {
    const current = this.field();
    return this.store.fields().filter(f => f.id !== current?.id);
  });

  private readonly filtersParseError = signal<string | null>(null);
  protected readonly filtersError = this.filtersParseError.asReadonly();

  protected ref(field: NestedFieldConfig) {
    return field.entityReference ?? { enabled: true };
  }

  protected patchRef(field: NestedFieldConfig, patch: Record<string, unknown>): void {
    this.store.updateEntityReference(field.id, patch);
  }

  protected fieldLabel(field: NestedFieldConfig): string {
    return resolveLabel(field.label, this.store.activeLanguage());
  }

  protected tabLabel(tabId: string): string {
    const tab = this.store.tabs().find(t => t.id === tabId);
    return tab ? resolveLabel(tab.label, this.store.activeLanguage()) : tabId;
  }

  protected displayFieldsText(field: NestedFieldConfig): string {
    return (this.ref(field).displayFields ?? []).join(', ');
  }

  protected setDisplayFields(field: NestedFieldConfig, value: string): void {
    const parts = value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    this.patchRef(field, { displayFields: parts.length ? parts : undefined });
  }

  protected filtersText(field: NestedFieldConfig): string {
    const filters = this.ref(field).filters;
    return filters ? JSON.stringify(filters) : '';
  }

  /** Invalid JSON is reported inline and left unapplied rather than silently dropped. */
  protected setFilters(field: NestedFieldConfig, value: string): void {
    const trimmed = value.trim();
    if (!trimmed) {
      this.filtersParseError.set(null);
      this.patchRef(field, { filters: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        this.filtersParseError.set('Filters must be a JSON object.');
        return;
      }
      this.filtersParseError.set(null);
      this.patchRef(field, { filters: parsed as Record<string, unknown> });
    } catch {
      this.filtersParseError.set('Invalid JSON.');
    }
  }
}
