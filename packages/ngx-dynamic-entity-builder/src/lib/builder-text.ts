import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { resolveUiText, type UiTextOverridesFor, type UiTextParams } from 'ngx-dynamic-entity';

/**
 * Every word the builder puts on screen that is not part of the config being authored.
 *
 * The renderer has its own list (`DEFAULT_UI_TEXT`) and the two are deliberately separate:
 * an application that ships only the renderer should not see a hundred and fifty builder
 * keys in completion, and the two vocabularies share no strings worth deduplicating. What
 * they do share is the resolution rule, which comes from `resolveUiText`.
 *
 * Keys are grouped by panel, because a translator works screen by screen.
 */
export const DEFAULT_BUILDER_TEXT = {
  // Toolbar and page chrome
  builderTitle: 'Entity Builder',
  undo: 'Undo',
  undoTooltip: 'Undo (Ctrl+Z)',
  redo: 'Redo',
  redoTooltip: 'Redo (Ctrl+Shift+Z)',
  issuesTooltip: '{count} issue(s) — hover items in the list',
  copyJson: 'Copy JSON',
  save: 'Save',

  // Entity settings panel
  entityName: 'Entity name',
  entityNamePlaceholder: 'e.g. clients',
  editingLanguage: 'Editing language',
  maskEntity: 'Mask this entity (RBAC)',
  permissions: 'Permissions',
  actionRoles: '{action} roles',
  actionRolesPlaceholder: '{action} roles (comma-separated)',
  permissionsHint: 'Empty = no restriction for that action.',
  addField: 'Add field',
  fieldProperties: 'Field properties',
  configJson: 'Config JSON',

  // Canvas
  fieldsHeading: 'Fields ({count})',
  canvasEmpty: 'No fields yet. Pick a type from Add field to get started.',

  // Field rows in the tree
  selectField: 'Select field {field}',
  dragToReorder: 'Drag to reorder (or use the move buttons)',
  referencedFieldTooltip: 'Referenced field (linked to {entity})',
  driftDetected: 'Drift detected: source field has evolved',
  required: 'Required',
  moveUp: 'Move up',
  moveDown: 'Move down',
  duplicate: 'Duplicate',
  delete: 'Delete',
  moveFieldUp: 'Move {field} up',
  moveFieldDown: 'Move {field} down',
  duplicateField: 'Duplicate {field}',

  // Field inspector — identity
  inspectorEmpty: 'Select a field to edit its properties.',
  fieldId: 'Field id',
  fieldIdFixedHint: 'The stored data key for this saved field — fixed.',
  fieldIdDerivedHint: 'Derived from the label. Used as the data key.',
  tab: 'Tab',
  tabMoveHint: 'Moving the field rewrites its path and repoints the rules that named it.',
  labelInLanguage: 'Label ({language})',
  placeholderInLanguage: 'Placeholder ({language})',
  defaultValue: 'Default value',
  validation: 'Validation',

  // Field inspector — options
  dataSource: 'Data source',
  optionsComeFrom: 'Options come from',
  optionsSourceNone: 'Nothing yet',
  optionsSourceInline: 'Options authored here',
  optionsSourceList: 'A named list',
  listName: 'List name',
  listNameHint: 'The consuming app resolves this name through its lookup registry. Options are not authored here.',
  options: 'Options',
  option: 'Option',
  optionInLanguage: 'Option ({language})',
  removeOption: 'Remove option',
  noOptionsYet: 'No options yet — add at least one.',

  // Field inspector — display flags
  display: 'Display',
  visible: 'Visible',
  tableColumn: 'Table column',
  readOnly: 'Read-only',
  disabled: 'Disabled',
  maskData: 'Mask data (RBAC)',
  criticalField: 'Critical field',
  criticalFieldTooltip: 'Renders locked; editing it announces a change against the session baseline.',
  showInSummary: 'Show in summary',
  showInSummaryTooltip: "Shown in the record editor's summary panel.",

  // Field inspector — conditional visibility
  showWhen: 'Show when',
  condition: 'Condition',
  watchedField: 'Watched field',
  equals: 'Equals',
  removeCondition: 'Remove condition',
  alwaysVisibleHint: 'Always visible. Add a condition to show this field only for certain values.',

  // Field inspector — copy on true
  copyOnTrue: 'Copy on true',
  mapping: 'Mapping',
  fromField: 'From field',
  toField: 'To field',
  removeMapping: 'Remove mapping',
  copyOnTrueHint: "When this flips to true, copy one field's value into another.",

  // Rules list
  rules: 'Rules',
  rule: 'Rule',
  noRulesOnField: 'No rules on this field.',
  rulePriority: 'priority {priority} · {targets} target(s)',
  toggleRule: 'Enable / disable',
  moveRuleUp: 'Move rule up',
  moveRuleDown: 'Move rule down',
  editRule: 'Edit rule',
  deleteRule: 'Delete rule',

  // Rule form
  newRuleTitle: 'New Form Rule',
  editRuleTitle: 'Edit Rule',
  triggerField: 'Trigger Field',
  applyToFields: 'Apply to fields',
  conditions: 'Conditions',
  operator: 'Operator',
  value: 'Value',
  conditionValuePlaceholder: 'Condition value',
  addCondition: 'Add Condition',
  action: 'Action',
  actionType: 'Action Type',
  actionVisibility: 'Visibility (Show/Hide)',
  actionValidationMessage: 'Validation Message',
  actionInfoBanner: 'Info Banner',
  valueOrMessage: 'Value / Message',
  valueOrMessagePlaceholder: 'false to hide, or message text',
  cancel: 'Cancel',
  saveRule: 'Save Rule',

  // Tab manager
  tabsManager: 'Tabs Manager',
  systemTag: '(System)',
  addTab: 'Add Tab',
  noTabs: 'No tabs — all fields render in a single section.',
  flatData: 'Flat Data',
  primaryTab: 'Primary Tab',
  maskTabData: 'Mask Tab Data',
  systemDefault: 'System Default',
  addSubTab: '+ Sub-tab',
  consumerModuleName: 'Consumer Module Name (Optional)',
  consumerModulePlaceholder: 'e.g. documents-view',
  subTabs: 'Sub-tabs:',
  moveTabUp: 'Move tab up',
  moveTabDown: 'Move tab down',
  removeTab: 'Remove tab',
  removeSubTab: 'Remove sub-tab',

  // Entity reference panel
  entityReference: 'Entity reference',
  registryKey: 'Registry key',
  registryKeyHint: 'Key the consumer registered a loader under. Defaults to the field id.',
  displayFields: 'Display fields',
  displayFieldsHint: 'Comma-separated record paths used to build each option label.',
  staticFilters: 'Static filters (JSON)',
  staticFiltersHint: 'Passed to the loader, e.g. &#123;"isEmployee": false&#125;.',
  cascade: 'Cascade',
  parentField: 'Parent field',
  parentFieldNone: 'None — load all options',
  cascadeHint: "This field's options reload whenever the parent changes.",
  lookupFilterPath: 'Lookup filter path',
  lookupFilterPathHint: 'Keep options whose record matches the parent value at this path.',
  lookupPath: 'Lookup path (nested options)',
  lookupPathHint: "Take options from this array on the selected parent's record instead.",
  autoPatchOnSelect: 'Auto-patch on select',
  targetTab: 'Target tab',
  sourceLinkedRecord: 'Source (linked record)',
  targetField: 'Target field',
  noAutoPatch: 'No auto-patch configured — selecting a reference will not copy any values.',

  // Referenced-field panel
  referencedField: 'Referenced Field',
  link: 'Link',
  sourceEntityKey: 'Source Entity Key',
  sourceEntityKeyPlaceholder: 'e.g. individuals',
  sourceFieldId: 'Source Field ID',
  sourceFieldIdPlaceholder: 'e.g. firstName',
  driftHeading: 'Source field definition has drifted!',
  driftBody: 'The upstream field configuration in "{entity}" has evolved.',
  syncWithSource: 'Sync with Source',
};

