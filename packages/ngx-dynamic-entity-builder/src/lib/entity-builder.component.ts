import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  effect,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  COMMON_MODULES,
  type CommonModuleEntry,
  type EntityFormConfig,
  type EntityPermissions,
  resolveLabel,
} from '@dynamic-entity/core';
import { ConfigSourceService } from 'ngx-dynamic-entity';
import { BuilderStore } from './builder-store.service';
import { FieldInspectorComponent } from './components/field-inspector.component';
import { FieldPaletteComponent } from './components/field-palette.component';
import { TabManagerComponent } from './components/tab-manager.component';
import { EntityBuilderCanvasComponent } from './components/entity-builder-canvas.component';
import { getFieldTypeMeta } from './field-catalog';

/** RBAC actions surfaced in the settings panel. */
const RBAC_ACTIONS: (keyof EntityPermissions)[] = ['view', 'edit', 'delete'];

/** Shared stable empty array — never allocate a fresh [] per change-detection (mat-select loops). */
const EMPTY_ROLES: readonly string[] = Object.freeze([]);

/**
 * EntityBuilderComponent — the top-level visual builder for an EntityFormConfig.
 */
@Component({
  selector: 'ngx-entity-builder',
  standalone: true,
  providers: [BuilderStore],
  imports: [
    FormsModule,
    DragDropModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatToolbarModule,
    MatTooltipModule,
    FieldPaletteComponent,
    TabManagerComponent,
    FieldInspectorComponent,
    EntityBuilderCanvasComponent,
  ],
  templateUrl: './entity-builder.component.html',
  styleUrl: './entity-builder.component.css',
})
export class EntityBuilderComponent implements OnChanges {
  protected readonly store = inject(BuilderStore);
  /**
   * Optional: only apps that registered a CONFIG_SOURCE have one. Used to drop the cached
   * copy of a config the moment it is edited — see `doSave`.
   */
  private readonly configSource = inject(ConfigSourceService, { optional: true });

  /** Existing config to edit. When omitted, the builder starts blank. */
  @Input() config?: EntityFormConfig;
  /** Languages available for label/placeholder editing. First entry is the default. */
  @Input() languages: string[] = ['en'];
  /** Optional role list — enables multi-select role pickers for RBAC instead of free text. */
  @Input() availableRoles: string[] = [];
  /**
   * Roles of the person using the builder. Distinct from `availableRoles`, which is the
   * vocabulary a schema may reference. Passed to the `SYSTEM_DEFAULT_CAN_EDIT` predicate so
   * it can decide whether this user may edit system-default tabs.
   */
  @Input() userRoles: string[] = [];
  /** Optional common-module definitions for module tabs; defaults to the built-in list from core. */
  @Input() commonModules: readonly CommonModuleEntry[] = COMMON_MODULES;

  /** Emitted on every change to the working config. */
  @Output() configChange = new EventEmitter<EntityFormConfig>();
  /** Emitted when the user clicks Save. Carries a clean, deep-cloned config. */
  @Output() save = new EventEmitter<EntityFormConfig>();

  protected readonly rbacActions = RBAC_ACTIONS;

  constructor() {
    effect(() => this.configChange.emit(this.store.config()), { allowSignalWrites: true });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] && changes['config'].currentValue !== changes['config'].previousValue) {
      if (this.config) this.store.load(this.config);
      else if (changes['config'].isFirstChange()) this.store.reset();
    }
    if (changes['languages'] && this.languages.length) {
      const active = this.store.activeLanguage();
      if (!this.languages.includes(active)) this.store.setActiveLanguage(this.languages[0]);
    }
    if (changes['userRoles']) {
      this.store.setUserRoles(this.userRoles);
    }
  }

  // ─── Field canvas ─────────────────────────────────────────────────────────

  protected onDrop(event: CdkDragDrop<unknown>): void {
    this.store.reorderField(event.previousIndex, event.currentIndex);
  }

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

  // ─── Toolbar actions ──────────────────────────────────────────────────────

  protected doSave(): void {
    const config = this.store.exportConfig();

    // Saving is the moment this entity's config changes, so anything holding a cached copy is
    // now stale — most visibly a referenced field elsewhere resolving against the old schema.
    // ConfigSourceService caches per entity and exposed clearCache from the start, but nothing
    // ever called it, so a cache entry lived for the lifetime of the page.
    this.configSource?.clearCache(config.entity);

    this.save.emit(config);
  }

  protected get json(): string {
    return JSON.stringify(this.store.exportConfig(), null, 2);
  }

  protected copyJson(): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(this.json);
    }
  }

  // ─── RBAC settings ────────────────────────────────────────────────────────

  protected rolesFor(action: keyof EntityPermissions): readonly string[] {
    // Return the stored array (stable ref between mutations) or a shared empty — NOT a fresh [],
    // which would make the bound mat-select re-evaluate every CD and loop forever.
    return this.store.config().permissions?.[action] ?? EMPTY_ROLES;
  }

  protected setRoles(action: keyof EntityPermissions, roles: string[]): void {
    this.store.setPermission(action, roles);
  }

  /** Parse a comma-separated role string into a trimmed, de-duplicated array. */
  protected setRolesFromText(action: keyof EntityPermissions, text: string): void {
    const roles = Array.from(
      new Set(
        text
          .split(',')
          .map(r => r.trim())
          .filter(Boolean),
      ),
    );
    this.store.setPermission(action, roles);
  }
}
