import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { resolveLabel, type NestedFieldConfig } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';
import { getFieldTypeMeta } from '../field-catalog';

@Component({
  selector: 'ngx-entity-builder-tree-node',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  template: `
    <div
      cdkDrag
      class="deb-field-row"
      data-testid="builder-field-row"
      [class.deb-field-row--active]="store.selectedFieldId() === field.id"
      (click)="store.selectField(field.id)"
    >
      <mat-icon class="deb-drag-handle" cdkDragHandle title="Drag to reorder">drag_indicator</mat-icon>
      <mat-icon class="deb-field-type" [matTooltip]="fieldTypeLabel(field.type)">{{ fieldTypeIcon(field.type) }}</mat-icon>
      <div class="deb-field-meta">
        <div class="deb-row" style="gap:6px">
          <span class="deb-field-label" [attr.data-testid]="'row-label-' + field.id">{{ fieldLabel(field) }}</span>
          <span class="deb-type-badge">{{ field.type }}</span>
        </div>
        <span class="deb-field-id" [attr.data-testid]="'row-id-' + field.id">{{ field.id }}</span>
      </div>
      @if (field.validators?.required) { <span class="deb-req" title="Required">*</span> }

      <button mat-icon-button type="button" [disabled]="index === 0"
        [attr.data-testid]="'row-up-' + field.id"
        (click)="store.moveField(field.id, -1); $event.stopPropagation()" matTooltip="Move up">
        <mat-icon>arrow_upward</mat-icon>
      </button>
      <button mat-icon-button type="button" [disabled]="index === totalCount - 1"
        [attr.data-testid]="'row-down-' + field.id"
        (click)="store.moveField(field.id, 1); $event.stopPropagation()" matTooltip="Move down">
        <mat-icon>arrow_downward</mat-icon>
      </button>
      <button mat-icon-button type="button"
        [attr.data-testid]="'row-duplicate-' + field.id"
        (click)="store.duplicateField(field.id); $event.stopPropagation()" matTooltip="Duplicate">
        <mat-icon>content_copy</mat-icon>
      </button>
      <button mat-icon-button type="button" color="warn"
        [attr.data-testid]="'row-delete-' + field.id"
        (click)="store.removeField(field.id); $event.stopPropagation()" matTooltip="Delete">
        <mat-icon>delete</mat-icon>
      </button>
    </div>

    @if (field.children && field.children.length > 0) {
      <div class="deb-tree-children" style="padding-left: 20px; border-left: 2px solid rgba(0,0,0,0.08); margin-left: 12px; margin-top: 4px;">
        @for (child of field.children; track child.id; let ci = $index, cCount = $count) {
          <ngx-entity-builder-tree-node
            [field]="child"
            [index]="ci"
            [totalCount]="cCount"
          />
        }
      </div>
    }
  `,
})
export class EntityBuilderTreeNodeComponent {
  protected readonly store = inject(BuilderStore);

  @Input({ required: true }) field!: NestedFieldConfig;
  @Input({ required: true }) index!: number;
  @Input({ required: true }) totalCount!: number;

  protected fieldTypeLabel(type: string): string {
    return getFieldTypeMeta(type)?.label ?? type;
  }

  protected fieldTypeIcon(type: string): string {
    return getFieldTypeMeta(type)?.icon ?? 'help_outline';
  }

  protected fieldLabel(field: { id: string; label?: any }): string {
    const lang = this.store.activeLanguage();
    return resolveLabel(field.label, lang) || field.id;
  }
}
