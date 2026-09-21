import { Component, EventEmitter, Input, Output, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EntityBuilderComponent, EntityFormConfig } from 'ngx-dynamic-entity-builder';
import type { FormRule } from '@dynamic-entity/core';
import { DynamicFormComponent } from 'ngx-dynamic-entity';
import { COMMON_MODULES } from '@dynamic-entity/core';
import { LocalStore } from './mock/local-store.service';
import { demoRulesFor, saveDemoRules } from './mock/demo-rules';

/**
 * BuilderPageComponent — demo host for <ngx-entity-builder>.
 */
/**
 * Panel state in `localStorage`, under the demo's own prefix.
 *
 * Wrapped in try/catch because private browsing and blocked site data make even reading
 * throw in some browsers, and a builder that will not open because it could not remember a
 * sidebar is a worse failure than one that opens with both panels showing.
 */
const panelKey = (panel: 'left' | 'right' | 'fields' | 'preview'): string => `de_demo_builder_${panel}_open`;

function readPanel(panel: 'left' | 'right' | 'fields' | 'preview'): boolean {
  try {
    return localStorage.getItem(panelKey(panel)) !== 'false';
  } catch {
    return true;
  }
}

function writePanel(panel: 'left' | 'right' | 'fields' | 'preview', open: boolean): void {
  try {
    localStorage.setItem(panelKey(panel), String(open));
  } catch {
    /* Nothing to do: the panel simply will not be remembered. */
  }
}

@Component({
  selector: 'app-builder-page',
  standalone: true,
  imports: [CommonModule, EntityBuilderComponent, DynamicFormComponent],
  template: `
    @if (message()) {
      <div
        class="builder-toast"
        data-testid="builder-toast"
        [attr.data-error]="isError()"
        [class.builder-toast--error]="isError()"
      >
        {{ message() }}
      </div>
    }

    <!--
      The builder used to open on a blank entity and offer no way to reach an existing one,
      so anything that only shows up in an authored config — sub-tabs, most obviously — could
      not be edited or demonstrated at all.
    -->
    <div class="builder-load">
      <div class="builder-load__picker">
        <label for="builderEntitySelect" class="builder-load__label">
          <span class="builder-load__icon">⚡</span> Edit an existing entity:
        </label>
        <select
          id="builderEntitySelect"
          data-testid="builder-entity-select"
          class="builder-load__select"
          [value]="loadedEntity()"
          (change)="loadEntity($any($event.target).value)"
        >
          <option value="">New entity</option>
          @for (name of savedEntities(); track name) {
            <option [value]="name">{{ name }}</option>
          }
        </select>
      </div>
      <span class="builder-load__status">
        Schema editing &bull; Live reactivity enabled
      </span>
    </div>

    <ngx-entity-builder
      [config]="editing()"
      [languages]="['en', 'de']"
      [uiLanguage]="uiLanguage"
      [availableRoles]="['admin', 'manager', 'IT_SUPPORT', 'viewer']"
      [userRoles]="userRoles"
      [commonModules]="commonModules"
      [(leftSidebarOpen)]="leftSidebarOpen"
      [(rightSidebarOpen)]="rightSidebarOpen"
      [(fieldsOpen)]="fieldsOpen"
      [(previewOpen)]="previewOpen"
      [rules]="rules()"
      (configChange)="draft.set($event)"
      (rulesChange)="authoredRules.set($event)"
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
        padding: 4px 0 0;
      }
      .builder-preview h3 {
        margin: 0 0 12px;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-muted, #64748b);
      }
      .builder-toast {
        margin: 0 0 16px;
        padding: 12px 18px;
        border-radius: 10px;
        background: #dcfce7;
        color: #166534;
        font-weight: 600;
        border: 1px solid #bbf7d0;
        box-shadow: 0 2px 6px rgba(22, 101, 52, 0.08);
      }
      .builder-toast--error {
        background: #fee2e2;
        color: #991b1b;
        border-color: #fecaca;
        box-shadow: 0 2px 6px rgba(153, 27, 27, 0.08);
      }
      .builder-load {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        margin: 0 0 18px;
        padding: 10px 18px;
        background: var(--surface-glass, rgba(255, 255, 255, 0.9));
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 12px);
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.03));
      }
      .builder-load__picker {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .builder-load__label {
        font-size: 13px;
        font-weight: 700;
        color: var(--text, #0f172a);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .builder-load__icon {
        color: var(--primary-600, #4f46e5);
      }
      .builder-load__select {
        padding: 7px 14px;
        font-size: 13px;
        font-weight: 600;
        border-radius: 8px;
        border: 1px solid var(--border, #cbd5e1);
        background: #ffffff;
        color: #0f172a;
        cursor: pointer;
        outline: none;
        transition: all 0.15s ease;
      }
      .builder-load__select:hover {
        border-color: #818cf8;
      }
      .builder-load__select:focus {
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
      }
      .builder-load__status {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted, #64748b);
      }
    `,
  ],
})
export class BuilderPageComponent {
  private readonly store = inject(LocalStore);

