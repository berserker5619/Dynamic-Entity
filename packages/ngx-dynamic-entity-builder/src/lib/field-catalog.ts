import type { BuiltInFieldType, FieldConfig } from '@dynamic-entity/core';

/**
 * field-catalog.ts — the single source of truth for what the builder can create.
 *
 * Every buildable field type is described once here: its palette presentation, the
 * id prefix used when generating unique ids, which capabilities it exposes in the
 * inspector (options list, entity-ref key, param validators), and a factory that
 * produces a sensible default FieldConfig.
 *
 * This mirrors the render-side FieldRegistryService in ngx-dynamic-entity: the two
 * lists must agree on type strings. Adding a new built-in type = add an entry here
 * AND register a component in FieldRegistryService (keep both in the same change).
 */

/** Validators that take no parameter — rendered as toggles in the inspector. */
export type FlagValidator = 'required' | 'email';

/** Validators that take a numeric parameter — rendered as number inputs (compiled to `name:N`). */
export type ParamValidator = 'min' | 'max' | 'minLength' | 'maxLength';

export interface FieldTypeMeta {
  /** The type string stored on FieldConfig.type — must match the render-side registry. */
  type: BuiltInFieldType;
  /** Human label shown in the palette. */
  label: string;
  /** Material icon ligature name shown in the palette (requires the Material Icons font). */
  icon: string;
  /** One-line description shown as a tooltip / helper text. */
  description: string;
  /** Prefix used to generate unique field ids, e.g. 'text' -> text_1. Identifier-safe (no hyphens). */
  idPrefix: string;
  /** True for types backed by an inline options list (dropdown, multiSelect). */
  hasOptions: boolean;
  /** True for the entity-ref type, which needs a registry key rather than inline options. */
  isEntityRef: boolean;
  /** Flag validators offered in the inspector for this type. */
  flagValidators: FlagValidator[];
  /** Param validators offered in the inspector for this type. */
  paramValidators: ParamValidator[];
  /** Whether a free-text default value makes sense for this type. */
  supportsDefaultValue: boolean;
  /** Whether a placeholder makes sense (text-like/select inputs). */
  supportsPlaceholder: boolean;
}

export const FIELD_TYPE_CATALOG: readonly FieldTypeMeta[] = [
  {
    type: 'text',
    label: 'Text',
    icon: 'text_fields',
    description: 'Single-line text input',
    idPrefix: 'text',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required', 'email'],
    paramValidators: ['minLength', 'maxLength'],
    supportsDefaultValue: true,
    supportsPlaceholder: true,
  },
  {
    type: 'textarea',
    label: 'Text Area',
    icon: 'notes',
    description: 'Multi-line text input',
    idPrefix: 'textarea',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: ['minLength', 'maxLength'],
    supportsDefaultValue: true,
    supportsPlaceholder: true,
  },
  {
    type: 'number',
    label: 'Number',
    icon: 'tag',
    description: 'Numeric input',
    idPrefix: 'number',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: ['min', 'max'],
    supportsDefaultValue: true,
    supportsPlaceholder: true,
  },
  {
    type: 'checkbox',
    label: 'Checkbox',
    icon: 'check_box',
    description: 'Boolean toggle',
    idPrefix: 'checkbox',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'date',
    label: 'Date',
    icon: 'event',
    description: 'Date picker',
    idPrefix: 'date',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'dropdown',
    label: 'Dropdown',
    icon: 'arrow_drop_down_circle',
    description: 'Single-select from a fixed option list',
    idPrefix: 'dropdown',
    hasOptions: true,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: true,
  },
  {
    type: 'multiSelect',
    label: 'Multi-select',
    icon: 'checklist',
    description: 'Multi-select from a fixed option list',
    idPrefix: 'multiSelect',
    hasOptions: true,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'entity-ref',
    label: 'Entity Reference',
    icon: 'link',
    description: 'Reference to another entity (options loaded from a registry key)',
    idPrefix: 'entityRef',
    hasOptions: false,
    isEntityRef: true,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: true,
  },
  {
    type: 'array',
    label: 'Array',
    icon: 'data_array',
    description: 'Repeating group of values',
    idPrefix: 'array',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
] as const;

const CATALOG_BY_TYPE = new Map<string, FieldTypeMeta>(
  FIELD_TYPE_CATALOG.map(meta => [meta.type, meta]),
);

/** Look up metadata for a field type. Returns undefined for unknown/custom types. */
export function getFieldTypeMeta(type: string): FieldTypeMeta | undefined {
  return CATALOG_BY_TYPE.get(type);
}

/**
 * Turn a field id into a human default label.
 * 'firstName' -> 'First Name', 'text_1' -> 'Text 1', 'entityRef_2' -> 'Entity Ref 2'.
 */
export function humanizeId(id: string): string {
  const spaced = id
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim();
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Factory for a default FieldConfig of the given type.
 * Only shape known-good defaults here — the inspector edits everything else.
 *
 * @param type            buildable field type
 * @param id              unique field id (caller guarantees uniqueness)
 * @param defaultLanguage language key used for the initial label
 */
export function createFieldConfig(
  type: BuiltInFieldType,
  id: string,
  defaultLanguage = 'en',
): FieldConfig {
  const meta = getFieldTypeMeta(type);
  const field: FieldConfig = {
    id,
    type,
    label: { [defaultLanguage]: humanizeId(id) },
    validators: [],
    visible: true,
    tableColumn: type !== 'textarea' && type !== 'array',
  };
  if (meta?.hasOptions) {
    field.options = [];
  }
  if (type === 'checkbox') {
    field.defaultValue = false;
  }
  return field;
}