/** The keys above, as a union — checked in templates, completed in a host's overrides. */
export type BuilderTextKey = keyof typeof DEFAULT_BUILDER_TEXT;

/** Same contract as the renderer's `UI_TEXT`, over the builder's vocabulary. */
export type BuilderTextOverrides = UiTextOverridesFor<BuilderTextKey>;

/**
 * Overrides for the builder's own chrome.
 *
 * Accepts what `UI_TEXT` accepts: a partial map whose values are strings or `LocalizedText`
 * (`{ en, de }`), or a resolver `(key, defaultText, language) => string` for a host with an
 * existing i18n layer. `DEFAULT_BUILDER_TEXT` is the full key list with its English source
 * strings; anything left out keeps its default.
 *
 * @example
 * { provide: BUILDER_TEXT, useValue: { save: { en: 'Save', de: 'Speichern' } } }
 */
export const BUILDER_TEXT = new InjectionToken<BuilderTextOverrides>('BUILDER_TEXT');

/**
 * Resolves the builder's own UI text.
 *
 * The language lives on the service rather than travelling through every template call,
 * because the builder already has a *different* language on screen: `activeLanguage()`
 * selects the `LocalizedText` entry being **authored**. Passing that one to the chrome
 * would flip the builder's own interface every time an author switched the label language
 * they were editing, which is the opposite of what it means.
 *
 * Root-provided and therefore shared: two builders mounted at once show one chrome
 * language. `EntityBuilderComponent`'s `uiLanguage` input is what sets it.
 */
@Injectable({ providedIn: 'root' })
export class BuilderTextService {
  private readonly overrides = inject(BUILDER_TEXT, { optional: true });

  /** The chrome language. Not the authoring language — see the class comment. */
  readonly language = signal('en');

  /** One label by key. `params` fill the `{placeholder}` slots. */
  text(key: BuilderTextKey, params?: UiTextParams): string {
    return resolveUiText(this.overrides, DEFAULT_BUILDER_TEXT, key, this.language(), params);
  }
}
