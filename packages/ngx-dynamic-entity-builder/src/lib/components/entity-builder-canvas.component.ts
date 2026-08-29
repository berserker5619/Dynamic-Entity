import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { BuilderStore } from '../builder-store.service';
import { EntityBuilderTreeNodeComponent } from './entity-builder-tree-node.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-entity-builder-canvas',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    MatCardModule,
    MatIconModule,
    EntityBuilderTreeNodeComponent,
  ],
  template: `
    <mat-card class="deb-canvas">
      <mat-card-header>
        <mat-card-title>Fields ({{ store.fields().length }})</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        @if (store.fields().length === 0) {
          <div class="deb-empty">
            <mat-icon>widgets</mat-icon>
            <p>No fields yet. Pick a type from <strong>Add field</strong> to get started.</p>
          </div>
        }

        <div cdkDropList class="deb-field-list" data-testid="builder-field-list" (cdkDropListDropped)="onDrop($event)">
          @for (f of store.fields(); track f.id; let i = $index, count = $count) {
            <ngx-entity-builder-tree-node
              [field]="f"
              [index]="i"
              [totalCount]="count"
            />
          }
        </div>
      </mat-card-content>
    </mat-card>
  `,
})
export class EntityBuilderCanvasComponent {
  protected readonly store = inject(BuilderStore);

  protected onDrop(event: CdkDragDrop<unknown>): void {
    this.store.reorderField(event.previousIndex, event.currentIndex);
  }
}
