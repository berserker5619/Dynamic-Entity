import { Injectable, inject } from '@angular/core';
import type { EntityReferenceLoader } from '@dynamic-entity/core';
import { ENTITY_REF_REGISTRY } from '../tokens/injection-tokens';

/**
 * EntityRefRegistryService — resolves entity-ref option loader functions.
 * Entity-ref options come ONLY from this registry.
 * Never pass loaders via @Input() on field components.
 *
 * Consumers register loaders via provideNgxDynamicEntity({ entityRefs: { clients: () => [...] } }).
 * EntityRefFieldComponent injects this service and calls resolve(field.component ?? field.id).
 */
@Injectable({ providedIn: 'root' })
export class EntityRefRegistryService {
  private readonly registry =
    inject(ENTITY_REF_REGISTRY, { optional: true }) ?? new Map<string, EntityReferenceLoader>();

  /**
   * Get the option loader for an entity key.
   * @returns The loader, or null if none is registered.
   */
  resolve(entityKey: string): EntityReferenceLoader | null {
    return this.registry.get(entityKey) ?? null;
  }

  has(entityKey: string): boolean {
    return this.registry.has(entityKey);
  }
}
