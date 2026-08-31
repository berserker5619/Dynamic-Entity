import { InjectionToken } from '@angular/core';
import type { Type } from '@angular/core';
import type {
  CommonModuleEntry,
  EntityReferenceLoader,
  FileUploadHandler,
  LookupListSource,
  RecordMigration,
} from '@dynamic-entity/core';
import { InMemoryEntityRefCacheStore, type EntityRefCacheStore } from '../services/entity-ref-cache';

/** Roles that see XXXXXXXXX for masked fields. Presentational only — enforce authz server-side. */
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

/**
 * Ordered steps that move a saved record forward when a config's `version` increases.
 *
 * Without these, `EntityFormConfig.version` and `VersionedRecord._configVersion` are
 * declarations nothing acts on: a schema can be edited freely while records keep their old
 * shape, and nothing reconciles the two. Registering migrations makes the version numbers
 * mean something.
 *
 * @example
 * provideNgxDynamicEntity({
 *   migrations: [
 *     { from: 1, to: 2, description: 'split name', migrate: r => ({ ...r, firstName: r['name'] }) },
 *   ],
 * })
 */
export const RECORD_MIGRATIONS = new InjectionToken<RecordMigration[]>('RECORD_MIGRATIONS');

/**
 * Overrides for the messages shown under an invalid field, keyed by Angular error key
 * (`required`, `minlength`, `pattern`, …) plus a few field-specific keys.
 *
 * The built-in messages are English literals. Registering here is what makes a non-English
 * form possible without re-implementing every field component; unlisted keys keep their
 * default, so overriding one does not mean supplying them all.
 */
export const VALIDATION_MESSAGES = new InjectionToken<Record<string, any>>('VALIDATION_MESSAGES');

/** Registry: validator key → ValidatorFn */
export const VALIDATOR_REGISTRY = new InjectionToken<Map<string, any>>('VALIDATOR_REGISTRY');

/**
 * Registry: validator key → AsyncValidatorFn.
 *
 * Kept separate from VALIDATOR_REGISTRY because Angular applies the two differently: an async
 * validator runs only once the synchronous ones pass, and puts the control into `pending`
 * while it does. Name them from a schema with `validators: { customAsync: ['uniqueEmail'] }`.
 */
export const ASYNC_VALIDATOR_REGISTRY = new InjectionToken<Map<string, any>>(
  'ASYNC_VALIDATOR_REGISTRY',
);

/**
 * A registered hook: receives the payload, returns it (or a replacement), sync or async.
 *
 * Spelled out rather than typed as `Function`, which accepts class declarations and any
 * arity and gives a consumer no signature to write against.
 */
export type HookFn = (data: any, context?: unknown) => unknown | Promise<unknown>;

/** Registry: hook key → async (data, context) => data */
export const HOOK_REGISTRY = new InjectionToken<Map<string, HookFn>>('HOOK_REGISTRY');

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



/**
 * Turns the markdown a `markdown` field stores into HTML for display.
 *
 * Optional, and deliberately not bundled: these packages declare no runtime dependencies
 * beyond `tslib`, and a markdown parser is a large one to force on every consumer. Without
 * a renderer the field still works — it stores and shows the source text, with line breaks
 * preserved and nothing interpreted.
 *
 * The returned HTML is bound through `[innerHTML]`, so Angular's sanitizer strips scripts
 * and event handlers before it reaches the DOM. That is a backstop, not a licence: a
 * renderer should still be configured to escape raw HTML in its input, because sanitizing
 * removes the dangerous parts silently rather than telling the author their content was
 * altered.
 *
 * @example
 * import { marked } from 'marked';
 * { provide: MARKDOWN_RENDERER, useValue: (src: string) => marked.parse(src) as string }
 */
export const MARKDOWN_RENDERER = new InjectionToken<(source: string) => string>(
  'MARKDOWN_RENDERER',
);