  @Output() entitySaved = new EventEmitter<string>();

  /**
   * The builder's own interface language, passed down from the demo header.
   *
   * Not the same as `languages` above, which is the vocabulary a *label* is authored in.
   * Switching the label language you are editing should not translate the panel around it,
   * so the builder keeps the two apart and so does this host.
   */
  @Input() uiLanguage = 'en';

  /**
   * Roles of the person *using* the builder, passed straight through.
   *
   * Distinct from `availableRoles`, which is the vocabulary a schema's own permissions may
   * refer to. This is who is holding the mouse, and it is the only input the
   * `SYSTEM_DEFAULT_CAN_EDIT` predicate ever sees — the builder had no other way to know,
   * so a predicate that inspected roles previously answered for an empty array.
   */
  @Input() userRoles: string[] = ['admin'];

  readonly commonModules = COMMON_MODULES;

  /*
   * Which builder panels are open, remembered across a reload.
   *
   * The builder itself persists nothing — no package in this workspace touches
   * `localStorage`, which is what lets them render on a server — so it exposes the state as
   * two-way bindable inputs and leaves the choice of store to the host. This is that choice,
   * made the way the demo keeps everything else: a `de_demo_` key, which `gotoDemo` already
   * clears, so one spec's collapsed rail is not the next spec's surprise.
   */
  readonly leftSidebarOpen = signal(readPanel('left'));
  readonly rightSidebarOpen = signal(readPanel('right'));
  readonly fieldsOpen = signal(readPanel('fields'));
  readonly previewOpen = signal(readPanel('preview'));

  constructor() {
    effect(() => writePanel('left', this.leftSidebarOpen()));
    effect(() => writePanel('right', this.rightSidebarOpen()));
    effect(() => writePanel('fields', this.fieldsOpen()));
    effect(() => writePanel('preview', this.previewOpen()));
  }

  readonly editing = signal<EntityFormConfig>({
    entity: 'new_entity',
    version: 1,
    tabs: [{ id: 'main', label: { en: 'Main' }, fields: [] }],
  });
  readonly draft = signal<EntityFormConfig | null>(this.editing());

  readonly message = signal<string | null>(null);
  readonly isError = signal(false);

  readonly loadedEntity = signal('');
  readonly savedEntities = signal<string[]>(
    this.store
      .listConfigs()
      .map(c => String(c['entity']))
      .sort(),
  );

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
    const next = saved ? (JSON.parse(JSON.stringify(saved)) as EntityFormConfig) : this.blankConfig();
    this.editing.set(next);
    this.draft.set(next);
    // The rules that belong with this config. Opening an entity for editing without them
    // showed an empty rules list for a config that had rules, and saving wrote that back.
    const loaded = entity ? demoRulesFor(entity) : [];
    this.rules.set(loaded);
    this.authoredRules.set(loaded);
    this.message.set(null);
  }

  /** The rules handed to the builder when an entity is opened. */
  readonly rules = signal<FormRule[]>([]);
  /** The rules as the user has edited them — what Save persists. Bound in the template. */
  readonly authoredRules = signal<FormRule[]>([]);

  onSave(config: EntityFormConfig): void {
    try {
      // Create when new, update when the entity already has a saved version.
      if (this.store.getConfig(config.entity)) {
        this.store.updateConfig(config.entity, config);
      } else {
        this.store.saveConfig(config);
      }
      // Rules live beside the config, so saving the config alone would drop every rule the
      // user just authored — which is what happened before the builder had a `rulesChange`
      // output at all, when there was no supported way to get them out of it.
      saveDemoRules(config.entity, this.authoredRules());
      this.isError.set(false);
      this.message.set(`Saved "${config.entity}" ✓`);
      this.savedEntities.set(
        this.store
          .listConfigs()
          .map(c => String(c['entity']))
          .sort(),
      );
      this.entitySaved.emit(config.entity);
    } catch (err: any) {
      this.isError.set(true);
      this.message.set(err?.message || `Failed to save "${config.entity}"`);
    }
  }
}
