// Tokens
export * from './lib/tokens/injection-tokens';

// Providers
export * from './lib/providers/provide-ngx-dynamic-entity';
export * from './lib/providers/provide-field-types';

// Services
export * from './lib/services/field-registry.service';
export * from './lib/services/hook-registry.service';
export * from './lib/services/validator-registry.service';
export * from './lib/services/entity-ref-registry.service';
export * from './lib/services/entity-ref-selection.service';
export * from './lib/services/cascade-data.service';
export * from './lib/services/entity-reference.service';
export * from './lib/services/entity-ref-cache';
export * from './lib/services/lookup-registry.service';
export * from './lib/services/rbac.service';
export * from './lib/services/rules-evaluation.service';

// Components — the library ships form UI only; rendering a data table is the consumer's choice.
export * from './lib/form/dynamic-form.component';
export * from './lib/form/dynamic-record-form.component';
export * from './lib/form/dynamic-field/dynamic-field.component';

// Field type components (individually importable — reusability rule)
export * from './lib/field-types/text-field.component';
export * from './lib/field-types/textarea-field.component';
export * from './lib/field-types/number-field.component';
export * from './lib/field-types/checkbox-field.component';
export * from './lib/field-types/date-field.component';
export * from './lib/field-types/dropdown-field.component';
export * from './lib/field-types/multi-select-field.component';
export * from './lib/field-types/entity-ref-field.component';

// Value helpers — a dropdown value is now a language-keyed object, so a consumer rendering
// record values needs these. Re-exported so they don't have to depend on core directly.
export {
  resolveLabel,
  resolveOptionLabel,
  resolveOptionValue,
  formatDisplayValue,
  valuesMatch,
  normalizeOption,
  normalizeConfig,
} from '@dynamic-entity/core';

// Re-export core types so consumers need only one import
export type {
  EntityFormConfig,
  NestedTabConfig,
  NestedFieldConfig,
  FieldTableConfig,
  RichFieldType,
  LocalizedText,
  DropdownOption,
  VersionedRecord,
  EntityPermissions,
  RbacContext,
  FieldValidators,
  EntityReferenceConfig,
  EntityReferenceLoader,
  ReferenceOption,
  ReferenceLoaderContext,
  AutoPatchConfig,
  PatchOnTrueMapping,
  FileRef,
  FormRule,
  RuleCondition,
  RuleAction,
  RuleEvaluationResult,
  CommonModuleEntry,
} from '@dynamic-entity/core';
