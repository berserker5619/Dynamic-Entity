/**
 * The public surface of `@dynamic-entity/core`.
 *
 * Explicit, not `export *`: a barrel makes every helper semver surface the moment it is
 * written. Adding a name here is a deliberate act.
 *
 * The CLI lives behind the `./cli` subpath rather than here, so importing this package in a
 * browser cannot pull it in even by accident.
 */

// ─── The form model ──────────────────────────────────────────────────────────
export type {
  AutoPatchConfig,
  AutoPatchMapping,
  DropdownOption,
  EntityFormConfig,
  EntityReferenceConfig,
  FieldTableConfig,
  FieldValidators,
  FormRule,
  LocalizedText,
  NestedFieldConfig,
  NestedTabConfig,
  PatchOnTrueMapping,
  RawDropdownOption,
  ReferencedSnapshot,
  RichFieldType,
  RuleAction,
  RuleActionType,
  RuleCompareType,
  RuleCondition,
  RuleEvaluationResult,
  RuleOperator,
  RuleTarget,
} from './form-model.types';
export { RULE_ACTION_TYPES, RULE_OPERATORS } from './form-model.types';
export type { EntityPermissions, RbacContext } from './rbac.types';
export type { VersionedRecord } from './versioning.types';

// ─── Schema versioning and record migration ─────────────────────────────────
export {
  DEFAULT_CONFIG_VERSION,
  applyOptionKeys,
  applyRowIds,
  configVersion,
  migrateRecord,
  needsMigration,
  optionKeyMigration,
  recordVersion,
  rowIdMigration,
  stampRecord,
  validateMigrations,
} from './migration';
export { LEGACY_ROW_ID_PREFIX, ROW_ID_KEY, newRowId, stampNewRowIds } from './row-ids';
export type { MigrateOptions, MigrationResult, RecordMigration } from './migration';

// ─── Field addressing: scopes, refs and paths ───────────────────────────────
export {
  ROOT_SCOPE,
  ambiguousFieldIds,
  assignFieldRefs,
  collectFieldRefs,
  collectFieldScopes,
  fieldRefFor,
  fieldsUnderTab,
  flattenFieldValues,
  isRefOverride,
  namesOfField,
  parseFieldRef,
  refOf,
  toRefToken,
} from './field-scopes';
export type { FieldRefEntry, FieldScopeEntry } from './field-scopes';

// ─── Config validation ──────────────────────────────────────────────────────
export { formatConfigProblems, isConfigValid, validateConfig } from './validate-config';
export type { ConfigProblem, ValidateConfigOptions } from './validate-config';
export { CONFIG_PROBLEM_CODES, PLAN_PROBLEM_CODES } from './problem-codes';
export type { ConfigProblemCode, PlanProblemCode, ProblemCode } from './problem-codes';

// ─── Pure form logic ────────────────────────────────────────────────────────
export {
  OPTION_KEY,
  UNSAFE_PATH_KEYS,
  applyAutoPatch,
  applyPatchOnTrue,
  canonicalizeValue,
  evaluateFieldVisibility,
  findTab,
  formatDisplayValue,
  getLocaleLang,
  getTabData,
  getTabPath,
  getValueByPath,
  isUnsafePath,
  labelToId,
  languageEntries,
  normalizeArrayStructures,
  normalizeConfig,
  normalizeConfigOptions,
  normalizeField,
  normalizeLocalizedText,
  normalizeOption,
  normalizeTab,
  optionKeyOf,
  placeTabFields,
  resolveEffectiveMask,
  resolveLabel,
  resolveOptionLabel,
  resolveOptionValue,
  setDateFormatters,
  setTabData,
  setValueByPath,
  shouldMaskField,
  uniqueId,
  valuesEqual,
  valuesMatch,
} from './form-logic';
export type { DateFormatters } from './form-logic';

// ─── The field-type catalogue ───────────────────────────────────────────────
export {
  FIELD_TYPE_CATALOG,
  createFieldConfig,
  getFieldTypeMeta,
  humanizeId,
  registerFieldType,
} from './field-catalog';
export type { FieldTypeMeta, FlagValidator, ParamValidator } from './field-catalog';

// ─── Field values: format checks shared by the form and the import ──────────
export {
  MAX_RATING_SCALE,
  isValidPhone,
  isValidUrl,
  normalizeHexColor,
  normalizeTags,
  ratingScale,
  sliderBounds,
} from './field-values';
export type { SliderBounds } from './field-values';

