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

import { OPTION_KEY, optionKeyOf, valuesMatch } from './form-logic';
import type {
  DropdownOption,
  EntityFormConfig,
  NestedFieldConfig,
  NestedTabConfig,
} from './form-model.types';
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

// ─── Option keys ─────────────────────────────────────────────────────────────

/** Field types whose stored value comes from an option list. */
const CHOICE_TYPES = new Set(['dropdown', 'radio', 'multiSelect']);

/**
 * Attach the config's current `$key`s to the choice values a record already holds.
 *
 * Keys are authored, not invented, so a config that gains them does not retroactively key
 * the records saved under it — and until a record carries one, a rename still orphans it.
 * This is the one-time step that closes that gap: for every choice field, each stored value
 * is matched against the field's current options by text (`valuesMatch`, the same lenient
 * match the form uses) and, on a hit, rewritten to carry that option's key.
 *
 * What it deliberately does not do:
 *
 *   - **It never invents a key.** An option with none leaves its records alone.
 *   - **It never rewrites a value that already has one.** A record migrated once, or written
 *     by a form after keys existed, is already correct; re-deriving it from text would undo
 *     exactly the rename the key exists to survive.
 *   - **It leaves an unmatched value exactly as it is.** A value orphaned before the keys
 *     were added cannot be matched to an option by definition, and guessing which one was
 *     meant is a decision for a human with the old config in front of them. Run
 *     `findUnmatchedValues` to find those first.
 *
 * Usage: bump `config.version`, register this as the step into the new version, and records
 * upgrade the next time they are read.
 *
 *     const migrations = [optionKeyMigration(config)];  // from: 1, to: 2
 */
export function optionKeyMigration(
  config: EntityFormConfig,
  versions: { from?: number; to?: number } = {},
): RecordMigration {
  const to = versions.to ?? configVersion(config);
  const from = versions.from ?? to - 1;

  return {
    from,
    to,
    description: 'Attach stable option keys to stored choice values',
    migrate: record => applyOptionKeys(record, config),
  };
}

/** The rewrite `optionKeyMigration` performs, exposed for a one-off run over stored data. */
export function applyOptionKeys(
  record: Record<string, any>,
  config: EntityFormConfig,
): Record<string, any> {
  if (!record || typeof record !== 'object') return record;
  const next = structuredCloneish(record);

  /*
   * Walked against the record rather than addressed by path.
   *
   * A `group` nests one object deep, but an `array` holds a *list* of row objects — there is
   * no single path to `contacts.type`, there is one per row. Walking both structures together
   * is the only shape that reaches a choice field inside a repeating section, which is
   * exactly where an unkeyed value is hardest to find by hand.
   */
  const visitFields = (fields: NestedFieldConfig[] | undefined, container: unknown): void => {
    if (!container || typeof container !== 'object' || Array.isArray(container)) return;
    const holder = container as Record<string, unknown>;

    for (const field of Array.isArray(fields) ? fields : []) {
      if (!field?.id) continue;
      const current = holder[field.id];
      if (current === undefined || current === null) continue;

      if (field.type === 'group') {
        visitFields(field.children, current);
        continue;
      }
      if (field.type === 'array') {
        if (Array.isArray(current)) for (const row of current) visitFields(field.children, row);
        continue;
      }
      if (!CHOICE_TYPES.has(field.type)) continue;

      const options = keyedOptions(field);
      if (!options.length) continue;

      holder[field.id] = Array.isArray(current)
        ? current.map(item => withKeyFromOptions(item, options))
        : withKeyFromOptions(current, options);
    }
  };

  const visitTabs = (tabs: NestedTabConfig[] | undefined, container: unknown): void => {
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (!tab?.id) continue;
      // `flatData` stores a tab's fields at the parent's level rather than under the tab id.
      const scope = tab.flatData ? container : (container as Record<string, unknown>)?.[tab.id];
      if (!scope) continue;
      visitFields(tab.fields, scope);
      visitTabs(tab.children, scope);
    }
  };

  visitTabs(config?.tabs, next);
  return next;
}

/** The field's options that actually carry a key; the rest cannot contribute one. */
function keyedOptions(field: NestedFieldConfig): DropdownOption[] {
  if (!Array.isArray(field.options)) return [];
  return field.options.filter(option => optionKeyOf(option) !== undefined);
}

/** One stored value, keyed from the option it matches — or returned untouched. */
function withKeyFromOptions(value: unknown, options: readonly DropdownOption[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (optionKeyOf(value) !== undefined) return value;

  const match = options.find(option => valuesMatch(option, value));
  const key = match ? optionKeyOf(match) : undefined;
  return key === undefined ? value : { [OPTION_KEY]: key, ...(value as Record<string, unknown>) };
}

/**
 * A deep copy of the plain data a record holds.
 *
 * `structuredClone` is not available on every runtime this package supports, and a record is
 * JSON by construction — it came from storage or a form. Nested objects are copied because
 * `migrate` must not mutate its input: callers keep the original as an undo baseline.
 */
function structuredCloneish<T>(value: T): T {
  if (Array.isArray(value)) return value.map(structuredCloneish) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = structuredCloneish(v);
    }
    return out as T;
  }
  return value;
}
