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

/**
 * A dropdown / radio / multiSelect option: a language-keyed object, plus an optional stable
 * key. The whole object is what a record stores — there is no separate value/label wrapper,
 * and no generic on the field for an open-typed `value`.
 *
 *   { $key: 'active', en: 'Active', de: 'Aktiv' }
 *
 * ### `$key` — identity, as distinct from text
 *
 * Without a key the displayed text *is* the identity, so renaming an option in the builder
 * ("Active" → "Enabled") orphans every record already saved as `{ en: 'Active' }`: the old
 * object stops matching any current option and falls back to displaying its stored text.
 * `$key` is what separates the two. When **both** sides of a comparison carry one, the key
 * decides and the text is display only, so a rename is free. When either side lacks one,
 * matching is exactly what 1.x did — so old records and keyless configs are unaffected, and
 * this is additive at the data layer.
 *
 * It lives inside the same object rather than in a `{ key, label }` wrapper because a
 * wrapper changes the shape of the value every existing consumer already has in its
 * database. The cost, stated plainly: a language map with one non-language key in it. `$`
 * cannot begin a BCP-47 subtag, so the namespace is safe, `validateConfig` rejects any other
 * `$`-prefixed key, and every read of the translations goes through `languageEntries` so the
 * key is never mistaken for one.
 *
 * **Keys are authored, never invented at runtime.** The builder mints one when an option is
 * created and never rewrites it on rename — that is the whole point. `normalizeLookupValues`
 * projects a list value's `code ?? _id`. `normalizeOption` preserves what it is given and
 * mints nothing: two deployments normalising the same config must not disagree about what an
 * option is called. To key an existing config, run `optionKeyMigration` over its records.
 */
export type DropdownOption = LocalizedText & { $key?: string };

/**
 * What a *raw* option may look like before `normalizeField` runs — configs written against
 * older shapes, or hand-authored JSON. Wide on input, single shape once normalised.
 * Never use this as the type of `NestedFieldConfig.options`.
 */
export type RawDropdownOption =
  | LocalizedText
  | { value: unknown; label: LocalizedText | string }
  | string
  | number;

/** Full field-type vocabulary supported by the rich renderer. */
export type RichFieldType =
  | 'text'
  | 'textarea'
  | 'markdown'
  | 'number'
  | 'currency'
  | 'email'
  | 'password'
  | 'date'
  | 'datetime'
  | 'time'
  | 'monthYear'
  | 'dropdown'
  | 'radio'
  | 'checkbox'
  | 'boolean'
  | 'multiSelect'
  | 'entity-ref'
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
  /**
   * Built-in email format check.
   *
   * Separate from `pattern` on purpose. The builder used to express "email" by writing a
   * regex into `pattern`, which meant a field could not have both, setting a custom pattern
   * made the Email box appear ticked, and un-ticking Email deleted the custom pattern.
   */
  email?: boolean;
  /**
   * Names of validators registered through `provideNgxDynamicEntity({ validators })`.
   *
   * Without this, a custom validator was reachable only through the untyped `string[]` form
   * of this config, so naming one from a typed schema required an `as any` cast.
   */
  custom?: string[];
  /**
   * Names of async validators registered through
   * `provideNgxDynamicEntity({ asyncValidators })` — uniqueness checks and anything else
   * needing a server. Kept separate from `custom` because Angular runs async validators only
   * after the synchronous ones pass, and marks the control `pending` meanwhile.
   */
  customAsync?: string[];
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
  /**
   * Present only on snapshots taken after listName drift was supported. Drift compares it
   * solely when the key exists, so an older snapshot is not reported as drifted merely for
   * predating the field.
   */
  listName?: string;
}

/** A field in the nested form model. `group`/`array` carry `children`. */
export interface NestedFieldConfig {
  id: string;
  type: RichFieldType;
  label: LocalizedText;
  placeholder?: LocalizedText;
  /**
   * Help text shown under the control, and wired to it through `aria-describedby`.
   *
   * Distinct from `placeholder`, which the two are routinely confused: a placeholder is an
   * example of the value and *disappears the moment the user types*, so anything a person
   * needs while filling the field in — a format, a rule, where to find the number they are
   * being asked for — cannot live there. This is where that goes, and it stays on screen.
   *
   * Also distinct from a validation message, which says what went wrong after the fact. A
   * hint is what would have stopped it going wrong.
   */
  hint?: LocalizedText;
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
  /**
   * The field's address: the scopes its value nests under, then its id — `work.address`, or
   * `primaryDetails.companyId`.
   *
   * This is both where the value binds in the record and which field a reference means, and
   * those are the same thing: a field *is* its position in the record. Ids are unique per
   * scope, so a bare id is not an identity — `address` can exist on Personal Details and on
   * Work Details — but the path names exactly one field.
   *
   * Maintained rather than derived at the point of use. `assignFieldRefs` fills it in where
   * it is absent, the builder restamps after every structural edit, and a move rewrites both
   * the path and every rule that pointed at it. An explicitly authored value is never
   * overwritten, so it stays usable as a deliberate binding override.
   *
   * A rule addresses a field by wrapping it in brackets, `[work.address]`; a bare name is a
   * legacy field id, so configs and rules written before paths existed keep working.
   */
  refererField?: string;
  /**
   * Named list key for dropdown/multiSelect options, instead of inline `options`.
   * Resolved through `LOOKUP_REGISTRY`; inline `options` win when both are present.
   */
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
  /** Consumer-facing config schema version. */
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
  /**
   * Application order, **ascending — so the highest number is applied last and wins.**
   *
   * It matters only for `validation` and `info` actions, which are keyed by target: two
   * rules writing a message for the same field leave the higher-priority one's message. The
   * hidden and shown lists accumulate, so priority does not affect visibility at all.
   */
  priority: number;
}

/** Result of evaluating a config's rules against a record's form values. */
export interface RuleEvaluationResult {
  /** Fields a rule hid. A hide always wins, over both static visibility and a `show` rule. */
  hiddenFields: string[];
  /** Tabs a rule hid, under the same precedence. */
  hiddenTabs: string[];
  /**
   * Fields a rule *showed* — `{ type: 'visibility', value: true }`.
   *
   * **Precedence.** A show overrides static hiding: a field carrying `visibility: false`, or
   * a `showWhen` that does not currently hold, renders anyway while a show rule names it.
   * That is the point of the action — a rule that could only ever hide something already
   * hidden has nothing to say. An explicit hide beats a show, whichever order the two rules
   * are in, because refusing to show something is the safer of the two mistakes.
   *
   * Static visibility is therefore weaker than a rule, and a show rule is weaker than a hide
   * rule. Nothing below this is ambiguous: every field is in exactly one of the three states.
   */
  shownFields: string[];
  /** Tabs a rule showed, under the same precedence. */
  shownTabs: string[];
  /** Keyed by target id — the last rule to write one wins; see `FormRule.priority`. */
  validationErrors: Record<string, string>;
  validationWarnings: Record<string, string>;
  infoBanners: Record<string, string>;
}
