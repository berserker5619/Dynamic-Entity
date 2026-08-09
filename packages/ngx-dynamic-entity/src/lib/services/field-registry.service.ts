import { Injectable, Type, inject } from '@angular/core';
import { FIELD_TYPE_REGISTRY, FIELD_TYPE_SETS } from '../tokens/injection-tokens';

/**
 * FieldRegistryService — resolves field type strings to Angular component classes.
 *
 * **Tree-shaking contract:** this service holds *no* static imports of field components.
 * Nothing is bundled until something registers it, which is what makes the built-ins
 * opt-in. Register them with `provideBuiltInFieldTypes()` (all 19 keys) or a narrower
 * subset via `provideFieldTypes({ ... })` — see `providers/provide-field-types.ts`.
 *
 * Resolution order: consumer token registry → runtime registrations → nothing.
 */
@Injectable({ providedIn: 'root' })
export class FieldRegistryService {
  private readonly consumerRegistry =
    inject(FIELD_TYPE_REGISTRY, { optional: true }) ?? new Map<string, Type<any>>();
  private readonly dynamicRegistry = new Map<string, Type<any>>();

  constructor() {
    // Sets contributed by provideFieldTypes()/provideBuiltInFieldTypes(), in declaration order.
    for (const set of inject(FIELD_TYPE_SETS, { optional: true }) ?? []) {
      this.registerAll(set);
    }
  }

  /** Register a field type component mapping at runtime. */
  register(type: string, component: Type<any>): void {
    this.dynamicRegistry.set(type, component);
  }

  /** Register multiple field type component mappings at runtime. */
  registerAll(map: Record<string, Type<any>>): void {
    for (const [type, comp] of Object.entries(map)) {
      this.dynamicRegistry.set(type, comp);
    }
  }

  /**
   * Resolve a field type string to a component class.
   * Consumer token registry takes priority over runtime registrations.
   */
  resolve(fieldType: string): Type<any> | null {
    return this.consumerRegistry.get(fieldType) ?? this.dynamicRegistry.get(fieldType) ?? null;
  }

  /** Check if a field type has a registered component. */
  has(fieldType: string): boolean {
    return this.consumerRegistry.has(fieldType) || this.dynamicRegistry.has(fieldType);
  }

  /** Every registered field type key. Consumer overrides and runtime registrations combined. */
  registeredTypes(): string[] {
    return [...new Set([...this.dynamicRegistry.keys(), ...this.consumerRegistry.keys()])].sort();
  }
}
