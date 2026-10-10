// The importer's browser entry. No runtime dependencies, and nothing from Dynamic Entity
// (docs/import-phase1-spec.md, "Package boundaries").

// ─── Plan v2 ────────────────────────────────────────────────────────────────
export type {
  GroupSpec,
  ListOptions,
  MappingEntry,
  MappingPlan,
  MatchConfidence,
  NormalizedPlan,
  PlanProblem,
} from './plan.types';
export { PLAN_PROBLEM_CODES } from './problem-codes';
export type { PlanProblemCode } from './problem-codes';
export { readPlan } from './read-plan';
export type { ReadPlanOptions, ReadPlanResult } from './read-plan';
export { UNSAFE_PATH_KEYS, isUnsafePath } from './safe-path';
export { CELL_PROBLEM_CODES, RECORD_PROBLEM_CODES } from './problem-codes';
export type { CellProblemCode, RecordProblemCode, RowProblemCode } from './problem-codes';

// ─── Schema adapters ────────────────────────────────────────────────────────
export type {
  CoerceOutcome,
  ImportTarget,
  RecordProblem,
  SchemaAdapter,
  TargetArray,
  TargetOptions,
  TargetSet,
  ValueKind,
} from './adapter.types';
export { MAX_SLOTS, planSlots, shapeOf, slotOf } from './plan-slots';
export { validatePlan } from './validate-plan';

// ─── Coercion ───────────────────────────────────────────────────────────────
export { DEFAULT_LIST_SEPARATOR, coerceValue } from './coerce';
export type { CoerceValueOptions } from './coerce';
export { cellText } from './cell-text';
