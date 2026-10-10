/**
 * problem-codes.ts — the machine-readable half of a `ConfigProblem`.
 *
 * A problem's `message` is written for a person and may be reworded in any release. Its `code`
 * is a stable identifier: a UI, a test or a CI gate that needs to tell one problem from another
 * compares codes, never message text. Once shipped, a code keeps its meaning; a check that
 * changes meaning gets a new one.
 *
 * Kept as data, the way `RULE_OPERATORS` is, so the type and anything that enumerates the codes
 * cannot drift apart. The checks behind each code are inventoried in
 * `docs/de-2.4-problem-codes.md`.
 *
 * Two namespaces that never overlap: `CONFIG_*` belongs to Dynamic Entity (`validateConfig`),
 * `PLAN_*` to the spreadsheet importer (`validateMappingPlan`). The plan codes are the ones the
 * importer's Phase 1 spec names, and only those a check here actually produces.
 */

/** Every code `validateConfig` emits. */
export const CONFIG_PROBLEM_CODES = [
  // The config itself
  'CONFIG_NOT_AN_OBJECT',
  'CONFIG_ENTITY_REQUIRED',
  'CONFIG_INVALID_VERSION',
  'CONFIG_NO_TABS',
  // Fields
  'CONFIG_FIELD_NOT_OBJECT',
  'CONFIG_FIELD_ID_REQUIRED',
  'CONFIG_RESERVED_FIELD_ID',
  'CONFIG_FIELD_ID_NOT_IDENTIFIER',
  'CONFIG_DUPLICATE_FIELD_ID',
  'CONFIG_FIELD_TYPE_REQUIRED',
  'CONFIG_UNKNOWN_FIELD_TYPE',
  'CONFIG_FIELD_NO_LABEL',
  'CONFIG_CONTAINER_NO_CHILDREN',
  'CONFIG_CHILDREN_IGNORED',
  'CONFIG_OPTIONS_AND_LIST_NAME',
  'CONFIG_INVALID_STEP',
  'CONFIG_SLIDER_RANGE_EMPTY',
  'CONFIG_INVALID_COL_SPAN',
  'CONFIG_FIELD_LEVEL_REQUIRED',
  'CONFIG_CHILDREN_NOT_ARRAY',
  // Validators
  'CONFIG_PATTERN_NOT_STRING',
  'CONFIG_INVALID_PATTERN',
  'CONFIG_MIN_EXCEEDS_MAX',
  'CONFIG_MIN_LENGTH_EXCEEDS_MAX_LENGTH',
  'CONFIG_VALIDATOR_LIST_NOT_ARRAY',
  'CONFIG_VALIDATOR_NAME_INVALID',
  'CONFIG_UNKNOWN_VALIDATOR',
  // Default values
  'CONFIG_DEFAULT_TYPE_MISMATCH',
  // Options
  'CONFIG_OPTION_NOT_OBJECT',
  'CONFIG_OPTION_RESERVED_KEY',
  'CONFIG_OPTION_KEY_INVALID',
  'CONFIG_DUPLICATE_OPTION_KEY',
  'CONFIG_DUPLICATE_OPTION_LABEL',
  // Tabs
  'CONFIG_TAB_NOT_OBJECT',
  'CONFIG_TAB_ID_REQUIRED',
  'CONFIG_RESERVED_TAB_ID',
  'CONFIG_DUPLICATE_TAB_ID',
  'CONFIG_EMPTY_TAB',
  'CONFIG_TAB_LIST_NOT_ARRAY',
  // References
  'CONFIG_UNKNOWN_FIELD_REF',
  'CONFIG_AMBIGUOUS_FIELD_REF',
  'CONFIG_UNSAFE_PATH',
  'CONFIG_REFERER_INSIDE_ARRAY',
  'CONFIG_REFERER_OVERRIDE_IGNORED',
  // Rules
  'CONFIG_RULE_NOT_OBJECT',
  'CONFIG_RULE_LIST_NOT_ARRAY',
  'CONFIG_RULE_ACTION_REQUIRED',
  'CONFIG_UNKNOWN_RULE_ACTION',
  'CONFIG_RULE_NO_TARGETS',
  'CONFIG_CONDITION_NOT_OBJECT',
  'CONFIG_UNKNOWN_RULE_OPERATOR',
  'CONFIG_COMPARE_FIELD_REQUIRED',
  'CONFIG_UNKNOWN_TAB_REF',
  'CONFIG_TAB_ACTION_IGNORED',
  'CONFIG_UNKNOWN_TARGET_TYPE',
] as const;
export type ConfigProblemCode = (typeof CONFIG_PROBLEM_CODES)[number];

/** Every code `validateMappingPlan` emits. */
export const PLAN_PROBLEM_CODES = [
  /** Not an object, no `entries` array, or an entry that is not an object or has no ref. */
  'PLAN_SHAPE',
  /** The plan's `entity` or `configVersion` differs from the config's. A warning. */
  'PLAN_TARGET_MISMATCH',
  /** A 2.2 ref of a moved container, read at its current address. A warning. */
  'PLAN_LEGACY_REF',
  'PLAN_UNKNOWN_REF',
  'PLAN_DUPLICATE_REF',
  /** Not exactly one of `column` and `constant`, or a column that is not a zero-based index. */
  'PLAN_SOURCE',
] as const;
export type PlanProblemCode = (typeof PLAN_PROBLEM_CODES)[number];

/** Any code a `ConfigProblem` may carry. */
export type ProblemCode = ConfigProblemCode | PlanProblemCode;
