import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { resolveLabel, type NestedFieldConfig } from '@dynamic-entity/core';
import { BuilderStore } from '../builder-store.service';
import { getFieldTypeMeta } from '../field-catalog';
import { BuilderTextService } from '../builder-text';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-entity-builder-tree-node',
  standalone: true,
  imports: [CommonModule, DragDropModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div
      cdkDrag
      class="deb-field-row"
      data-testid="builder-field-row"
      [class.deb-field-row--active]="store.isSelected(field)"
      (click)="store.selectField(store.keyOf(field))"
      (keydown.enter)="store.selectField(store.keyOf(field))"
      (keydown.space)="store.selectField(store.keyOf(field)); $event.preventDefault()"
      role="button"
      tabindex="0"
      [attr.aria-pressed]="store.isSelected(field)"
      [attr.aria-label]="ui.text('selectField', { field: fieldLabel(field) })"
    >
      <mat-icon class="deb-drag-handle" cdkDragHandle aria-hidden="true" [title]="ui.text('dragToReorder')"
        >drag_indicator</mat-icon
      >
      <mat-icon class="deb-field-type" [matTooltip]="fieldTypeLabel(field.type)">{{ fieldTypeIcon(field.type) }}</mat-icon>
      <div class="deb-field-meta">
        <div class="deb-row" style="gap:6px">
          <span class="deb-field-label" [attr.data-testid]="'row-label-' + field.id">{{ fieldLabel(field) }}</span>
          <span class="deb-type-badge">{{ field.type }}</span>
          @if (field.isReferenced) {
            <mat-icon
              style="font-size: 16px; width: 16px; height: 16px; color: #1976d2;"
              [matTooltip]="ui.text('referencedFieldTooltip', { entity: field.referencedEntityKey ?? '' })"
              >link</mat-icon
            >
          }
          @if (field.hasDrift) {
            <mat-icon
              style="font-size: 16px; width: 16px; height: 16px; color: #d32f2f;"
              data-testid="drift-warning-icon"
              [matTooltip]="ui.text('driftDetected')"
              >sync_problem</mat-icon
            >
          }
        </div>
        <span class="deb-field-id" [attr.data-testid]="'row-id-' + field.id">{{ field.id }}</span>
      </div>
      @if (field.validators?.required) {
        <span class="deb-req" [title]="ui.text('required')">*</span>
      }

      <button
        mat-icon-button
        type="button"
        [disabled]="index === 0"
        [attr.data-testid]="'row-up-' + field.id"
        [attr.aria-label]="ui.text('moveFieldUp', { field: fieldLabel(field) })"
        (click)="store.moveField(store.keyOf(field), -1); $event.stopPropagation()"
        [matTooltip]="ui.text('moveUp')"
      >
        <mat-icon>arrow_upward</mat-icon>
      </button>
      <button
        mat-icon-button
        type="button"
        [disabled]="index === totalCount - 1"
        [attr.data-testid]="'row-down-' + field.id"
        [attr.aria-label]="ui.text('moveFieldDown', { field: fieldLabel(field) })"
        (click)="store.moveField(store.keyOf(field), 1); $event.stopPropagation()"
        [matTooltip]="ui.text('moveDown')"
      >
        <mat-icon>arrow_downward</mat-icon>
      </button>
      <button
        mat-icon-button
        type="button"
        [attr.data-testid]="'row-duplicate-' + field.id"
        [attr.aria-label]="ui.text('duplicateField', { field: fieldLabel(field) })"
        (click)="store.duplicateField(store.keyOf(field)); $event.stopPropagation()"
        [matTooltip]="ui.text('duplicate')"
      >
        <mat-icon>content_copy</mat-icon>
      </button>
      <button
        mat-icon-button
        type="button"
        color="warn"
        [attr.data-testid]="'row-delete-' + field.id"
        (click)="store.removeField(store.keyOf(field)); $event.stopPropagation()"
        [matTooltip]="ui.text('delete')"
      >
        <mat-icon>delete</mat-icon>
      </button>
    </div>

    @if (field.children && field.children.length > 0) {
      <div
        class="deb-tree-children"
        style="padding-left: 20px; border-left: 2px solid rgba(0,0,0,0.08); margin-left: 12px; margin-top: 4px;"
      >
        @for (child of field.children; track child.id; let ci = $index, cCount = $count) {
          <ngx-entity-builder-tree-node [field]="child" [index]="ci" [totalCount]="cCount" />
        }
      </div>
    }
  `,
})
export class EntityBuilderTreeNodeComponent {
  /** Builder chrome, overridable via BUILDER_TEXT. */
  protected readonly ui = inject(BuilderTextService);
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
