/**
 * config-migration.ts — versioned config upcasting.
 * Applies registered upcasters (e.g. flat → nested) then normalizes the result.
 */

import type { EntityFormConfig } from './form-model.types';
import { normalizeConfig } from './form-logic';
import { simpleToRich } from './simple-to-rich.upcaster';

/** Current canonical EntityFormConfig schema version. */
export const CURRENT_CONFIG_VERSION = 1;

export interface ConfigUpcaster {
  fromVersion: number;
  toVersion: number;
  upcast: (raw: unknown) => unknown;
}

/** Default upcasters shipped with the library. Consumers may append custom steps. */
export const DEFAULT_UPCASTERS: ConfigUpcaster[] = [
  { fromVersion: 0, toVersion: 1, upcast: simpleToRich },
];

/**
 * Detects the schema version of a raw config blob.
 * Version 0 = legacy flat model (`fields[]` / `entities[]` without nested `tabs[]`).
 */
export function detectConfigVersion(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  const c = raw as Record<string, unknown>;
  if (typeof c['version'] === 'number') return c['version'];
  if (Array.isArray(c['tabs'])) return CURRENT_CONFIG_VERSION;
  if (Array.isArray(c['fields']) || Array.isArray(c['entities'])) return 0;
  return 0;
}

export interface MigrateConfigOptions {
  targetVersion?: number;
  upcasters?: ConfigUpcaster[];
}

/**
 * Migrates a raw config blob to the target schema version, then normalizes it.
 * Already-current configs pass through normalization only.
 */
export function migrateConfig(raw: unknown, options: MigrateConfigOptions = {}): EntityFormConfig {
  const targetVersion = options.targetVersion ?? CURRENT_CONFIG_VERSION;
  const upcasters = options.upcasters ?? DEFAULT_UPCASTERS;

  let current = raw;
  let version = detectConfigVersion(current);

  while (version < targetVersion) {
    const step = upcasters.find(u => u.fromVersion === version && u.toVersion > version);
    if (!step) {
      throw new Error(`No upcaster registered for config version ${version} → ${targetVersion}`);
    }
    current = step.upcast(current);
    version = step.toVersion;
  }

  const normalized = normalizeConfig(current);
  return { ...normalized, version: targetVersion };
}
