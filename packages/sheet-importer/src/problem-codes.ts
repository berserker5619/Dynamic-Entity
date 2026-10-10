/**
 * problem-codes.ts — every code a plan problem may carry (spec §4, "Problem codes").
 *
 * Codes are stable identifiers; messages are written for people and may change. Tests and UIs
 * compare codes, never message text. Kept as data so the type and anything that enumerates the
 * codes cannot drift apart, the way Dynamic Entity's `RULE_OPERATORS` is.
 *
 * Six of these (`PLAN_SHAPE`, `PLAN_TARGET_MISMATCH`, `PLAN_LEGACY_REF`, `PLAN_UNKNOWN_REF`,
 * `PLAN_DUPLICATE_REF`, `PLAN_SOURCE`) already ship from Dynamic Entity 2.4's
 * `validateMappingPlan`, and keep exactly that meaning here.
 */
export const PLAN_PROBLEM_CODES = [
  /** Not an object, no `entries` array, an entry that is not an object or has no ref, no target, or a wrongly typed field. */
  'PLAN_SHAPE',
  /** `planVersion` other than absent or 2, or a v2 field on a plan without `planVersion`. */
  'PLAN_VERSION',
  /** A key the plan format does not define. An error, except an unknown top-level key on a v1 plan. */
  'PLAN_UNKNOWN_KEY',
  /** `entity` and `target` (or `configVersion` and `schemaVersion`) disagree. */
  'PLAN_ALIAS_CONFLICT',
  /** An old name used where the v2 name is expected. A warning. */
  'PLAN_ALIAS_USED',
  /** A ref, `lists` key or `collect` entry with a segment that reaches an object's prototype. */
  'PLAN_UNSAFE_PATH',
  /** A ref the adapter has no target for. */
  'PLAN_UNKNOWN_REF',
  /** Two entries for one ref. */
  'PLAN_DUPLICATE_REF',
  /** Not exactly one of `column` and `constant`, or a column that is not a zero-based index. */
  'PLAN_SOURCE',
  /** `split` on a target whose value kind is not `list`. */
  'PLAN_SPLIT_TARGET',
  /** A bad `lists` key or option, or an option the adapter cannot honour. */
  'PLAN_LIST_OPTION',
  /** A bad `group`, or grouping the runner cannot do. */
  'PLAN_GROUP',
  /** A ref rewritten by the adapter's `upgradeRefs`. A warning. */
  'PLAN_LEGACY_REF',
  /** `target` or `schemaVersion` differ from the adapter's `id` or `version`. A warning. */
  'PLAN_TARGET_MISMATCH',
] as const;
export type PlanProblemCode = (typeof PLAN_PROBLEM_CODES)[number];

/** Why one cell could not be read (§9, "Row codes"). Carried by a failed `CoerceOutcome`. */
export const CELL_PROBLEM_CODES = [
  /** Not readable as the target's kind: not a number, a date, a time or a boolean. */
  'CELL_FORMAT',
  /** An `enum` cell matching no value or label. */
  'CELL_UNKNOWN_OPTION',
  /** One item of a split cell fails its list's item kind; the message names its position. */
  'CELL_LIST_ITEM',
] as const;
export type CellProblemCode = (typeof CELL_PROBLEM_CODES)[number];

/** Why a finished record was judged wrong, or what to warn about it (§9, "Row codes"). */
export const RECORD_PROBLEM_CODES = [
  'RECORD_REQUIRED',
  /** `pattern` or `format` (email, url, phone) not met. */
  'RECORD_FORMAT',
  /** `min`/`max`, length, or list item count out of bounds. */
  'RECORD_RANGE',
  /** A rule's validation message. */
  'RECORD_RULE',
  /** Rows of one group disagree on a parent field. A warning. */
  'RECORD_GROUP_CONFLICT',
  /** A row with a blank group key, imported as its own record. A warning. */
  'RECORD_GROUP_NO_KEY',
] as const;
export type RecordProblemCode = (typeof RECORD_PROBLEM_CODES)[number];

/** Any code a row error or warning may carry. */
export type RowProblemCode = CellProblemCode | RecordProblemCode;
