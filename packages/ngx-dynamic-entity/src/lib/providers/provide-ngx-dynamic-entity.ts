import { EnvironmentProviders, makeEnvironmentProviders, Type } from '@angular/core';
import type { EntityReferenceLoader, LookupListSource, RecordMigration } from '@dynamic-entity/core';
import {
  ENTITY_REF_REGISTRY,
  FIELD_TYPE_REGISTRY,
  HOOK_REGISTRY,
  type HookFn,
  RECORD_MIGRATIONS,
  LOOKUP_REGISTRY,
  MASKED_ROLES,
  VALIDATOR_REGISTRY,
} from '../tokens/injection-tokens';

export interface NgxDynamicEntityConfig {
  /** Roles that see masked field values as XXXXXXXXX */
  maskedRoles?: string[];
  /** Custom field type components keyed by type string */
  fieldTypes?: Record<string, Type<any>>;
  /**
   * Entity-ref option loaders keyed by entity key (ADR-006).
   * Each receives `{ parentValue, filters, lang }` and may return an array, Promise, or Observable.
   */
  entityRefs?: Record<string, EntityReferenceLoader>;
  /**
   * Named master lists keyed by list name, for fields that set `listName`.
   * Each may be the values themselves (array/Promise/Observable) or a loader function — prefer
   * a loader for anything fetched, so an unused list is never loaded.
   */
  lookups?: Record<string, LookupListSource>;
  /** Custom validator functions keyed by validator name */
  validators?: Record<string, any>;
  /** Hook functions keyed by hook name */
  hooks?: Record<string, HookFn>;
  /**
   * Ordered steps that upgrade a saved record when `EntityFormConfig.version` moves ahead
   * of the record's `_configVersion`. Applied to `initialData` before the form is patched.
   */
  migrations?: RecordMigration[];
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
    { provide: LOOKUP_REGISTRY, useValue: new Map(Object.entries(config.lookups ?? {})) },
    { provide: VALIDATOR_REGISTRY, useValue: new Map(Object.entries(config.validators ?? {})) },
    { provide: HOOK_REGISTRY, useValue: new Map(Object.entries(config.hooks ?? {})) },
    { provide: RECORD_MIGRATIONS, useValue: config.migrations ?? [] },
  ]);
