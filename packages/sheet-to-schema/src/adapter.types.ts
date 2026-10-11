/**
 * adapter.types.ts — what the engine needs from a schema (spec §7).
 *
 * The engine knows nothing about any particular schema. An adapter tells it what the targets
 * are, how a cell becomes a value, what to do to a finished record, and how to judge it.
 * `ImportTarget` replaces Dynamic Entity 2.3's `ImportColumn`; the schema's own field object
 * becomes adapter-owned `meta`.
 */
import type { MappingPlan, PlanProblem } from './plan.types';
import type { CellProblemCode, RecordProblemCode } from './problem-codes';

/** The kind of value a target holds, which decides how a cell is read (§8). */
export type ValueKind =
  | { kind: 'string'; minLength?: number; maxLength?: number; pattern?: string; format?: 'email' | 'url' | 'phone' }
  | { kind: 'number'; integer?: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'date' }
  | { kind: 'datetime' }
  | { kind: 'time' }
  | { kind: 'month' }
  | { kind: 'enum'; values: readonly unknown[]; labels?: readonly string[] }
  | { kind: 'list'; of: ValueKind; separator?: string; minItems?: number; maxItems?: number }
  /** Only the adapter knows how to read it: `SchemaAdapter.coerce` MUST handle it. */
  | { kind: 'custom' };

/** One leaf a column can feed. */
export interface ImportTarget<TMeta = unknown> {
  /** Concrete ref, slot indices included: `customer.phones.1.number`. */
  ref: string;
  /** The ref with slot indices removed: `customer.phones.number`. */
  shapeRef: string;
  /** The generated template header. */
  header: string;
  /** Loose candidates `suggestMapping` matches headers against. */
  matchKeys?: readonly string[];
  required: boolean;
  value: ValueKind;
  /** Template help-row hint, e.g. `YYYY-MM-DD`. */
  format?: string;
  /** Shape ref of the nearest repeating ancestor. */
  arrayRef?: string;
  /** That ancestor's resolved label. */
  arrayLabel?: string;
  /** The slot, when the target is unrolled into numbered columns. */
  arrayIndex?: number;
  meta: TMeta;
}

/** One repeating container the schema has. */
export interface TargetArray {
  /** Shape ref, e.g. `customer.phones`. */
  ref: string;
  label: string;
  itemKind: 'object' | 'primitive';
  required: boolean;
  /** Whether the adapter can keep empty slots in place (`lists[ref].compact: false`, §6). */
  positional: boolean;
}

/** Everything a schema can take from a sheet, for one set of slot counts. */
export interface TargetSet<TMeta = unknown> {
  targets: ImportTarget<TMeta>[];
  arrays: TargetArray[];
  /** Fields the schema has that no sheet can carry, and why. */
  unsupported: { ref: string; reason: string }[];
}

/** What reading one cell produced: a value (`undefined` for none), or why it could not be read. */
export type CoerceOutcome = { value: unknown } | { error: string; code: CellProblemCode };

/** One thing wrong with a finished record, from `SchemaAdapter.validate` or the generic checks. */
export interface RecordProblem {
  ref: string;
  /** Compare this, never `message`. */
  code: RecordProblemCode;
  message: string;
  raw?: unknown;
}

export interface TargetOptions {
  /** Slot count per array, keyed by array shape ref. An absent array gets none. */
  slots: Record<string, number>;
  lang?: string;
}

export interface SchemaAdapter<TMeta = unknown, TCtx = unknown> {
  /** Compared with `plan.target`. */
  readonly id: string;
  /** Compared with `plan.schemaVersion`. */
  readonly version?: number;
  /** Semver of the adapter implementation. */
  readonly adapterVersion: string;
  /** MUST be pure and deterministic for the same inputs. */
  targets(options: TargetOptions): TargetSet<TMeta>;
  /** Rewrites refs an older schema used. MUST only rewrite refs, and report `PLAN_LEGACY_REF` warnings. */
  upgradeRefs?(plan: MappingPlan): { plan: MappingPlan; problems: PlanProblem[] };
  /** `null` means "use the generic coercer for `target.value`". */
  coerce?(target: ImportTarget<TMeta>, raw: unknown, ctx: TCtx): CoerceOutcome | null;
  /** Defaults to identity. Runs after grouping and compaction. */
  finalize?(record: Record<string, unknown>, ctx: TCtx): Record<string, unknown>;
  /** Defaults to the generic checks (§8). Runs after grouping and compaction. */
  validate?(record: Record<string, unknown>, ctx: TCtx): RecordProblem[];
}
