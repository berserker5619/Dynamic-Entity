/**
 * plan.types.ts — MappingPlan v2 (spec §3).
 *
 * A plan is persisted and crosses the wire, so this shape is a contract. Every v2 addition is
 * optional: a 2.x plan is a valid v2 plan once read through `readPlan`, which maps the v1
 * names (`entity`, `configVersion`) onto these.
 */
import type { PlanProblemCode } from './problem-codes';

/** How a suggestion was made: read from the sheet, or inferred. */
export type MatchConfidence = 'exact' | 'guess';

/** One target fed by one source: a column, or a constant for every row. */
export interface MappingEntry {
  /** Concrete ref; at most one entry per ref. */
  ref: string;
  /** Zero-based source column. Exclusive with `constant`. */
  column?: number;
  /** Header text at authoring time. Display and drift detection only. */
  header?: string;
  /** A literal applied to every row. Exclusive with `column`. */
  constant?: unknown;
  confidence?: MatchConfidence;
  /** v2: the separator a cell is split on. Only valid on a list target (§6). */
  split?: string;
}

/** v2: per-array options, keyed by array ref in `MappingPlan.lists`. */
export interface ListOptions {
  /** Default true: holes removed and items renumbered. `false` keeps slot positions. */
  compact?: boolean;
}

/** v2: one-to-many grouping (§5). */
export interface GroupSpec {
  /** Column indices whose trimmed cell text, compared as a tuple, is the group key. Non-empty. */
  key: number[];
  /** Array refs whose items accumulate across a group's rows. Non-empty. */
  collect: string[];
  /** Default true: a group's rows must be adjacent. */
  contiguous?: boolean;
}

export interface MappingPlan {
  /** Absent means v1. Writers always emit 2. */
  planVersion?: 2;
  /** The adapter `id` this plan was written for. v1 name: `entity`. */
  target: string;
  /** The adapter `version` this plan was written for. v1 name: `configVersion`. */
  schemaVersion?: number;
  /** The headers this plan was authored against. */
  sourceHeaders?: string[];
  entries: MappingEntry[];
  /** v2: per-array options, keyed by array ref. */
  lists?: Record<string, ListOptions>;
  /** v2: grouping. */
  group?: GroupSpec;
}

/**
 * A plan as `readPlan` returns it: v2 names only, with every default filled in, so nothing
 * downstream re-applies one (§4 rule 7).
 */
export interface NormalizedPlan extends MappingPlan {
  planVersion: 2;
  group?: Required<GroupSpec>;
}

/** One thing wrong with a plan. Dynamic Entity 2.4's `ConfigProblem` shape, with the code required. */
export interface PlanProblem {
  level: 'error' | 'warning';
  /** Compare this, never `message`. */
  code: PlanProblemCode;
  /** Where the problem is, e.g. `entries[2].ref`. Not a stable grammar. */
  path: string;
  /** For a person to read. May be reworded in any release. */
  message: string;
}
