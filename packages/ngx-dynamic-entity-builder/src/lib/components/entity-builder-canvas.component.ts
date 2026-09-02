import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { resolveLabel } from '@dynamic-entity/core';
import { BuilderStore, type BuilderFieldGroup } from '../builder-store.service';
import { EntityBuilderTreeNodeComponent } from './entity-builder-tree-node.component';
import { BuilderTextService } from '../builder-text';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-entity-builder-canvas',
  standalone: true,
  imports: [CommonModule, DragDropModule, MatCardModule, MatIconModule, EntityBuilderTreeNodeComponent],
  template: `
    <mat-card class="deb-canvas">
      <mat-card-header>
        <mat-card-title>{{ ui.text('fieldsHeading', { count: store.fields().length }) }}</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        @if (store.fields().length === 0) {
          <div class="deb-empty">
            <mat-icon>widgets</mat-icon>
            <p>{{ ui.text('canvasEmpty') }}</p>
          </div>
        }

        @for (group of store.fieldGroups(); track group.tabId) {
          <!--
            One drop list per tab. A single list spanning every tab would hand reorderField
            an index into the combined view, which is not the index of anything in the tab
            that actually owns the field.
          -->
          @if (showTabHeadings()) {
            <h4 class="deb-canvas__group" [attr.data-testid]="'builder-group-' + group.tabId">
              {{ groupLabel(group) }}
            </h4>
          }
          <div
            cdkDropList
            class="deb-field-list"
            [attr.data-testid]="'builder-field-list-' + group.tabId"
            (cdkDropListDropped)="onDrop(group.tabId, $event)"
          >
            @for (f of group.fields; track f.id; let i = $index, count = $count) {
              <ngx-entity-builder-tree-node [field]="f" [index]="i" [totalCount]="count" />
            }
          </div>
        }
      </mat-card-content>
    </mat-card>
  `,
})
export class EntityBuilderCanvasComponent {
  /** Builder chrome, overridable via BUILDER_TEXT. */
  protected readonly ui = inject(BuilderTextService);
  protected readonly store = inject(BuilderStore);

  /**
   * Headings only earn their space once the fields are actually split across tabs. A
   * single-tab config — the common case, and every existing spec — renders exactly as before.
   */
  protected showTabHeadings(): boolean {
    return this.store.fieldGroups().length > 1;
  }

  protected groupLabel(group: BuilderFieldGroup): string {
    return resolveLabel(group.label, this.store.activeLanguage()) || group.tabId;
  }

  protected onDrop(tabId: string, event: CdkDragDrop<unknown>): void {
    this.store.reorderField(event.previousIndex, event.currentIndex, tabId);
  }
}
