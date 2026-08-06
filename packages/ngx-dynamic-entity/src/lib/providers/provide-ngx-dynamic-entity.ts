import { EnvironmentProviders, makeEnvironmentProviders, Type } from '@angular/core';
import {
  ENTITY_REF_REGISTRY,
  FIELD_TYPE_REGISTRY,
  HOOK_REGISTRY,
  MASKED_ROLES,
  VALIDATOR_REGISTRY,
} from '../tokens/injection-tokens';

export interface NgxDynamicEntityConfig {
  /** Roles that see masked field values as XXXXXXXXX */
  maskedRoles?: string[];
  /** Custom field type components keyed by type string */
  fieldTypes?: Record<string, Type<any>>;
  /** Entity-ref option loaders keyed by entity key (ADR-006) */
  entityRefs?: Record<string, () => Promise<any[]>>;
  /** Custom validator functions keyed by validator name */
  validators?: Record<string, any>;
  /** Hook functions keyed by hook name */
  hooks?: Record<string, Function>;
}

/**
 * Provider function for ngx-dynamic-entity.
 * All options are optional — consumers provide only what they use (ISP).
 *
 * Usage in app.config.ts:
 *   provideNgxDynamicEntity({
 *     maskedRoles: ['IT_SUPPORT'],
 *     entityRefs: { clients: () => clientService.getOptions() },
 *   })
 */
export const provideNgxDynamicEntity = (config: NgxDynamicEntityConfig = {}): EnvironmentProviders =>
  makeEnvironmentProviders([
    { provide: MASKED_ROLES, useValue: config.maskedRoles ?? [] },
    { provide: FIELD_TYPE_REGISTRY, useValue: new Map(Object.entries(config.fieldTypes ?? {})) },
    { provide: ENTITY_REF_REGISTRY, useValue: new Map(Object.entries(config.entityRefs ?? {})) },
    { provide: VALIDATOR_REGISTRY, useValue: new Map(Object.entries(config.validators ?? {})) },
    { provide: HOOK_REGISTRY, useValue: new Map(Object.entries(config.hooks ?? {})) },
  ]);
