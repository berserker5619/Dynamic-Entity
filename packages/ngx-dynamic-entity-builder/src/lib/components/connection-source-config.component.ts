import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { BuilderStore } from '../builder-store.service';

/**
 * ConnectionSourceConfigComponent — allows configuring connection source settings
 * for an entity or field (Phase 7.2).
 */
@Component({
  selector: 'ngx-connection-source-config',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    @if (field(); as f) {
      <div class="deb-connection-source">
        <span class="deb-section-title">Connection Source</span>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>Source Entity</mat-label>
          <input
            matInput
            data-testid="connection-source-entity"
            [ngModel]="connectionSourceEntity(f)"
            (ngModelChange)="setConnectionSourceEntity(f, $event)"
            placeholder="e.g. organizations"
          />
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-full">
          <mat-label>Target Field ID</mat-label>
          <input
            matInput
            data-testid="connection-target-field"
            [ngModel]="connectionTargetField(f)"
            (ngModelChange)="setConnectionTargetField(f, $event)"
            placeholder="e.g. companyId"
          />
        </mat-form-field>
      </div>
    }
  `,
})
export class ConnectionSourceConfigComponent {
  protected readonly store = inject(BuilderStore);
  protected readonly field = computed(() => this.store.selectedField());

  protected connectionSourceEntity(field: any): string {
    return field.connectionSource?.entity ?? '';
  }

  protected setConnectionSourceEntity(field: any, entity: string): void {
    const trimmed = entity.trim();
    const existing = field.connectionSource ?? {};
    if (!trimmed && !existing.targetField) {
      this.store.updateField(field.id, { connectionSource: undefined } as any);
    } else {
      this.store.updateField(field.id, {
        connectionSource: { ...existing, entity: trimmed },
      } as any);
    }
  }

  protected connectionTargetField(field: any): string {
    return field.connectionSource?.targetField ?? '';
  }

  protected setConnectionTargetField(field: any, targetField: string): void {
    const trimmed = targetField.trim();
    const existing = field.connectionSource ?? {};
    if (!trimmed && !existing.entity) {
      this.store.updateField(field.id, { connectionSource: undefined } as any);
    } else {
      this.store.updateField(field.id, {
        connectionSource: { ...existing, targetField: trimmed },
      } as any);
    }
  }
}
