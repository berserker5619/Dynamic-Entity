// Main component
export * from './lib/entity-builder.component';

// Sub-components (individually importable — reusability rule, mirrors ngx-dynamic-entity)
export * from './lib/components/field-palette.component';
export * from './lib/components/field-inspector.component';
export * from './lib/components/tab-manager.component';
export * from './lib/components/rule-form.component';
export * from './lib/components/field-rules-list.component';
export * from './lib/components/entity-reference-config.component';
export * from './lib/components/connection-source-config.component';
export * from './lib/components/entity-builder-canvas.component';
export * from './lib/components/entity-builder-tree-node.component';

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
  EntityReferenceConfig,
  AutoPatchConfig,
  AutoPatchMapping,
  PatchOnTrueMapping,
  FormRule,
  RuleCondition,
  RuleAction,
  RuleOperator,
} from '@dynamic-entity/core';
