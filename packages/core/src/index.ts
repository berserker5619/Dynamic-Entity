/**
 * The public surface of `@dynamic-entity/core`.
 *
 * Explicit, not `export *`. A barrel that re-exported every module made every helper in it
 * semver surface the moment it was written: `runValidateCli` and a dozen import-engine
 * internals were published API that nobody chose to publish, and removing one would have
 * been a breaking change. Adding a name here is now a deliberate act.
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
export type { EntityPermissions, RbacContext } from './rbac.types';
export type { VersionedRecord } from './versioning.types';

// ─── Schema versioning and record migration ─────────────────────────────────
export {
  DEFAULT_CONFIG_VERSION,
  applyOptionKeys,
  configVersion,
  migrateRecord,
  needsMigration,
  optionKeyMigration,
  recordVersion,
  stampRecord,
  validateMigrations,
} from './migration';
export type { MigrateOptions, MigrationResult, RecordMigration } from './migration';

// ─── Field addressing: scopes, refs and paths ───────────────────────────────
export {
  ROOT_SCOPE,
  ambiguousFieldIds,
  assignFieldRefs,
  collectFieldScopes,
  fieldRefFor,
  fieldsUnderTab,
  parseFieldRef,
  refOf,
  toRefToken,
} from './field-scopes';
export type { FieldScopeEntry } from './field-scopes';

// ─── Config validation ──────────────────────────────────────────────────────
export { formatConfigProblems, isConfigValid, validateConfig } from './validate-config';
export type { ConfigProblem, ValidateConfigOptions } from './validate-config';

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
export { createCsvReader, escapeFormula, padRow, parseCsv, toCsv } from './csv';
export type { CsvReader, SheetData } from './csv';

// ─── Spreadsheet import ─────────────────────────────────────────────────────
export type {
  DerivedColumns,
  ImportColumn,
  ImportResult,
  ImportRowError,
  MappingEntry,
  MappingPlan,
  UnsupportedColumn,
} from './import-model.types';
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
  validateMappingPlan,
} from './import-columns';
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
  ImportLookups,
  RecordProblem,
  ValidateRecordOptions,
} from './import-engine';
