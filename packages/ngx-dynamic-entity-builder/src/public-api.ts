// Main component
export * from './lib/entity-builder.component';

// Sub-components (individually importable — reusability rule, mirrors ngx-dynamic-entity)
export * from './lib/components/field-palette.component';
export * from './lib/components/field-inspector.component';
export * from './lib/components/tab-manager.component';

// Store (provided per builder instance)
export * from './lib/builder-store.service';

// Catalog + helpers
export * from './lib/field-catalog';

// Re-export the core types a consumer of the builder needs
export type {
  EntityFormConfig,
  NestedTabConfig,
  NestedFieldConfig,
  RichFieldType,
  DropdownOption,
  EntityPermissions,
} from '@dynamic-entity/core';
