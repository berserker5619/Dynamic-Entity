import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EntityBuilderComponent, EntityFormConfig } from 'ngx-dynamic-entity-builder';
import { DynamicFormComponent } from 'ngx-dynamic-entity';
import { COMMON_MODULES } from '@dynamic-entity/core';
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
      <div class="builder-toast" data-testid="builder-toast" [attr.data-error]="isError()" [class.builder-toast--error]="isError()">{{ message() }}</div>
    }

    <!--
      The builder used to open on a blank entity and offer no way to reach an existing one,
      so anything that only shows up in an authored config — sub-tabs, most obviously — could
      not be edited or demonstrated at all.
    -->
    <div class="builder-load">
      <label for="builderEntitySelect">Edit an existing entity</label>
      <select
        id="builderEntitySelect"
        data-testid="builder-entity-select"
        [value]="loadedEntity()"
        (change)="loadEntity($any($event.target).value)"
      >
        <option value="">New entity</option>
        @for (name of savedEntities(); track name) {
          <option [value]="name">{{ name }}</option>
        }
      </select>
    </div>

    <ngx-entity-builder
      [config]="editing()"
      [languages]="['en', 'de']"
      [availableRoles]="['admin', 'manager', 'IT_SUPPORT', 'viewer']"
      [commonModules]="commonModules"
      (configChange)="draft.set($event)"
      (save)="onSave($event)"
    >
      @if (draft(); as c) {
        <div ngxBuilderPreview class="builder-preview" data-testid="builder-preview">
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
      .builder-load {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 16px 12px;
      }
      .builder-load select {
        padding: 6px 8px;
      }
    `,
  ],
})
export class BuilderPageComponent {
  private readonly store = inject(LocalStore);

  @Output() entitySaved = new EventEmitter<string>();

  readonly commonModules = COMMON_MODULES;

  readonly editing = signal<EntityFormConfig>({
    entity: 'new_entity',
    version: 1,
    tabs: [{ id: 'main', label: { en: 'Main' }, fields: [] }],
  });
  readonly draft = signal<EntityFormConfig | null>(this.editing());

  readonly message = signal<string | null>(null);
  readonly isError = signal(false);

  readonly loadedEntity = signal('');
  readonly savedEntities = signal<string[]>(this.store.listConfigs().map(c => String(c['entity'])).sort());

  private blankConfig(): EntityFormConfig {
    return { entity: 'new_entity', version: 1, tabs: [{ id: 'main', label: { en: 'Main' }, fields: [] }] };
  }

  /**
   * Loads a saved config into the builder, or starts a blank one.
   *
   * A fresh object every time: the builder stamps field paths on the config it is given, and
   * handing it the same object twice would let one editing session see the other's changes.
   */
  loadEntity(entity: string): void {
    this.loadedEntity.set(entity);
    const saved = entity ? this.store.getConfig(entity) : null;
    const next = saved
      ? (JSON.parse(JSON.stringify(saved)) as EntityFormConfig)
      : this.blankConfig();
    this.editing.set(next);
    this.draft.set(next);
    this.message.set(null);
  }

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
      this.savedEntities.set(this.store.listConfigs().map(c => String(c['entity'])).sort());
      this.entitySaved.emit(config.entity);
    } catch (err: any) {
      this.isError.set(true);
      this.message.set(err?.message || `Failed to save "${config.entity}"`);
    }
  }
}
