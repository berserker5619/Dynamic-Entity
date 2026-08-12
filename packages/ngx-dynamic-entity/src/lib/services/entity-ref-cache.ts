import type { ReferenceOption } from '@dynamic-entity/core';

/**
 * Backing store for cached reference options.
 *
 * Pluggable on purpose. The reference implementation kept its cache in a service instance,
 * so every entity label was re-fetched on a browser refresh (issue #22 in the architecture
 * doc). A consumer that wants the cache to survive a reload can back this with
 * sessionStorage; the default keeps it in memory, which is the right call for a library
 * that must not silently persist a tenant's data.
 */
export interface EntityRefCacheStore {
  get(key: string): ReferenceOption[] | undefined;
  set(key: string, value: ReferenceOption[]): void;
  delete(key: string): void;
  /** Every key currently held — used for prefix invalidation of one entity. */
  keys(): string[];
  clear(): void;
}

/** Default in-memory store. Lives as long as the injector that created it. */
export class InMemoryEntityRefCacheStore implements EntityRefCacheStore {
  private readonly map = new Map<string, ReferenceOption[]>();

  get(key: string): ReferenceOption[] | undefined {
    return this.map.get(key);
  }

  set(key: string, value: ReferenceOption[]): void {
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  clear(): void {
    this.map.clear();
  }
}
