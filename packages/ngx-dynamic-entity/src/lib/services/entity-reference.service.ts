import { Injectable, inject } from '@angular/core';
import type {
  EntityReferenceLoader,
  RawReferenceItem,
  ReferenceLoaderContext,
  ReferenceLoaderResult,
  ReferenceOption,
  Subscribable,
} from '@dynamic-entity/core';
import {
  buildReferenceCacheKey,
  entityKeyFromCacheKey,
  normalizeReferenceOptions,
  resolveLabel,
  valuesMatch,
} from '@dynamic-entity/core';
import { ENTITY_REF_CACHE_STORE } from '../tokens/injection-tokens';
import { EntityRefRegistryService } from './entity-ref-registry.service';

/** Label-cache field separator. Kept out of template literals so it stays visible in source. */
const LABEL_SEP = '|';

/**
 * EntityReferenceService — the cache in front of consumer-registered option loaders.
 *
 * Three layers, matching the reference implementation:
 *  1. **options** — resolved `ReferenceOption[]` per (entity, lang, displayFields, filters).
 *  2. **in-flight** — the pending Promise, so N fields referencing one entity trigger one
 *     load rather than N. This is the layer that actually removes duplicate HTTP calls;
 *     an options cache alone does nothing for concurrent first loads.
 *  3. **labels** — synchronous value → text, for rendering a stored reference without
 *     waiting on a load.
 *
 * Invalidation is per entity, not global. The reference could only `clearCache()` everything
 * (issue #16), so saving one record re-fetched every entity's options.
 */
@Injectable({ providedIn: 'root' })
export class EntityReferenceService {
  private readonly registry = inject(EntityRefRegistryService);
  private readonly store = inject(ENTITY_REF_CACHE_STORE);

  /** Loads in progress, keyed the same way as the options cache. */
  private readonly inFlight = new Map<string, Promise<ReferenceOption[]>>();
  /** `entityKey|lang|canonicalValue` -> display text. */
  private readonly labels = new Map<string, string>();

  /**
   * Options for an entity, from cache when present.
   * Concurrent callers with the same key share one load.
   */
  async load(entityKey: string, ctx: ReferenceLoaderContext = {}): Promise<ReferenceOption[]> {
    const key = buildReferenceCacheKey(entityKey, {
      lang: ctx.lang,
      filters: ctx.filters,
      displayFields: ctx.displayFields,
      parentValue: ctx.parentValue,
    });

    const cached = this.store.get(key);
    if (cached) return cached;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const loader = this.registry.resolve(entityKey);
    if (!loader) return [];

    const load = this.invoke(loader, ctx)
      .then(raw => {
        // displayFields drive label building, which is why they are part of the cache key.
        const options = normalizeReferenceOptions(
          raw as RawReferenceItem[],
          ctx.displayFields ? { enabled: true, displayFields: ctx.displayFields } : undefined,
          ctx.lang ?? 'en',
        );
        this.store.set(key, options);
        this.rememberLabels(entityKey, ctx.lang ?? 'en', options);
        return options;
      });

    // A failed load resolves to [] for the caller but is never written to the store, so a
    // transient error is retried on the next call instead of poisoning the cache. Only the
    // `.then` above caches, and a rejection skips it.
    const guarded = load
      .catch(() => [] as ReferenceOption[])
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, guarded);
    return guarded;
  }

  /** Cached options without triggering a load. `undefined` when not cached. */
  peek(entityKey: string, ctx: ReferenceLoaderContext = {}): ReferenceOption[] | undefined {
    return this.store.get(
      buildReferenceCacheKey(entityKey, {
        lang: ctx.lang,
        filters: ctx.filters,
        displayFields: ctx.displayFields,
        parentValue: ctx.parentValue,
      }),
    );
  }

  /**
   * Display text for a stored reference value, synchronously.
   * Returns `undefined` when the entity's options have never been loaded.
   */
  labelFor(entityKey: string, value: unknown, lang = 'en'): string | undefined {
    return this.labels.get(this.labelKey(entityKey, lang, value));
  }

  /** Drop everything cached for one entity, leaving other entities intact. */
  invalidate(entityKey: string): void {
    for (const key of this.store.keys()) {
      if (entityKeyFromCacheKey(key) === entityKey) this.store.delete(key);
    }
    for (const key of [...this.inFlight.keys()]) {
      if (entityKeyFromCacheKey(key) === entityKey) this.inFlight.delete(key);
    }
    const prefix = `${entityKey}${LABEL_SEP}`;
    for (const key of [...this.labels.keys()]) {
      if (key.startsWith(prefix)) this.labels.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
    this.labels.clear();
  }

  private rememberLabels(entityKey: string, lang: string, options: ReferenceOption[]): void {
    for (const option of options) {
      this.labels.set(this.labelKey(entityKey, lang, option.value), option.label);
    }
  }

  /** Label-cache key. An object value collapses to its resolved text for the active language. */
  private labelKey(entityKey: string, lang: string, value: unknown): string {
    const canonical =
      value !== null && typeof value === 'object'
        ? resolveLabel(value as Record<string, string>, lang)
        : String(value ?? '');
    return [entityKey, lang, canonical].join(LABEL_SEP);
  }

  // ─── Loader result coercion (array | Promise | Observable) ──────────────────

  private invoke(
    loader: EntityReferenceLoader,
    ctx: ReferenceLoaderContext,
  ): Promise<ReferenceOption[]> {
    let result: ReferenceLoaderResult;
    try {
      result = loader(ctx);
    } catch (err) {
      // Reject rather than resolve empty: `load` must be able to tell failure from
      // "no matches", or it would cache the failure.
      return Promise.reject(err);
    }
    return this.toPromise(result);
  }

  private toPromise(result: ReferenceLoaderResult): Promise<ReferenceOption[]> {
    if (Array.isArray(result)) return Promise.resolve(result);
    if (this.isSubscribable(result)) {
      // First emission wins, so an Observable that stays open still resolves the load.
      return new Promise<ReferenceOption[]>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };
        result.subscribe({
          next: value => settle(() => resolve(value ?? [])),
          // An erroring stream is a failed load, not an empty one — see `invoke`.
          error: err => settle(() => reject(err)),
          // Completing without emitting is a legitimate empty result, and is cached.
          complete: () => settle(() => resolve([])),
        });
      });
    }
    return Promise.resolve(result as Promise<ReferenceOption[]>);
  }

  private isSubscribable(value: unknown): value is Subscribable<ReferenceOption[]> {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Subscribable<ReferenceOption[]>).subscribe === 'function'
    );
  }

  /** Exposed for cascade filtering, which matches a parent value against option values. */
  matches(a: unknown, b: unknown, lang = 'en'): boolean {
    return valuesMatch(a, b, lang);
  }
}
