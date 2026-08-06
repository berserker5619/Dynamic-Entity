import { InjectionToken } from '@angular/core';
import type { Type } from '@angular/core';
import type { Observable } from 'rxjs';
import type { CommonModuleEntry } from '@dynamic-entity/core';

/** Roles that see XXXXXXXXX for masked fields (ADR-003) */
export const MASKED_ROLES = new InjectionToken<string[]>('MASKED_ROLES');

/** Migration strategy for the frontend — 'strict' | 'graceful' only (ADR-005, never 'auto') */
export const MIGRATION_STRATEGY = new InjectionToken<'strict' | 'graceful'>('MIGRATION_STRATEGY');

/** Registry: fieldType string → Angular component class */
export const FIELD_TYPE_REGISTRY = new InjectionToken<Map<string, Type<any>>>('FIELD_TYPE_REGISTRY');

/** Registry: entity key → async () => options[] loader function */
export const ENTITY_REF_REGISTRY = new InjectionToken<Map<string, () => Promise<any[]>>>(
  'ENTITY_REF_REGISTRY',
);

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
 * When supplied, image-field and file-field components call this to persist
 * the File and receive a stable URL back. Without it, the field emits `{ file: File }` directly.
 *
 * @example
 * { provide: UPLOAD_HANDLER, useFactory: () => (file: File) => myUploadService.upload(file) }
 */
export const UPLOAD_HANDLER = new InjectionToken<(file: File) => Observable<{ url: string }>>(
  'UPLOAD_HANDLER',
);

