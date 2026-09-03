import type { EntityRefCacheStore, ReferenceOption } from 'ngx-dynamic-entity';

/** One namespace, so `clear()` cannot reach anything else the demo keeps in sessionStorage. */
const PREFIX = 'de_demo_refcache_';

/**
 * `ENTITY_REF_CACHE_STORE`, backed by sessionStorage instead of a Map.
 *
 * The default store lives as long as the injector that created it, so every entity-reference
 * label is fetched again after a browser refresh. That is the right default for a library —
 * silently persisting a tenant's data is not a decision a library gets to make — which is
 * exactly why the store is a token: persistence is the *host's* call.
 *
 * sessionStorage rather than localStorage because a cache should not outlive the tab. Every
 * access is guarded: a browser can refuse storage entirely (private mode, quota, a policy),
 * and a cache that throws is worse than a cache that misses.
 */
export class SessionEntityRefCacheStore implements EntityRefCacheStore {
  get(key: string): ReferenceOption[] | undefined {
    const raw = this.read(PREFIX + key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as ReferenceOption[];
    } catch {
      // A malformed entry is a cache miss, not a crash — the loader will refill it.
      this.delete(key);
      return undefined;
    }
  }

  set(key: string, value: ReferenceOption[]): void {
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Full or unavailable. Losing a cache entry costs a re-fetch and nothing else.
    }
  }

  delete(key: string): void {
    try {
      sessionStorage.removeItem(PREFIX + key);
    } catch {
      /* unavailable */
    }
  }

  keys(): string[] {
    return this.namespacedKeys().map(key => key.slice(PREFIX.length));
  }

  clear(): void {
    for (const key of this.namespacedKeys()) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* unavailable */
      }
    }
  }

  private read(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private namespacedKeys(): string[] {
    const out: string[] = [];
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(PREFIX)) out.push(key);
      }
    } catch {
      /* unavailable */
    }
    return out;
  }
}
