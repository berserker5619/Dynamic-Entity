import { Component, InjectionToken, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { NestedTabConfig } from '@dynamic-entity/core';
import { resolveLabel } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';

export const SYSTEM_DEFAULT_CAN_EDIT = new InjectionToken<(roles: string[]) => boolean>('SYSTEM_DEFAULT_CAN_EDIT');

/**
 * TabManagerComponent — add / rename / reorder / remove tabs & sub-tabs with systemDefault protection.
 */
@Component({
  selector: 'ngx-tab-manager',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  template: `
    <div class="deb-tabs">
      <div class="deb-tabs__head">
        <span class="deb-section-title">Tabs Manager</span>
        <button mat-stroked-button type="button" (click)="store.addTab()">
          <mat-icon>add</mat-icon> Add Tab
        </button>
      </div>

      @if (store.tabs().length === 0) {
        <p class="deb-hint">No tabs — all fields render in a single section.</p>
      }

      @for (tab of store.tabs(); track tab.id; let i = $index, count = $count) {
        <div class="deb-tab-card" [class.deb-tab-card--system]="tab.systemDefault">
          <div class="deb-tabs__row" [attr.data-testid]="'tab-row-' + tab.id">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-grow">
              <mat-label>{{ tab.id }} {{ tab.systemDefault ? '(System)' : '' }}</mat-label>
              <input
                matInput
                [disabled]="!canEditTab(tab)"
                [ngModel]="tabLabel(tab)"
                (ngModelChange)="store.setTabLabel(tab.id, lang(), $event)"
              />
            </mat-form-field>
            <button
              mat-icon-button
              type="button"
              [disabled]="i === 0 || !canEditTab(tab)"
              (click)="store.moveTab(tab.id, -1)"
              matTooltip="Move up"
            >
              <mat-icon>arrow_upward</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              [disabled]="i === count - 1 || !canEditTab(tab)"
              (click)="store.moveTab(tab.id, 1)"
              matTooltip="Move down"
            >
              <mat-icon>arrow_downward</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              color="warn"
              [disabled]="!canEditTab(tab)"
              (click)="store.removeTab(tab.id)"
              matTooltip="Remove tab"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </div>

          <!-- Tab settings row -->
          <div class="deb-tab-settings">
            <mat-checkbox
              [disabled]="!canEditTab(tab)"
              [ngModel]="tab.flatData"
              (ngModelChange)="store.updateTab(tab.id, { flatData: $event })"
            >
              Flat Data
            </mat-checkbox>
            <mat-checkbox
              [disabled]="!canEditTab(tab)"
              [ngModel]="tab.isPrimaryTab"
              (ngModelChange)="$event ? store.setPrimaryTab(tab.id) : store.updateTab(tab.id, { isPrimaryTab: false })"
            >
              Primary Tab
            </mat-checkbox>
            <mat-checkbox
              [disabled]="!canEditTab(tab)"
              [ngModel]="tab.maskData"
              (ngModelChange)="store.updateTab(tab.id, { maskData: $event })"
            >
              Mask Tab Data
            </mat-checkbox>
            <mat-checkbox
              [disabled]="!canEditTab(tab)"
              [ngModel]="tab.systemDefault"
              (ngModelChange)="store.updateTab(tab.id, { systemDefault: $event })"
            >
              System Default
            </mat-checkbox>
            <button
              mat-button
              type="button"
              color="primary"
              [disabled]="!canEditTab(tab)"
              (click)="store.addSubTab(tab.id)"
            >
              + Sub-tab
            </button>
          </div>

          <!-- Module tab configuration -->
          <div class="deb-tab-module">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-grow">
              <mat-label>Consumer Module Name (Optional)</mat-label>
              <input
                matInput
                placeholder="e.g. documents-view"
                [disabled]="!canEditTab(tab)"
                [ngModel]="tab.moduleName"
                (ngModelChange)="store.updateTab(tab.id, { moduleName: $event || undefined })"
              />
            </mat-form-field>
          </div>

          <!-- Sub-tabs recursive render (Level 2) -->
          @if (tab.children && tab.children.length > 0) {
            <div class="deb-subtabs">
              <span class="deb-subtabs__title">Sub-tabs:</span>
              @for (sub of tab.children; track sub.id) {
                <div class="deb-tabs__row deb-subtab-row" [attr.data-testid]="'subtab-row-' + sub.id">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-grow">
                    <mat-label>{{ sub.id }}</mat-label>
                    <input
                      matInput
                      [disabled]="!canEditTab(sub)"
                      [ngModel]="tabLabel(sub)"
                      (ngModelChange)="store.setTabLabel(sub.id, lang(), $event)"
                    />
                  </mat-form-field>
                  <button
                    mat-icon-button
                    type="button"
                    color="warn"
                    [disabled]="!canEditTab(sub)"
                    (click)="store.removeTab(sub.id)"
                    matTooltip="Remove sub-tab"
                  >
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .deb-tabs__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .deb-tab-card {
        border: 1px solid var(--deb-border, #e5e7eb);
        border-radius: 8px;
        padding: 10px;
        margin-bottom: 10px;
        background: var(--deb-bg-surface, #ffffff);
      }
      .deb-tab-card--system {
        border-left: 4px solid var(--deb-accent, #6366f1);
      }
      .deb-tabs__row {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .deb-tab-settings {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        align-items: center;
        margin-top: 8px;
        font-size: 13px;
      }
      .deb-tab-module {
        margin-top: 8px;
      }
      .deb-subtabs {
        margin-top: 8px;
        padding-left: 16px;
        border-left: 2px dashed var(--deb-border, #e5e7eb);
      }
      .deb-subtabs__title {
        font-size: 12px;
        font-weight: 600;
        color: var(--deb-muted, #6b7280);
      }
      .deb-subtab-row {
        margin-top: 6px;
      }
      .deb-grow {
        flex: 1;
      }
    `,
  ],
})
export class TabManagerComponent {
  protected readonly store = inject(BuilderStore);
  private readonly canEditSystemDefaultsFn = inject<(roles: string[]) => boolean>(SYSTEM_DEFAULT_CAN_EDIT, { optional: true });

  protected lang(): string {
    return this.store.activeLanguage();
  }

  protected tabLabel(tab: { label?: any }): string {
    return resolveLabel(tab.label, this.lang());
  }

  protected canEditTab(tab: NestedTabConfig): boolean {
    if (!tab.systemDefault) return true;
    if (this.canEditSystemDefaultsFn) {
      return this.canEditSystemDefaultsFn([]);
    }
    return true;
  }
}
