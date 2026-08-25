/**
 * migration.ts — moving saved records forward as a config's schema changes.
 *
 * `EntityFormConfig.version` and `VersionedRecord._configVersion` existed as declarations
 * that nothing read: a schema could be edited freely while records saved under the old
 * shape kept their old shape, and nothing detected or reconciled the difference. For a
 * library whose whole proposition is long-lived declarative schemas, that is a data-loss
 * risk measured in years.
 *
 * The model here is deliberately small: a consumer supplies ordered steps, and this applies
 * the ones a record needs. It is pure — no storage, no I/O, no framework — so the same
 * migration set runs in the browser before rendering and on a server before persisting.
 */

import type { EntityFormConfig } from './form-model.types';
import type { VersionedRecord } from './versioning.types';

/** The version assumed for a config that does not declare one. */
export const DEFAULT_CONFIG_VERSION = 1;

/** One step, moving a record from a single version to the next. */
export interface RecordMigration {
  /** The version this step upgrades a record *from*. */
  from: number;
  /** The version it produces. Must be greater than `from`. */
  to: number;
  /**
   * Transform the record. Must be pure — return a new object rather than mutating the
   * input, since callers commonly keep the original as an undo baseline.
   */
  migrate: (record: Record<string, any>, config: EntityFormConfig) => Record<string, any>;
  /** Optional description, surfaced when a migration set is rejected. */
  description?: string;
}

export interface MigrateOptions {
  /**
   * The version to assume for a record carrying no `_configVersion`.
   *
   * Omitted by default, and deliberately so: an unstamped record's version is genuinely
   * unknown. Assuming it is the oldest would re-run every migration over records that may
   * already be current and corrupt them; assuming it is current would skip migrations that
   * records actually need. Neither guess is safe to make on a consumer's behalf, so an
   * unstamped record is left untouched and reported via `unversioned` unless the consumer —
   * who does know — says otherwise.
   */
  assumeVersion?: number;
}

export interface MigrationResult {
  /** The record, migrated and stamped when steps ran; otherwise unchanged. */
  record: VersionedRecord;
  /** The `to` version of each step applied, in order. Empty when nothing ran. */
  applied: number[];
  /** The version the record started at, or `null` when it carried none. */
  from: number | null;
  /** The config version the record now matches. */
  to: number;
  /** True when the record carried no `_configVersion` and no `assumeVersion` was given. */
  unversioned: boolean;
  /**
   * True when the record's version was *newer* than the config's — a rolled-back config, or
   * a record written by a newer deployment. Nothing is applied: migrating downward would
   * discard data this code has no description of.
   */
  ahead: boolean;
}

/** The version a config declares, defaulting when it declares none. */
export function configVersion(config: EntityFormConfig | undefined): number {
  return config?.version ?? DEFAULT_CONFIG_VERSION;
}

/** The version a record carries, or `null` when it is unstamped. */
export function recordVersion(record: Record<string, any> | null | undefined): number | null {
  const raw = record?.['_configVersion'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Reject a migration set that cannot be reasoned about, rather than discovering it halfway
 * through a record. Returns human-readable problems; an empty array means the set is usable.
 */
export function validateMigrations(migrations: readonly RecordMigration[]): string[] {
  const problems: string[] = [];
  const seen = new Map<number, RecordMigration>();

  for (const m of migrations) {
    const label = m.description ? `"${m.description}" (${m.from} → ${m.to})` : `${m.from} → ${m.to}`;

    if (!Number.isFinite(m.from) || !Number.isFinite(m.to)) {
      problems.push(`Migration ${label} has a non-numeric version.`);
      continue;
    }
    if (m.to <= m.from) {
      problems.push(`Migration ${label} does not move forward.`);
      continue;
    }
    const clash = seen.get(m.from);
    if (clash) {
      problems.push(
        `Two migrations start at version ${m.from} (→ ${clash.to} and → ${m.to}); ` +
          `the upgrade path must be unambiguous.`,
      );
      continue;
    }
    seen.set(m.from, m);
  }

  return problems;
}

/** True when this record would have steps applied to it. */
export function needsMigration(
  record: Record<string, any> | null | undefined,
  config: EntityFormConfig | undefined,
  options: MigrateOptions = {},
): boolean {
  const current = recordVersion(record) ?? options.assumeVersion ?? null;
  return current !== null && current < configVersion(config);
}

/** Return a copy of the record stamped with the config's version. */
export function stampRecord(
  record: Record<string, any>,
  config: EntityFormConfig | undefined,
): VersionedRecord {
  return { ...record, _configVersion: configVersion(config) } as VersionedRecord;
}

/**
 * Walk a record forward to the config's version.
 *
 * Steps are chained strictly: the record's version must match a step's `from`, and that
 * step's `to` must match the next. A gap throws rather than applying a partial upgrade,
 * because a half-migrated record is worse than an un-migrated one — it no longer matches
 * either schema, and its `_configVersion` would be a lie either way.
 */
export function migrateRecord(
  record: Record<string, any>,
  config: EntityFormConfig | undefined,
  migrations: readonly RecordMigration[] = [],
  options: MigrateOptions = {},
): MigrationResult {
  const target = configVersion(config);
  const stamped = recordVersion(record);
  const unversioned = stamped === null && options.assumeVersion === undefined;
  const current = stamped ?? options.assumeVersion ?? null;

  const base: Omit<MigrationResult, 'record'> = {
    applied: [],
    from: current,
    to: target,
    unversioned,
    ahead: current !== null && current > target,
  };

  // Unknown version, or newer than the config: leave it exactly as it is.
  if (current === null || current > target) {
    return { ...base, record: record as VersionedRecord };
  }

  if (current === target) {
    return { ...base, record: stampRecord(record, config) };
  }

  const problems = validateMigrations(migrations);
  if (problems.length) {
    throw new Error(`[dynamic-entity] Unusable migration set:\n  ${problems.join('\n  ')}`);
  }

  const byFrom = new Map(migrations.map(m => [m.from, m]));
  const applied: number[] = [];
  let working: Record<string, any> = { ...record };
  let version = current;

  while (version < target) {
    const step = byFrom.get(version);
    if (!step) {
      throw new Error(
        `[dynamic-entity] No migration from config version ${version} to ${target} for entity ` +
          `"${config?.entity ?? 'unknown'}". Register a migration with { from: ${version} }, or ` +
          `leave the record at its current version — a partial upgrade is not applied.`,
      );
    }
    if (step.to > target) {
      throw new Error(
        `[dynamic-entity] Migration ${step.from} → ${step.to} overshoots the config version ` +
          `${target} for entity "${config?.entity ?? 'unknown'}".`,
      );
    }

    working = { ...step.migrate(working, config as EntityFormConfig) };
    version = step.to;
    applied.push(step.to);
  }

  return { ...base, applied, record: stampRecord(working, config) };
}
