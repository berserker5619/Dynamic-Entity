/**
 * form-model.types.ts — the rich, NESTED entity **form** model (`EntityFormConfig`).
 *
 * Nested `tabs[].fields[]` + `tabs[].children[]` + `field.children[]` (group/array) express the
 * full form hierarchy that the flat `EntityConfig.fields[] + field.tab` model cannot. This is the
 * canonical model authored by the builder and consumed by the renderer.
 *
 * `FieldTableConfig` is retained as **consumer-facing table-display metadata** only — the library
 * ships no data table; how a table is rendered is the consumer's choice.
 */

import type { EntityPermissions } from './rbac.types';

export type LocalizedText = Record<string, string>;

export interface DropdownOption {
  value: any;
  label: LocalizedText;
}

/** Full field-type vocabulary supported by the rich renderer. */
export type RichFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'email'
  | 'password'
  | 'date'
  | 'datetime'
  | 'monthYear'
  | 'dropdown'
  | 'radio'
  | 'checkbox'
  | 'boolean'
  | 'multiSelect'
  | 'group'
  | 'array'
  | 'image'
  | 'file';

/** Angular-style validator config for a field. */
export interface FieldValidators {
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/** Per-field table-display metadata (a consumer's own table can read these; the library renders no table). */
export interface FieldTableConfig {
  visible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  globalSearch?: boolean;
  /** Primary name column — a consumer table might render a clickable link. */
  isName?: boolean;
  /** Status column — a consumer table might render a coloured badge. */
  isStatus?: boolean;
  /** Show as a column inside an array sub-table (array children only). */
  arrayVisible?: boolean;
  width?: string;
}

/**
 * Entity-reference config: a dropdown/multiSelect whose options come from a consumer-provided
 * loader (keyed by `linkedEntityKey`). Cascade fields depend on a sibling `parentField`.
 */
export interface EntityReferenceConfig {
  enabled: boolean;
  linkedEntityKey?: string;
  /** Field ids from the linked entity's primary tab used to build the option label. */
  displayFields?: string[];
  /** Static filter passed to the loader, e.g. `{ isEmployee: false }`. */
  filters?: Record<string, unknown>;
  /** Cascade: sibling field id whose value filters this field's options. */
  parentField?: string;
  /** Cascade: path in the target entity to match against the parent value. */
  lookupFilter?: string;
  /** Cascade: dot-path to a nested array within the parent record to use as options. */
  lookupPath?: string;
}

/** Copy field values into another tab when a selection is made in this (entity-ref) field. */
export interface AutoPatchMapping {
  /** Field id in the selected linked record. */
  source: string;
  /** Field id in the target tab to receive the value. */
  target: string;
}
export interface AutoPatchConfig {
  targetTab: string;
  mappings: AutoPatchMapping[];
}

/** When a boolean field flips to `true`, copy `from` → `to` within the same record. */
export interface PatchOnTrueMapping {
  from: string;
  to: string;
}

/** Snapshot of a referenced field's shape at link time (for drift detection). */
export interface ReferencedSnapshot {
  label?: LocalizedText;
  type?: RichFieldType;
  validators?: FieldValidators;
  options?: DropdownOption[];
}

/** A field in the nested form model. `group`/`array` carry `children`. */
export interface NestedFieldConfig {
  id: string;
  type: RichFieldType;
  label: LocalizedText;
  placeholder?: LocalizedText;
  visibility?: boolean;
  /** System-created field — edit/delete protected in the builder. */
  systemDefault?: boolean;
  readonly?: boolean;
  disabled?: boolean;
  maskData?: boolean;
  /** Lock icon + triggers deferred `VALUE_CHANGED` rules. */
  criticalField?: boolean;
  /** 1–12 CSS grid span. */
  colSpan?: number;
  /** Dot-path override for data binding ("tabId.fieldId"). */
  refererField?: string;
  /** Named lookup list key for dynamic options. */
  lookupSource?: string;
  /** Named list key for dropdown/multiSelect options (instead of inline `options`). */
  listName?: string;
  defaultValue?: unknown;
  validators?: FieldValidators;
  /** Inline options for dropdown/radio/multiSelect (each a LocalizedText-labelled value). */
  options?: DropdownOption[];
  /** Children of `group` (nested fields) and `array` (row column definitions). */
  children?: NestedFieldConfig[];
  /** Table-display metadata (leaf types only). */
  table?: FieldTableConfig;
  entityReference?: EntityReferenceConfig;
  /** Record-level conditional visibility, e.g. `{ isEmployee: true }`. */
  showWhen?: Record<string, unknown>;
  isProfileImage?: boolean;
  isHeaderToggle?: boolean;
  showOnMinimize?: boolean;
  autoPatch?: AutoPatchConfig;
  patchOnTrue?: PatchOnTrueMapping[];
  /** Live reference to a field in another entity. */
  isReferenced?: boolean;
  referencedEntityKey?: string;
  referencedFieldId?: string;
  referencedSnapshot?: ReferencedSnapshot;
  hasDrift?: boolean;
}

/** A tab in the nested model. Tabs may nest via `children`. */
export interface NestedTabConfig {
  id: string;
  label: LocalizedText;
  visibility?: boolean;
  systemDefault?: boolean;
  isPrimaryTab?: boolean;
  /** When true, this tab's fields are stored flat in the record root (no `tabId` prefix). */
  flatData?: boolean;
  maskData?: boolean;
  fields?: NestedFieldConfig[];
  children?: NestedTabConfig[];
  /** Render a shared module instead of generated fields (e.g. a consumer-provided component). */
  moduleName?: string;
  moduleInputs?: Record<string, unknown>;
}

/** Top-level nested entity form configuration — authored by the builder, consumed by the renderer. */
export interface EntityFormConfig {
  entity: string;
  /** Consumer-facing config schema version (drives `migrateConfig`). */
  version?: number;
  name?: LocalizedText;
  isSystemDefined?: boolean;
  maskData?: boolean;
  permissions?: EntityPermissions;
  defaultLanguage?: string;
  tabs: NestedTabConfig[];
}

// ─── Rules ──────────────────────────────────────────────────────────────────

export type RuleActionType = 'visibility' | 'validation' | 'info';
export type RuleCompareType = 'value' | 'field';

export type RuleOperator =
  | 'EQUAL'
  | 'NOT_EQUAL'
  | 'CONTAINS'
  | 'NOT_CONTAINS'
  | 'STARTS_WITH'
  | 'ENDS_WITH'
  | 'IS_EMPTY'
  | 'IS_NOT_EMPTY'
  | 'LESS_THAN'
  | 'MORE_THAN'
  | 'LESS_THAN_EQUAL'
  | 'MORE_THAN_EQUAL'
  | 'DATE_BEFORE'
  | 'DATE_AFTER'
  | 'IN'
  | 'NOT_IN'
  | 'HAS_ITEMS'
  | 'VALUE_CHANGED';

export interface RuleCondition {
  operator: RuleOperator;
  value?: unknown;
  compareType: RuleCompareType;
  /** Dot-path for field-to-field comparison when `compareType === 'field'`. */
  compareToField?: string;
}

export interface RuleAction {
  type: RuleActionType;
  /** `false`=hide | `true`=show for visibility; message text for validation/info. */
  value: boolean | string;
  /** Used by `validation`; `info` is always a dismissible banner. */
  severity?: 'error' | 'warning';
}

export interface RuleTarget {
  id: string;
  type: 'field' | 'tab';
}

export interface FormRule {
  id?: string;
  formConfigId: string;
  /** Trigger field id. */
  fieldId: string;
  conditions: RuleCondition[];
  action: RuleAction;
  targets: RuleTarget[];
  enabled: boolean;
  priority: number;
}

/** Result of evaluating a config's rules against a record's form values. */
export interface RuleEvaluationResult {
  hiddenFields: string[];
  hiddenTabs: string[];
  validationErrors: Record<string, string>;
  validationWarnings: Record<string, string>;
  infoBanners: Record<string, string>;
}
