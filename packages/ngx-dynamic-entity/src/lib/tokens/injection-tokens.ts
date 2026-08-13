import { InjectionToken } from '@angular/core';
import type { Type } from '@angular/core';
import type {
  CommonModuleEntry,
  EntityReferenceLoader,
  FileUploadHandler,
  LookupListSource,
} from '@dynamic-entity/core';
import { InMemoryEntityRefCacheStore, type EntityRefCacheStore } from '../services/entity-ref-cache';

/** Roles that see XXXXXXXXX for masked fields (ADR-003) */
export const MASKED_ROLES = new InjectionToken<string[]>('MASKED_ROLES');

/**
 * Consumer **overrides**: fieldType string → Angular component class.
 * Highest priority — beats anything registered through `provideFieldTypes()`.
 */
export const FIELD_TYPE_REGISTRY = new InjectionToken<Map<string, Type<any>>>('FIELD_TYPE_REGISTRY');

/**
 * Multi-provider of field-type sets, contributed by `provideFieldTypes()` /
 * `provideBuiltInFieldTypes()`. Multi so several calls compose instead of clobbering;
 * later sets win on key collision. This is the seam that keeps unused field components
 * out of the bundle — nothing is imported until a set names it.
 */
export const FIELD_TYPE_SETS = new InjectionToken<Record<string, Type<any>>[]>('FIELD_TYPE_SETS');

/**
 * Registry: entity key → option loader.
 *
 * A loader receives a `ReferenceLoaderContext` (`parentValue`, `filters`, `lang`) and may
 * return an array, a Promise, or an Observable of `ReferenceOption[]`. `ctx` is optional,
 * so a zero-arg loader (`() => svc.list()`) is still a valid registration.
 */
export const ENTITY_REF_REGISTRY = new InjectionToken<Map<string, EntityReferenceLoader>>(
  'ENTITY_REF_REGISTRY',
);

/**
 * Registry: list name → the values of a named master list (`field.listName`).
 *
 * A source may be the values themselves (array / Promise / Observable) or a **loader function**,
 * which is what you want for anything fetched: a bare Promise is created when the provider is
 * built, so every list would load whether or not a form uses it.
 *
 * Values are normalised by `normalizeLookupValues` — bare strings and `LocalizedText` are
 * accepted alongside the full `{ code, name, sortOrder }` shape.
 *
 * @example
 * provideNgxDynamicEntity({
 *   lookups: {
 *     employeeStatus: () => listService.getByName('employeeStatus'),
 *     grades: ['Junior', 'Senior'],
 *   },
 * })
 */
export const LOOKUP_REGISTRY = new InjectionToken<Map<string, LookupListSource>>('LOOKUP_REGISTRY');

/** Registry: validator key → ValidatorFn */
export const VALIDATOR_REGISTRY = new InjectionToken<Map<string, any>>('VALIDATOR_REGISTRY');

/** Registry: hook key → async (data, context) => data */
export const HOOK_REGISTRY = new InjectionToken<Map<string, Function>>('HOOK_REGISTRY');

/**
 * Consumer-registered list of common module tabs (documents, audit, tasks, etc.).
 * The library ships no built-in implementations. Consumers provide their own list
 * so the builder's module-picker and the renderer's tab switcher know what's available.
 *
 * @example
 * providers: [
 *   {
 *     provide: COMMON_MODULES_REGISTRY,
 *     useValue: [
 *       { id: 'documents', label: { en: 'Documents' }, component: 'app-documents-view' },
 *       { id: 'audit',     label: { en: 'Audit Log'  }, component: 'app-audit' },
 *     ] satisfies CommonModuleEntry[]
 *   }
 * ]
 */
export const COMMON_MODULES_REGISTRY = new InjectionToken<CommonModuleEntry[]>(
  'COMMON_MODULES_REGISTRY',
);

/**
 * Consumer-provided file/image upload handler.
 * When supplied, image-field and file-field call it to persist the File and receive a stable
 * URL back. Without it the field stores `{ file, name, size, mimeType }` for the consumer to
 * upload on submit. May return the result directly, as a Promise, or as an Observable.
 *
 * @example
 * { provide: UPLOAD_HANDLER, useFactory: () => (file: File) => myUploadService.upload(file) }
 */
export const UPLOAD_HANDLER = new InjectionToken<FileUploadHandler>('UPLOAD_HANDLER');

/**
 * Backing store for the entity-reference options cache. Defaults to in-memory.
 * Provide your own to make the cache outlive a page refresh.
 *
 * @example
 * { provide: ENTITY_REF_CACHE_STORE, useClass: SessionStorageRefCache }
 */
export const ENTITY_REF_CACHE_STORE = new InjectionToken<EntityRefCacheStore>(
  'ENTITY_REF_CACHE_STORE',
  { providedIn: 'root', factory: () => new InMemoryEntityRefCacheStore() },
);

/**
 * Consumer-provided predicate function to check whether user roles can edit system default tabs or fields.
 * Defaults to allowing edits if not provided.
 */
/**
 * Consumer-provided predicate function to check whether user roles can edit system default tabs or fields.
 * Defaults to allowing edits if not provided.
 */
export const SYSTEM_DEFAULT_CAN_EDIT = new InjectionToken<(roles: string[]) => boolean>(
  'SYSTEM_DEFAULT_CAN_EDIT',
);

export type ConfigSourceHandler = (
  entityKey: string,
) => any;

/**
 * Registry/Resolver for resolving an EntityFormConfig by entity key across entities (Phase 8).
 * Enables cross-entity field referencing (`isReferenced`, `referencedEntityKey`, `referencedFieldId`, `hasDrift`).
 */
export const CONFIG_SOURCE = new InjectionToken<ConfigSourceHandler>('CONFIG_SOURCE');


