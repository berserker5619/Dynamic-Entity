import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
import { resolveLabel, toRefToken } from '@dynamic-entity/core';
import { fieldPathOptions, withExistingOptions, type FieldPathOption } from '../field-path-options';
import { BuilderStore } from '../builder-store.service';
import { BuilderTextService } from '../builder-text';

/**
 * EntityReferenceConfigComponent — authors the `entityReference` block of an entity-ref field:
 * registry key, display fields, static filters, and the parent→child cascade.
 *
 * Also authors `autoPatch`, since the mappings only make sense against the record the
 * selected reference returns.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
        <span class="deb-section-title">{{ ui.text('entityReference') }}</span>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>{{ ui.text('registryKey') }}</mat-label>
          <input
            matInput
            data-testid="entity-ref-key"
            [ngModel]="ref(f).linkedEntityKey ?? ''"
            (ngModelChange)="patchRef(f, { linkedEntityKey: $event || undefined })"
          />
          <mat-hint>{{ ui.text('registryKeyHint') }}</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>{{ ui.text('displayFields') }}</mat-label>
          <input
            matInput
            data-testid="entity-ref-display-fields"
            [ngModel]="displayFieldsText(f)"
            (ngModelChange)="setDisplayFields(f, $event)"
          />
          <mat-hint>{{ ui.text('displayFieldsHint') }}</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>{{ ui.text('staticFilters') }}</mat-label>
          <input
            matInput
            data-testid="entity-ref-filters"
            [ngModel]="filtersText(f)"
            (ngModelChange)="setFilters(f, $event)"
          />
          @if (filtersError()) {
            <mat-hint class="deb-error-hint">{{ filtersError() }}</mat-hint>
          } @else {
            <mat-hint>{{ ui.text('staticFiltersHint') }}</mat-hint>
          }
        </mat-form-field>

        <mat-divider></mat-divider>

        <!-- Cascade -->
        <span class="deb-section-title">{{ ui.text('cascade') }}</span>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>{{ ui.text('parentField') }}</mat-label>
          <mat-select
            data-testid="entity-ref-parent"
            [ngModel]="ref(f).parentField ?? ''"
            (ngModelChange)="patchRef(f, { parentField: $event || undefined })"
          >
            <mat-option value="">{{ ui.text('parentFieldNone') }}</mat-option>
            @for (option of parentOptions(); track option.value) {
              <mat-option [value]="option.value">
                {{ option.label }} <span class="deb-path-hint">{{ option.path }}</span>
              </mat-option>
            }
          </mat-select>
          <mat-hint>{{ ui.text('cascadeHint') }}</mat-hint>
        </mat-form-field>

        @if (ref(f).parentField) {
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
            <mat-label>{{ ui.text('lookupFilterPath') }}</mat-label>
            <input
              matInput
              data-testid="entity-ref-lookup-filter"
              [ngModel]="ref(f).lookupFilter ?? ''"
              (ngModelChange)="patchRef(f, { lookupFilter: $event || undefined })"
            />
            <mat-hint>{{ ui.text('lookupFilterPathHint') }}</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
            <mat-label>{{ ui.text('lookupPath') }}</mat-label>
            <input
              matInput
              data-testid="entity-ref-lookup-path"
              [ngModel]="ref(f).lookupPath ?? ''"
              (ngModelChange)="patchRef(f, { lookupPath: $event || undefined })"
            />
            <mat-hint>{{ ui.text('lookupPathHint') }}</mat-hint>
          </mat-form-field>
        }

        <mat-divider></mat-divider>

        <!-- autoPatch -->
        <div class="deb-row deb-row--split">
          <span class="deb-section-title">{{ ui.text('autoPatchOnSelect') }}</span>
          <button
            mat-stroked-button
            type="button"
            data-testid="add-auto-patch"
            (click)="store.addAutoPatchMapping(store.keyOf(f))"
          >
            <mat-icon>add</mat-icon> {{ ui.text('mapping') }}
          </button>
        </div>

        @if (f.autoPatch) {
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
            <mat-label>{{ ui.text('targetTab') }}</mat-label>
            <mat-select
              data-testid="auto-patch-tab"
              [ngModel]="f.autoPatch.targetTab"
              (ngModelChange)="store.setAutoPatchTargetTab(store.keyOf(f), $event)"
            >
              @for (tab of store.tabs(); track tab.id) {
                <mat-option [value]="tab.id">{{ tabLabel(tab.id) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          @for (mapping of f.autoPatch.mappings; track $index) {
            <div class="deb-option-row">
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>{{ ui.text('sourceLinkedRecord') }}</mat-label>
                <input
                  matInput
                  [ngModel]="mapping.source"
                  (ngModelChange)="store.updateAutoPatchMapping(store.keyOf(f), $index, { source: $event })"
                />
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>{{ ui.text('targetField') }}</mat-label>
                <mat-select
                  data-testid="auto-patch-target"
                  [ngModel]="mapping.target"
                  (ngModelChange)="store.updateAutoPatchMapping(store.keyOf(f), $index, { target: $event })"
                >
                  @for (option of optionsWith(mapping.target); track option.value) {
                    <mat-option [value]="option.value">
                      {{ option.label }} <span class="deb-path-hint">{{ option.path }}</span>
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <button
                mat-icon-button
                type="button"
                color="warn"
                [matTooltip]="ui.text('removeMapping')"
                (click)="store.removeAutoPatchMapping(store.keyOf(f), $index)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          }
        } @else {
          <p class="deb-hint">
            {{ ui.text('noAutoPatch') }}
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
  /** Builder chrome, overridable via BUILDER_TEXT. */
  protected readonly ui = inject(BuilderTextService);
  protected readonly store = inject(BuilderStore);

  protected readonly field = this.store.selectedField;

  /** Sibling fields that can drive a cascade — anything but this field itself. */
  protected readonly parentCandidates = computed<NestedFieldConfig[]>(() => {
    const current = this.field();
    return this.store.fields().filter(f => f.id !== current?.id);
  });

  private readonly fieldOptions = computed<FieldPathOption[]>(() =>
    fieldPathOptions(this.store.config(), this.store.activeLanguage()),
  );

  /**
   * Cascade parents, offered by path.
   *
   * The picker existed but its values were bare ids, which name a field only while no second
   * scope reuses the id — so the one control that was already a list could still produce an
   * ambiguous reference.
   */
  protected parentOptions(): FieldPathOption[] {
    const self = this.field();
    const selfValue = self ? toRefToken(self.refererField ?? self.id) : null;
    const options = this.fieldOptions().filter(o => o.value !== selfValue);
    return withExistingOptions(options, [this.field() ? this.ref(this.field()!).parentField : undefined]);
  }

  /** Options plus whatever is already selected, so an unknown reference is never dropped. */
  protected optionsWith(...current: (string | undefined)[]): FieldPathOption[] {
    return withExistingOptions(this.fieldOptions(), current);
  }

  private readonly filtersParseError = signal<string | null>(null);
  protected readonly filtersError = this.filtersParseError.asReadonly();

  protected ref(field: NestedFieldConfig) {
    return field.entityReference ?? { enabled: true };
  }

  protected patchRef(field: NestedFieldConfig, patch: Record<string, unknown>): void {
    this.store.updateEntityReference(this.store.keyOf(field), patch);
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
