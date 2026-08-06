import { InjectionToken } from '@angular/core';
import type { Type } from '@angular/core';

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
