import type { RichFieldType, NestedFieldConfig } from './form-model.types';

/**
 * field-catalog.ts — canonical single source of truth for field types
 * shared across core, renderer, and visual builder.
 */

export type FlagValidator = 'required' | 'email' | 'url' | 'phone';
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

export const FIELD_TYPE_CATALOG: FieldTypeMeta[] = [
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
    type: 'markdown',
    label: 'Markdown',
    icon: 'article',
    description: 'Long-form text stored as markdown source',
    idPrefix: 'markdown',
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
    description: 'Currency / money amount input',
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
    type: 'url',
    label: 'URL',
    icon: 'public',
    description: 'Web address (http or https)',
    idPrefix: 'url',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required', 'url'],
    paramValidators: ['minLength', 'maxLength'],
    supportsDefaultValue: true,
    supportsPlaceholder: true,
  },
  {
    type: 'phone',
    label: 'Phone',
    icon: 'phone',
    description: 'Phone number',
    idPrefix: 'phone',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required', 'phone'],
    paramValidators: [],
    supportsDefaultValue: true,
    supportsPlaceholder: true,
  },
  {
    type: 'slider',
    label: 'Slider',
    icon: 'tune',
    description: 'Number picked on a range',
    idPrefix: 'slider',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: ['min', 'max'],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'color',
    label: 'Color',
    icon: 'palette',
    description: 'Colour picker, stored as #rrggbb',
    idPrefix: 'color',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: true,
    supportsPlaceholder: false,
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
    type: 'time',
    label: 'Time',
    icon: 'access_time',
    description: 'Time of day, with no date',
    idPrefix: 'time',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'monthYear',
    label: 'Month & Year',
    icon: 'calendar_month',
    description: 'Month and year selector',
    idPrefix: 'monthYear',
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
    type: 'rating',
    label: 'Rating',
    icon: 'star',
    description: 'Star rating, 1 to max (default 5)',
    idPrefix: 'rating',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: ['min', 'max'],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'tags',
    label: 'Tags',
    icon: 'sell',
    description: 'Free-text list of labels',
    idPrefix: 'tags',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: ['minLength', 'maxLength'],
    supportsDefaultValue: false,
    supportsPlaceholder: true,
  },
  {
    type: 'entity-ref',
    label: 'Entity Reference',
    icon: 'link',
    description: 'Linked record reference selector',
    idPrefix: 'entityRef',
    hasOptions: false,
    isEntityRef: true,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: true,
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
  {
    type: 'image',
    label: 'Image Upload',
    icon: 'image',
    description: 'Image file attachment and preview',
    idPrefix: 'image',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
  {
    type: 'file',
    label: 'File Attachment',
    icon: 'attach_file',
    description: 'Document or general file attachment',
    idPrefix: 'file',
    hasOptions: false,
    isEntityRef: false,
    flagValidators: ['required'],
    paramValidators: [],
    supportsDefaultValue: false,
    supportsPlaceholder: false,
  },
];

/**
 * Lookup index over `FIELD_TYPE_CATALOG`.
 *
 * Built lazily and invalidated on registration rather than frozen at module evaluation.
 * An index frozen at load would hide every type registered afterwards from the builder's
 * palette and `createFieldConfig`.
 */
let catalogIndex: Map<string, FieldTypeMeta> | null = null;

function index(): Map<string, FieldTypeMeta> {
  if (!catalogIndex || catalogIndex.size !== FIELD_TYPE_CATALOG.length) {
    catalogIndex = new Map(FIELD_TYPE_CATALOG.map(meta => [meta.type, meta]));
  }
  return catalogIndex;
}

export function getFieldTypeMeta(type: string): FieldTypeMeta | undefined {
  return index().get(type);
}

/**
 * Register a custom field type so the builder's palette, `getFieldTypeMeta`, and
 * `createFieldConfig` know about it.
 *
 * This describes the type to the *authoring* side. The renderer still needs a component for
 * it, registered separately with `provideFieldTypes({ [type]: MyComponent })` — the two
 * registries are deliberately independent, so core stays free of any component reference.
 *
 * Re-registering an existing type replaces its metadata.
 */
export function registerFieldType(meta: FieldTypeMeta): void {
  const existing = FIELD_TYPE_CATALOG.findIndex(m => m.type === meta.type);
  if (existing >= 0) FIELD_TYPE_CATALOG[existing] = meta;
  else FIELD_TYPE_CATALOG.push(meta);
  catalogIndex = null;
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
  type: RichFieldType | 'entity-ref',
  id: string,
  defaultLanguage = 'en',
): NestedFieldConfig {
  const meta = getFieldTypeMeta(type);
  const inTable = type !== 'textarea' && type !== 'array' && type !== 'group';
  const field: NestedFieldConfig = {
    id,
    type: type as RichFieldType,
    label: { [defaultLanguage]: humanizeId(id) },
    validators: {},
    visibility: true,
    table: { visible: inTable },
  };
  if (meta?.hasOptions) {
    field.options = [];
  }
  if (type === 'entity-ref') {
    field.entityReference = { enabled: true, linkedEntityKey: '' };
  }
  if (type === 'checkbox' || type === 'boolean') {
    field.defaultValue = false;
  }
  if (type === 'group' || type === 'array') {
    field.children = [];
  }
  return field;
}
