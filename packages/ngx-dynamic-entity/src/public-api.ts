// Tokens
export * from './lib/tokens/injection-tokens';

// Providers
export * from './lib/providers/provide-ngx-dynamic-entity';

// Services
export * from './lib/services/field-registry.service';
export * from './lib/services/hook-registry.service';
export * from './lib/services/validator-registry.service';
export * from './lib/services/entity-ref-registry.service';
export * from './lib/services/version.service';
export * from './lib/services/rbac.service';

// Components — the library ships form UI only; rendering a data table is the consumer's choice.
export * from './lib/form/dynamic-form.component';
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

// Re-export core types so consumers need only one import
export type {
  EntityConfig,
  FieldConfig,
  TabConfig,
  DropdownOption,
  FieldDependency,
  EntityHooks,
  VersionedRecord,
  EntityPermissions,
  RbacContext,
  MigrationStrategy,
  QueryOptions,
  PaginatedResult,
  // Rich nested form model (config carries `table` hints as metadata only — no table ships)
  EntityFormConfig,
  NestedTabConfig,
  NestedFieldConfig,
  FieldTableConfig,
  RichFieldType,
  LocalizedText,
} from '@dynamic-entity/core';