// ─── Rules ──────────────────────────────────────────────────────────────────
export { evaluateCondition, evaluateFormRules, filterRulesForTab } from './rules-engine';
export type { EvaluateFormRulesOptions } from './rules-engine';

// ─── Entity references and cascades ─────────────────────────────────────────
export {
  applyCascadeFilter,
  buildReferenceCacheKey,
  buildReferenceLabel,
  entityKeyFromCacheKey,
  findCascadeChildren,
  normalizeReferenceOptions,
} from './entity-reference.types';
export type {
  EntityReferenceLoader,
  RawReferenceItem,
  ReferenceLoaderContext,
  ReferenceLoaderResult,
  ReferenceOption,
  Subscribable,
} from './entity-reference.types';

// ─── Named lookup lists ─────────────────────────────────────────────────────
export { findUnmatchedValues, lookupValuesToOptions, normalizeLookupValues } from './lookup-list';
export type {
  LookupListLoader,
  LookupListMap,
  LookupListResult,
  LookupListSource,
  LookupListValue,
  LookupLoaderContext,
  RawLookupListValue,
  UnmatchedValue,
} from './lookup-list';

// ─── File references ────────────────────────────────────────────────────────
export { fileRefName, isPersistedFileRef } from './file-ref.types';
export type { FileRef, FileUploadHandler, UploadResult } from './file-ref.types';

// ─── Constants ──────────────────────────────────────────────────────────────
export { COMMON_MODULES, CORE_VERSION, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './constants';
export type { CommonModuleEntry, ComponentClass } from './constants';

// ─── Referenced fields and drift ────────────────────────────────────────────
export { computeFieldDrift, createFieldSnapshot } from './referenced-field';

// ─── CSV ────────────────────────────────────────────────────────────────────
export {
  completeFirstLine,
  createCsvReader,
  decimalMarkFor,
  detectDelimiter,
  escapeFormula,
  padRow,
  parseCsv,
  toCsv,
} from './csv';
export type { CsvDelimiter, CsvReader, CsvReaderOptions, SheetData, SheetGrid } from './csv';
export { cellText } from './cell-text';

// ─── Spreadsheet import ─────────────────────────────────────────────────────
export type {
  AnyMappingPlan,
  DerivedColumns,
  ImportColumn,
  ImportResult,
  ImportRowError,
  MappingEntry,
  MappingPlan,
  MappingPlanV1,
  UnsupportedColumn,
} from './import-model.types';
// The plan reader, re-exported so app code that is handed a plan in either shape, such as a
// preview's `suggestion`, can normalise it to plan v2 without a second import.
export { planForServer, readPlan, v2OnlyFields } from 'sheet-to-schema';
export type { AdapterStamp, NormalizedPlan, PlanForServer, ReadPlanOptions, ReadPlanResult } from 'sheet-to-schema';
// A 2.x plan that names no entity, given the config's: what every Dynamic Entity entry point
// does to a plan before sheet-to-schema reads it. Exported for code that calls the generic
// engine or runner with `entityFormConfigAdapter` directly, as `@dynamic-entity/server` does.
export { planFor as planForConfig } from './import-columns';
// The config as sheet-to-schema's schema adapter: what the three functions below run on.
export { entityFormConfigAdapter } from './entity-form-config-adapter';
export type { EntityFormConfigAdapterOptions, EntityImportContext } from './entity-form-config-adapter';
export type {
  ImportCommitResponse,
  ImportErrorResponse,
  ImportPreviewResponse,
} from './import-wire.types';
export {
  buildTemplateSpec,
  collectLeafTargets,
  deriveImportColumns,
  stripIndices,
  upgradeLegacyRefs,
  validateMappingPlan,
} from './import-columns';
export { DEFAULT_ARRAY_ROWS, arrayBoundFor, inferArrayBound } from './array-headers';
export type { DeriveColumnsOptions, LeafTarget, TemplateSpec } from './import-columns';
export {
  applyMapping,
  coerceCell,
  setRecordValue,
  suggestMapping,
  validateImportedRecord,
} from './import-engine';
export type {
  ApplyMappingOptions,
  CoerceOptions,
  CoerceOutcome,
  DateOrder,
  ImportLookups,
  RecordProblem,
  ValidateRecordOptions,
} from './import-engine';
