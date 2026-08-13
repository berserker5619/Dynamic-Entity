import { Injectable, Inject, Optional } from '@angular/core';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { isObservable, firstValueFrom } from 'rxjs';
import { CONFIG_SOURCE, type ConfigSourceHandler } from '../tokens/injection-tokens';

@Injectable({ providedIn: 'root' })
export class ConfigSourceService {
  private readonly cache = new Map<string, EntityFormConfig>();
  private readonly inFlight = new Map<string, Promise<EntityFormConfig | undefined>>();

  private readonly handler?: ConfigSourceHandler;

  constructor(@Optional() @Inject(CONFIG_SOURCE) handler?: any) {
    this.handler = handler;
  }

  /** Retrieve an entity config by key, with caching and in-flight deduplication. */
  async getConfig(entityKey: string): Promise<EntityFormConfig | undefined> {
    if (!entityKey || !this.handler) return undefined;
    if (this.cache.has(entityKey)) return this.cache.get(entityKey);
    if (this.inFlight.has(entityKey)) return this.inFlight.get(entityKey);

    const promise = (async () => {
      try {
        const raw = this.handler!(entityKey);
        let resolved: EntityFormConfig | undefined;

        if (isObservable(raw)) {
          resolved = await firstValueFrom(raw as any);
        } else {
          resolved = await Promise.resolve(raw as any);
        }

        if (resolved) {
          this.cache.set(entityKey, resolved);
        }
        return resolved;
      } catch (err) {
        console.warn(`ConfigSourceService failed to load config for entity "${entityKey}"`, err);
        return undefined;
      } finally {
        this.inFlight.delete(entityKey);
      }
    })();

    this.inFlight.set(entityKey, promise);
    return promise;
  }

  /** Clear cached configs (e.g. after a config edit in the builder). */
  clearCache(entityKey?: string): void {
    if (entityKey) {
      this.cache.delete(entityKey);
    } else {
      this.cache.clear();
    }
  }
}
