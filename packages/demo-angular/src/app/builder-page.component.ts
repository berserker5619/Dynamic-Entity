import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EntityBuilderComponent, EntityFormConfig } from 'ngx-dynamic-entity-builder';
import { DynamicFormComponent } from 'ngx-dynamic-entity';
import { LocalStore } from './mock/local-store.service';

/**
 * BuilderPageComponent — demo host for <ngx-entity-builder>.
 */
@Component({
  selector: 'app-builder-page',
  standalone: true,
  imports: [CommonModule, EntityBuilderComponent, DynamicFormComponent],
  template: `
    @if (message()) {
      <div class="builder-toast" [class.builder-toast--error]="isError()">{{ message() }}</div>
    }

    <ngx-entity-builder
      [config]="editing()"
      [languages]="['en', 'de']"
      [availableRoles]="['admin', 'manager', 'IT_SUPPORT', 'viewer']"
      (configChange)="draft.set($event)"
      (save)="onSave($event)"
    >
      @if (draft(); as c) {
        <div ngxBuilderPreview class="builder-preview">
          <h3>Live preview — {{ c.entity || 'Unnamed Entity' }}</h3>
          <ngx-dynamic-form [config]="c" [userRoles]="['admin']"></ngx-dynamic-form>
        </div>
      }
    </ngx-entity-builder>
  `,
  styles: [
    `
      .builder-preview {
        background: #fff;
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 8px;
        padding: 20px;
      }
      .builder-preview h3 {
        margin-top: 0;
      }
      .builder-toast {
        margin: 0 16px 12px;
        padding: 10px 14px;
        border-radius: 6px;
        background: #dcfce7;
        color: #166534;
        font-weight: 600;
      }
      .builder-toast--error {
        background: #fee2e2;
        color: #991b1b;
      }
    `,
  ],
})
export class BuilderPageComponent {
  private readonly store = inject(LocalStore);

  readonly editing = signal<EntityFormConfig>({
    entity: 'new_entity',
    version: 1,
    tabs: [{ id: 'main', label: { en: 'Main' }, fields: [] }],
  });
  readonly draft = signal<EntityFormConfig | null>(this.editing());

  readonly message = signal<string | null>(null);
  readonly isError = signal(false);

  onSave(config: EntityFormConfig): void {
    try {
      // Create when new, update when the entity already has a saved version.
      if (this.store.getConfig(config.entity)) {
        this.store.updateConfig(config.entity, config);
      } else {
        this.store.saveConfig(config);
      }
      this.isError.set(false);
      this.message.set(`Saved "${config.entity}" ✓`);
    } catch (err: any) {
      this.isError.set(true);
      this.message.set(err?.message || `Failed to save "${config.entity}"`);
    }
  }
}
