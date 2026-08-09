import { Injectable, inject } from '@angular/core';
import type {
  EntityReferenceLoader,
  NestedFieldConfig,
  RawReferenceItem,
  ReferenceLoaderContext,
  ReferenceLoaderResult,
  ReferenceOption,
  Subscribable,
} from '@dynamic-entity/core';
import { applyCascadeFilter, normalizeReferenceOptions } from '@dynamic-entity/core';
import { EntityRefRegistryService } from './entity-ref-registry.service';

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
    const loader = this.registry.resolve(this.entityKeyFor(field));
    if (!loader) return [];

    // A cascade child with no parent selection must offer nothing.
    const hasParentValue =
      ctx.parentValue !== null && ctx.parentValue !== undefined && ctx.parentValue !== '';
    if (cfg?.parentField && !hasParentValue) return [];

    const lang = ctx.lang ?? 'en';
    const raw = await this.invoke(loader, {
      ...ctx,
      filters: { ...(cfg?.filters ?? {}), ...(ctx.filters ?? {}) },
      lang,
    });

    const options = normalizeReferenceOptions(raw as RawReferenceItem[], cfg, lang);
    return applyCascadeFilter(options, ctx.parentValue, cfg, lang);
  }

  /** Coerce array | Promise | Subscribable into a Promise. */
  private invoke(
    loader: EntityReferenceLoader,
    ctx: ReferenceLoaderContext,
  ): Promise<ReferenceOption[]> {
    let result: ReferenceLoaderResult;
    try {
      result = loader(ctx);
    } catch {
      return Promise.resolve([]);
    }
    return this.toPromise(result);
  }

  private toPromise(result: ReferenceLoaderResult): Promise<ReferenceOption[]> {
    if (Array.isArray(result)) return Promise.resolve(result);
    if (this.isSubscribable(result)) {
      // First emission wins (take(1) semantics) so an Observable that stays open — a
      // BehaviorSubject-backed cache, say — still resolves the load.
      return new Promise<ReferenceOption[]>(resolve => {
        let settled = false;
        const settle = (value: ReferenceOption[]) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        result.subscribe({
          next: value => settle(value ?? []),
          error: () => settle([]),
          complete: () => settle([]),
        });
      });
    }
    return Promise.resolve(result as Promise<ReferenceOption[]>).catch(() => []);
  }

  private isSubscribable(value: unknown): value is Subscribable<ReferenceOption[]> {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Subscribable<ReferenceOption[]>).subscribe === 'function'
    );
  }
}
