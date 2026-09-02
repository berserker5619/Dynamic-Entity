import { EnvironmentProviders, makeEnvironmentProviders, Type } from '@angular/core';
import type { EntityReferenceLoader, LookupListSource, RecordMigration } from '@dynamic-entity/core';
import {
  ENTITY_REF_REGISTRY,
  FIELD_TYPE_REGISTRY,
  HOOK_REGISTRY,
  type HookFn,
  ASYNC_VALIDATOR_REGISTRY,
  RECORD_MIGRATIONS,
  VALIDATION_MESSAGES,
  LOOKUP_REGISTRY,
  MASKED_ROLES,
  UI_TEXT,
  VALIDATOR_REGISTRY,
} from '../tokens/injection-tokens';
import type { UiTextOverrides } from '../services/ui-text.service';

export interface NgxDynamicEntityConfig {
  /** Roles that see masked field values as XXXXXXXXX */
  maskedRoles?: string[];
  /** Custom field type components keyed by type string */
  fieldTypes?: Record<string, Type<any>>;
  /**
   * Entity-ref option loaders keyed by entity key.
   * Each receives `{ parentValue, filters, lang }` and may return an array, Promise, or Observable.
   */
  entityRefs?: Record<string, EntityReferenceLoader>;
  /**
   * Named master lists keyed by list name, for fields that set `listName`.
   * Each may be the values themselves (array/Promise/Observable) or a loader function — prefer
   * a loader for anything fetched, so an unused list is never loaded.
   */
  lookups?: Record<string, LookupListSource>;
  /**
   * Override the messages shown under invalid fields, keyed by Angular error key. A value is
   * a string, or a function receiving `(language, error)` when it needs the error's detail.
   * Unlisted keys keep their English default.
   */
  validationMessages?: Record<string, string | ((language: string, error: any) => string)>;
  /**
   * Override the library's own chrome — Save, Reset, "No rows yet.". Either a partial map
   * keyed by `UiTextKey`, whose values are strings or the same `LocalizedText` a field label
   * uses (`{ en, de }`, resolved against the form's `language`), or a resolver
   * `(key, defaultText, language) => string` that hands the key to an existing i18n layer.
   * `DEFAULT_UI_TEXT` lists every key with its English source string; unlisted keys keep it.
   */
  uiText?: UiTextOverrides;
  /**
   * Async validator functions keyed by name, for checks that need a server — uniqueness,
   * availability, a remote rule. Name them from a schema with
   * `validators: { customAsync: ['uniqueEmail'] }`.
   *
   * Each is an Angular `AsyncValidatorFn`: it receives the control and returns a Promise or
   * Observable of `ValidationErrors | null`. The control is `pending` while it runs, and the
   * form cannot be submitted until every pending check settles.
   */
  asyncValidators?: Record<string, any>;
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
    {
      provide: ASYNC_VALIDATOR_REGISTRY,
      useValue: new Map(Object.entries(config.asyncValidators ?? {})),
    },
    { provide: HOOK_REGISTRY, useValue: new Map(Object.entries(config.hooks ?? {})) },
    { provide: RECORD_MIGRATIONS, useValue: config.migrations ?? [] },
    { provide: VALIDATION_MESSAGES, useValue: config.validationMessages ?? {} },
    { provide: UI_TEXT, useValue: config.uiText ?? {} },
  ]);
