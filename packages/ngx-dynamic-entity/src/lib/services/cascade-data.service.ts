import { Injectable, inject } from '@angular/core';
import type {
  EntityFormConfig,
  NestedFieldConfig,
  NestedTabConfig,
  ReferenceLoaderContext,
  ReferenceOption,
} from '@dynamic-entity/core';
import { applyCascadeFilter } from '@dynamic-entity/core';
import { EntityRefRegistryService } from './entity-ref-registry.service';
import { EntityReferenceService } from './entity-reference.service';

/**
 * CascadeDataService — loads entity-reference options and applies parent→child cascades.
 *
 * Loaders come from the registry only (ADR-006). This service owns the three things a
 * field component should not: resolving the loader, coercing whatever it returned
 * (array | Promise | Observable) into a Promise, and filtering by the parent's value.
 */
@Injectable({ providedIn: 'root' })
export class CascadeDataService {
  private readonly registry = inject(EntityRefRegistryService);
  private readonly references = inject(EntityReferenceService);

  /** Preload runs by formConfigId, so a second call joins the first rather than re-fetching. */
  private readonly preloads = new Map<string, Promise<void>>();

  /** Registry key for a field: explicit `linkedEntityKey`, else the field id. */
  entityKeyFor(field: NestedFieldConfig): string {
    return field.entityReference?.linkedEntityKey ?? field.id;
  }

  /** Whether a loader is registered for this field. */
  canLoad(field: NestedFieldConfig): boolean {
    return this.registry.has(this.entityKeyFor(field));
  }

  /**
   * Load the options for a field, cascade-filtered against `parentValue`.
   * Returns `[]` when no loader is registered, or when a cascade child has no parent value yet.
   */
  async load(
    field: NestedFieldConfig,
    ctx: ReferenceLoaderContext = {},
  ): Promise<ReferenceOption[]> {
    const cfg = field.entityReference;
    if (!this.canLoad(field)) return [];

    // A cascade child with no parent selection must offer nothing.
    const hasParentValue =
      ctx.parentValue !== null && ctx.parentValue !== undefined && ctx.parentValue !== '';
    if (cfg?.parentField && !hasParentValue) return [];

    const lang = ctx.lang ?? 'en';

    // When the cascade can be resolved locally (`lookupFilter`/`lookupPath`), fetch the
    // unfiltered set once and filter per parent below — switching parent then costs nothing.
    // Otherwise the loader is the only thing that can narrow the list, so `parentValue` is
    // passed through and becomes part of the cache identity (one entry per parent).
    const filtersLocally = !!(cfg?.lookupFilter || cfg?.lookupPath);

    const options = await this.references.load(this.entityKeyFor(field), {
      ...ctx,
      parentValue: filtersLocally ? undefined : ctx.parentValue,
      filters: { ...(cfg?.filters ?? {}), ...(ctx.filters ?? {}) },
      displayFields: cfg?.displayFields,
      lang,
    });

    return applyCascadeFilter(options, ctx.parentValue, cfg, lang);
  }

  // ─── Preload ────────────────────────────────────────────────────────────────

  /**
   * Warm the cache for every entity a config's cascades depend on, so changing a parent
   * resolves from memory instead of a round-trip.
   *
   * Idempotent per `formConfigId`: calling it again returns the in-flight or completed run
   * rather than re-fetching.
   */
  initializeCascadeData(formConfigId: string, config: EntityFormConfig, lang = 'en'): Promise<void> {
    const existing = this.preloads.get(formConfigId);
    if (existing) return existing;

    const fields = this.cascadeFields(config);
    const run = Promise.all(
      fields.map(field =>
        this.references.load(this.entityKeyFor(field), {
          filters: field.entityReference?.filters,
          displayFields: field.entityReference?.displayFields,
          lang,
        }),
      ),
    ).then(() => undefined);

    this.preloads.set(formConfigId, run);
    return run;
  }

  /** Resolves true once `initializeCascadeData` for this config has finished. */
  async waitForData(formConfigId: string): Promise<boolean> {
    const run = this.preloads.get(formConfigId);
    if (!run) return false;
    await run;
    return true;
  }

  /**
   * Child options for a parent selection, from cache only — no load is triggered.
   * Returns `[]` when the entity has not been preloaded.
   */
  getCachedChildOptions(
    field: NestedFieldConfig,
    parentValue: unknown,
    lang = 'en',
  ): ReferenceOption[] {
    const cfg = field.entityReference;
    const cached = this.references.peek(this.entityKeyFor(field), {
      filters: cfg?.filters,
      displayFields: cfg?.displayFields,
      lang,
    });
    if (!cached) return [];
    return applyCascadeFilter(cached, parentValue, cfg, lang);
  }

  /** Forget the preload for one config. The option cache itself is untouched. */
  clearCache(formConfigId: string): void {
    this.preloads.delete(formConfigId);
  }

  /** Every entity-ref field in the config that participates in a cascade. */
  private cascadeFields(config: EntityFormConfig): NestedFieldConfig[] {
    const found: NestedFieldConfig[] = [];
    const walkFields = (fields: NestedFieldConfig[] | undefined) => {
      for (const field of fields ?? []) {
        const cfg = field.entityReference;
        if (cfg?.enabled && (cfg.parentField || cfg.lookupPath || cfg.lookupFilter)) {
          found.push(field);
        }
        walkFields(field.children);
      }
    };
    const walkTabs = (tabs: NestedTabConfig[] | undefined) => {
      for (const tab of tabs ?? []) {
        walkFields(tab.fields);
        walkTabs(tab.children);
      }
    };
    walkTabs(config?.tabs);
    return found;
  }
}
