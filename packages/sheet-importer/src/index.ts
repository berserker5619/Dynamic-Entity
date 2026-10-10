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

// ─── Applying a plan ────────────────────────────────────────────────────────
export { applyMapping, preparePlan } from './apply-mapping';
export type { ApplyMappingOptions, PreparedPlan } from './apply-mapping';
export { validateRecord } from './validate-record';
export type { ImportResult, ImportRowError } from './result.types';
export { IMPORT_FAILURE_CODES, ImportFailure } from './import-failure';

// ─── Suggesting a mapping ───────────────────────────────────────────────────
export { DEFAULT_SLOTS, slotsFor, suggestMapping } from './suggest';
export type { SuggestOptions } from './suggest';
export { matchSlot, normalizeHeader, slotPatterns } from './header-grammar';
export type { SlotNames } from './header-grammar';
export type { ImportFailureCode, ImportFailureDetails } from './import-failure';

// ─── Adapters ───────────────────────────────────────────────────────────────
export { jsonSchemaAdapter } from './json-schema-adapter';
export type { JsonSchemaAdapterOptions, JsonSchemaMeta, JsonSchemaNode } from './json-schema-adapter';
