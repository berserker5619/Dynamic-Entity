import type { RichFieldType, NestedFieldConfig } from '@dynamic-entity/core';

/**
 * field-catalog.ts — single source of truth for what the visual builder can create.
 */

export type FlagValidator = 'required' | 'email';
export type ParamValidator = 'min' | 'max' | 'minLength' | 'maxLength';

export interface FieldTypeMeta {
  type: RichFieldType;
  label: string;
  icon: string;
  description: string;
  idPrefix: string;
  hasOptions: boolean;
  isEntityRef: boolean;
  flagValidators: FlagValidator[];
  paramValidators: ParamValidator[];
  supportsDefaultValue: boolean;
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
    type: 'currency',
    label: 'Currency',
    icon: 'attach_money',
    description: 'Currency amount input',
    idPrefix: 'currency',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: ['min', 'max'],
    supportsDefaultValue: true,
    supportsPlaceholder: true,
  },
  {
    type: 'email',
    label: 'Email',
    icon: 'email',
    description: 'Email address input',
    idPrefix: 'email',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required', 'email'],
    paramValidators: [],
    supportsDefaultValue: true,
    supportsPlaceholder: true,
  },
  {
    type: 'password',
    label: 'Password',
    icon: 'lock',
    description: 'Masked password input',
    idPrefix: 'password',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: ['minLength', 'maxLength'],
    supportsDefaultValue: false,
    supportsPlaceholder: true,
  },
  {
    type: 'checkbox',
    label: 'Checkbox',
    icon: 'check_box',
    description: 'Boolean checkbox',
    idPrefix: 'checkbox',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'boolean',
    label: 'Boolean Toggle',
    icon: 'toggle_on',
    description: 'Switch toggle',
    idPrefix: 'boolean',
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
    type: 'datetime',
    label: 'Date & Time',
    icon: 'schedule',
    description: 'Date and time picker',
    idPrefix: 'datetime',
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
    description: 'Single-select from options',
    idPrefix: 'dropdown',
    hasOptions: true,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: true,
  },
  {
    type: 'radio',
    label: 'Radio Group',
    icon: 'radio_button_checked',
    description: 'Radio button group',
    idPrefix: 'radio',
    hasOptions: true,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'multiSelect',
    label: 'Multi-select',
    icon: 'checklist',
    description: 'Multi-select from options',
    idPrefix: 'multiSelect',
    hasOptions: true,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'group',
    label: 'Group',
    icon: 'folder',
    description: 'Nested group of fields',
    idPrefix: 'group',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: [],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'array',
    label: 'Array',
    icon: 'data_array',
    description: 'Repeating list of fields',
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

export function getFieldTypeMeta(type: string): FieldTypeMeta | undefined {
  return CATALOG_BY_TYPE.get(type);
}

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

export function createFieldConfig(
  type: RichFieldType,
  id: string,
  defaultLanguage = 'en',
): NestedFieldConfig {
  const meta = getFieldTypeMeta(type);
  const inTable = type !== 'textarea' && type !== 'array' && type !== 'group';
  const field: NestedFieldConfig = {
    id,
    type,
    label: { [defaultLanguage]: humanizeId(id) },
    validators: {},
    visibility: true,
    table: { visible: inTable },
  };
  if (meta?.hasOptions) {
    field.options = [];
  }
  if (type === 'checkbox' || type === 'boolean') {
    field.defaultValue = false;
  }
  if (type === 'group' || type === 'array') {
    field.children = [];
  }
  return field;
}
