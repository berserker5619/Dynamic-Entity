import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { resolveLabel } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';

/**
 * TabManagerComponent — add / rename / reorder / remove tabs (Angular Material).
 */
@Component({
  selector: 'ngx-tab-manager',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <div class="deb-tabs">
      <div class="deb-tabs__head">
        <span class="deb-section-title">Tabs</span>
        <button mat-stroked-button type="button" (click)="store.addTab()">
          <mat-icon>add</mat-icon> Add
        </button>
      </div>

      @if (store.tabs().length === 0) {
        <p class="deb-hint">No tabs — all fields render in a single section.</p>
      }

      @for (tab of store.tabs(); track tab.id; let i = $index, count = $count) {
        <div class="deb-tabs__row">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-grow">
            <mat-label>{{ tab.id }}</mat-label>
            <input
              matInput
              [ngModel]="tabLabel(tab)"
              (ngModelChange)="store.setTabLabel(tab.id, lang(), $event)"
            />
          </mat-form-field>
          <button mat-icon-button type="button" [disabled]="i === 0"
            (click)="store.moveTab(tab.id, -1)" matTooltip="Move up">
            <mat-icon>arrow_upward</mat-icon>
          </button>
          <button mat-icon-button type="button" [disabled]="i === count - 1"
            (click)="store.moveTab(tab.id, 1)" matTooltip="Move down">
            <mat-icon>arrow_downward</mat-icon>
          </button>
          <button mat-icon-button type="button" color="warn"
            (click)="store.removeTab(tab.id)" matTooltip="Remove tab">
            <mat-icon>delete</mat-icon>
          </button>
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
        margin-bottom: 8px;
      }
      .deb-tabs__row {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .deb-grow {
        flex: 1;
      }
    `,
  ],
})
export class TabManagerComponent {
  protected readonly store = inject(BuilderStore);

  protected lang(): string {
    return this.store.activeLanguage();
  }

  protected tabLabel(tab: { label?: any }): string {
    return resolveLabel(tab.label, this.lang());
  }
}
