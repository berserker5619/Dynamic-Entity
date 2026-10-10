/**
 * problem-fixtures.ts — one deliberately broken config or plan per check.
 *
 * Every check `validateConfig` and `validateMappingPlan` makes (inventoried in
 * `docs/de-2.4-problem-codes.md`) has a case here, named after the check and tagged with the
 * code it must produce. A check reached from several call sites has a case for more than one of
 * them, because "same check, same code" is exactly what those cases hold.
 *
 * Plain data with type-only imports, so it runs anywhere: core's coverage spec uses it, and so
 * does a script that feeds the same cases to a published 2.3.1 to show 2.4's messages and
 * `formatConfigProblems` output are unchanged.
 *
 * Not under `src/`, so neither published nor counted by the coverage gate.
 */

import type {
  ConfigProblemCode,
  EntityFormConfig,
  FormRule,
  NestedFieldConfig,
  PlanProblemCode,
  ValidateConfigOptions,
} from '../src/index';

export interface ConfigCase {
  name: string;
  code: ConfigProblemCode;
  config: unknown;
  options?: ValidateConfigOptions;
}

export interface PlanCase {
  name: string;
  code: PlanProblemCode;
  plan: unknown;
  config: EntityFormConfig;
}

const text = (id: string, extra: Record<string, unknown> = {}): NestedFieldConfig =>
  ({ id, type: 'text', label: { en: id }, ...extra }) as NestedFieldConfig;
const typed = (type: string, extra: Record<string, unknown> = {}): NestedFieldConfig =>
  ({ id: 'f', type, label: { en: 'F' }, ...extra }) as NestedFieldConfig;

/** One tab, `main`, holding `fields`. */
const one = (fields: unknown[], extra: Record<string, unknown> = {}): unknown => ({
  entity: 'e',
  tabs: [{ id: 'main', label: { en: 'Main' }, fields }],
  ...extra,
});
const tabs = (...list: unknown[]): unknown => ({ entity: 'e', tabs: list });
const tab = (id: string, fields: unknown[] = [text('a')], extra: Record<string, unknown> = {}): unknown => ({
  id,
  label: { en: id },
  fields,
  ...extra,
});

/** A sound config to hang rules on: `main.name`. */
const RULED = one([text('name')]) as EntityFormConfig;
const rule = (over: Partial<FormRule> | Record<string, unknown> = {}): FormRule =>
  ({
    formConfigId: 'e',
    fieldId: 'name',
    conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'x' }],
    action: { type: 'visibility', value: false },
    targets: [{ id: 'name', type: 'field' }],
    enabled: true,
    priority: 1,
    ...over,
  }) as FormRule;
const ruled = (name: string, code: ConfigProblemCode, rules: unknown[]): ConfigCase => ({
  name,
  code,
  config: RULED,
  options: { rules: rules as FormRule[] },
});

const phones = (extra: Record<string, unknown> = {}): NestedFieldConfig =>
  ({ id: 'phones', type: 'array', label: { en: 'Phone' }, children: [text('number')], ...extra }) as NestedFieldConfig;

export const CONFIG_CASES: readonly ConfigCase[] = [
  // The config itself
  { name: 'a config that is not an object', code: 'CONFIG_NOT_AN_OBJECT', config: null },
  { name: 'a blank entity name', code: 'CONFIG_ENTITY_REQUIRED', config: one([text('a')], { entity: '  ' }) },
  { name: 'a version below 1', code: 'CONFIG_INVALID_VERSION', config: one([text('a')], { version: 0 }) },
  { name: 'no tabs', code: 'CONFIG_NO_TABS', config: { entity: 'e', tabs: [] } },

  // Fields
  { name: 'a field that is not an object', code: 'CONFIG_FIELD_NOT_OBJECT', config: one([null]) },
  { name: 'a field with no id', code: 'CONFIG_FIELD_ID_REQUIRED', config: one([{ type: 'text', label: { en: 'x' } }]) },
  { name: 'a field named __proto__', code: 'CONFIG_RESERVED_FIELD_ID', config: one([text('__proto__')]) },
  { name: 'a field id with a space', code: 'CONFIG_FIELD_ID_NOT_IDENTIFIER', config: one([text('has space')]) },
  { name: 'one id twice in a scope', code: 'CONFIG_DUPLICATE_FIELD_ID', config: one([text('a'), text('a')]) },
  { name: 'a field with no type', code: 'CONFIG_FIELD_TYPE_REQUIRED', config: one([{ id: 'a', label: { en: 'a' } }]) },
  { name: 'a type not in the catalog', code: 'CONFIG_UNKNOWN_FIELD_TYPE', config: one([typed('signature')]) },
  { name: 'a field with no label', code: 'CONFIG_FIELD_NO_LABEL', config: one([{ id: 'a', type: 'text' }]) },
  { name: 'a group with no children', code: 'CONFIG_CONTAINER_NO_CHILDREN', config: one([typed('group')]) },
  { name: 'children on a text field', code: 'CONFIG_CHILDREN_IGNORED', config: one([text('a', { children: [text('b')] })]) },
  {
    name: 'inline options and a listName',
    code: 'CONFIG_OPTIONS_AND_LIST_NAME',
    config: one([typed('dropdown', { options: [{ en: 'A' }], listName: 'statuses' })]),
  },
  { name: 'a step of 0', code: 'CONFIG_INVALID_STEP', config: one([typed('slider', { step: 0 })]) },
  {
    name: 'a slider whose max is its min',
    code: 'CONFIG_SLIDER_RANGE_EMPTY',
    config: one([typed('slider', { validators: { min: 5, max: 5 } })]),
  },
  { name: 'a colSpan of 13', code: 'CONFIG_INVALID_COL_SPAN', config: one([text('a', { colSpan: 13 })]) },
  { name: 'required on the field', code: 'CONFIG_FIELD_LEVEL_REQUIRED', config: one([text('a', { required: true })]) },
  { name: 'group children that are not an array', code: 'CONFIG_CHILDREN_NOT_ARRAY', config: one([typed('group', { children: 7 })]) },

  // Validators
  { name: 'an empty pattern', code: 'CONFIG_PATTERN_NOT_STRING', config: one([text('a', { validators: { pattern: '' } })]) },
  { name: 'a pattern that does not compile', code: 'CONFIG_INVALID_PATTERN', config: one([text('a', { validators: { pattern: '(' } })]) },
  {
    name: 'min above max',
    code: 'CONFIG_MIN_EXCEEDS_MAX',
    config: one([typed('number', { validators: { min: 5, max: 1 } })]),
  },
  {
    name: 'minLength above maxLength',
    code: 'CONFIG_MIN_LENGTH_EXCEEDS_MAX_LENGTH',
    config: one([text('a', { validators: { minLength: 5, maxLength: 1 } })]),
  },
  {
    name: 'custom validators that are not a list',
    code: 'CONFIG_VALIDATOR_LIST_NOT_ARRAY',
    config: one([text('a', { validators: { custom: 'noDisposable' } })]),
    options: { knownValidators: [] },
  },
  {
    name: 'a blank validator name',
    code: 'CONFIG_VALIDATOR_NAME_INVALID',
    config: one([text('a', { validators: { customAsync: [''] } })]),
    options: { knownValidators: [] },
  },
  {
    name: 'a validator nothing registered',
    code: 'CONFIG_UNKNOWN_VALIDATOR',
    config: one([text('a', { validators: { custom: ['noDisposable'] } })]),
    options: { knownValidators: [] },
  },

  // Default values: one check, four field kinds
  { name: 'a text default on a number', code: 'CONFIG_DEFAULT_TYPE_MISMATCH', config: one([typed('number', { defaultValue: '5' })]) },
  { name: 'a text default on a boolean', code: 'CONFIG_DEFAULT_TYPE_MISMATCH', config: one([typed('boolean', { defaultValue: 'yes' })]) },
  { name: 'an upper-case colour default', code: 'CONFIG_DEFAULT_TYPE_MISMATCH', config: one([typed('color', { defaultValue: '#FF0000' })]) },
  { name: 'a text default on tags', code: 'CONFIG_DEFAULT_TYPE_MISMATCH', config: one([typed('tags', { defaultValue: 'a' })]) },

  // Options
  { name: 'an option that is a bare string', code: 'CONFIG_OPTION_NOT_OBJECT', config: one([typed('dropdown', { options: ['A'] })]) },
  {
    name: 'an option with a $-key other than $key',
    code: 'CONFIG_OPTION_RESERVED_KEY',
    config: one([typed('dropdown', { options: [{ en: 'A', $id: 'a' }] })]),
  },
  {
    name: 'a blank $key',
    code: 'CONFIG_OPTION_KEY_INVALID',
    config: one([typed('dropdown', { options: [{ en: 'A', $key: '' }] })]),
  },
  {
    name: 'two options with one $key',
    code: 'CONFIG_DUPLICATE_OPTION_KEY',
    config: one([typed('dropdown', { options: [{ en: 'A', $key: 'k' }, { en: 'B', $key: 'k' }] })]),
  },
  {
    name: 'two options that read the same',
    code: 'CONFIG_DUPLICATE_OPTION_LABEL',
    config: one([typed('dropdown', { options: [{ en: 'A' }, { en: 'A' }] })]),
  },

  // Tabs
  { name: 'a tab that is not an object', code: 'CONFIG_TAB_NOT_OBJECT', config: tabs(null) },
  { name: 'a tab with no id', code: 'CONFIG_TAB_ID_REQUIRED', config: tabs({ label: { en: 'x' }, fields: [text('a')] }) },
  { name: 'a tab named prototype', code: 'CONFIG_RESERVED_TAB_ID', config: tabs(tab('prototype')) },
  { name: 'one tab id twice', code: 'CONFIG_DUPLICATE_TAB_ID', config: tabs(tab('a', [text('x')]), tab('a', [text('y')])) },
  { name: 'a tab with nothing in it', code: 'CONFIG_EMPTY_TAB', config: tabs({ id: 'a', label: { en: 'a' } }) },
  { name: 'tab fields that are not an array', code: 'CONFIG_TAB_LIST_NOT_ARRAY', config: tabs(tab('a', 'x' as never)) },
  { name: 'sub-tabs that are not an array', code: 'CONFIG_TAB_LIST_NOT_ARRAY', config: tabs(tab('a', [text('x')], { children: 'x' })) },

  // References: every site `flagRef` serves, and both ways a reference can name nothing
  { name: 'a showWhen naming no field', code: 'CONFIG_UNKNOWN_FIELD_REF', config: one([text('a', { showWhen: { missing: true } })]) },
  {
    name: 'a showWhen path no field occupies',
    code: 'CONFIG_UNKNOWN_FIELD_REF',
    config: one([text('a', { showWhen: { '[main.nothing]': true } })]),
  },
  {
    name: 'a cascade parent naming no field',
    code: 'CONFIG_UNKNOWN_FIELD_REF',
    config: one([typed('entity-ref', { entityReference: { enabled: true, linkedEntityKey: 'c', parentField: 'missing' } })]),
  },
  {
    name: 'a patchOnTrue naming no field',
    code: 'CONFIG_UNKNOWN_FIELD_REF',
    config: one([typed('boolean', { patchOnTrue: [{ from: 'missing', to: 'f' }] })]),
  },
  {
    name: 'a showWhen naming an id two scopes define',
    code: 'CONFIG_AMBIGUOUS_FIELD_REF',
    config: tabs(
      tab('personal', [text('address')]),
      tab('work', [text('address'), text('note', { showWhen: { address: 'x' } })]),
    ),
  },
  {
    name: 'a patchOnTrue writing to __proto__',
    code: 'CONFIG_UNSAFE_PATH',
    config: one([text('name'), typed('boolean', { patchOnTrue: [{ from: 'name', to: '__proto__' }] })]),
  },
  {
    name: 'an autoPatch target of constructor',
    code: 'CONFIG_UNSAFE_PATH',
    config: one([text('a', { autoPatch: { mappings: [{ source: 'x', target: 'constructor' }] } })]),
  },
  { name: 'a refererField into __proto__', code: 'CONFIG_UNSAFE_PATH', config: one([text('a', { refererField: '__proto__.a' })]) },
  {
    name: 'an authored refererField inside an array',
    code: 'CONFIG_REFERER_INSIDE_ARRAY',
    config: one([phones({ children: [text('number', { refererField: 'primaryPhone' })] })]),
  },
  {
    name: 'a refererField on an array inside a group',
    code: 'CONFIG_REFERER_OVERRIDE_IGNORED',
    config: one([typed('group', { id: 'wrap', children: [phones({ refererField: 'contact.phones' })] })]),
  },

  // Rules
  ruled('a rule that is not an object', 'CONFIG_RULE_NOT_OBJECT', [null]),
  ruled('conditions that are not a list', 'CONFIG_RULE_LIST_NOT_ARRAY', [rule({ conditions: 'x' })]),
  ruled('targets that are not a list', 'CONFIG_RULE_LIST_NOT_ARRAY', [rule({ targets: 'x' })]),
  ruled('a rule with no action', 'CONFIG_RULE_ACTION_REQUIRED', [rule({ action: undefined })]),
  ruled('an action type the engine has no branch for', 'CONFIG_UNKNOWN_RULE_ACTION', [rule({ action: { type: 'hide', value: true } })]),
  ruled('a rule with no targets', 'CONFIG_RULE_NO_TARGETS', [rule({ targets: [] })]),
  ruled('a condition that is not an object', 'CONFIG_CONDITION_NOT_OBJECT', [rule({ conditions: [null] })]),
  ruled('a misspelt operator', 'CONFIG_UNKNOWN_RULE_OPERATOR', [
    rule({ conditions: [{ operator: 'EQUALS', compareType: 'value', value: 1 }] }),
  ]),
  ruled('compareType field with no compareToField', 'CONFIG_COMPARE_FIELD_REQUIRED', [
    rule({ conditions: [{ operator: 'EQUAL', compareType: 'field' }] }),
  ]),
  ruled('a rule triggered by no field', 'CONFIG_UNKNOWN_FIELD_REF', [rule({ fieldId: 'missing' })]),
  ruled('a compareToField naming no field', 'CONFIG_UNKNOWN_FIELD_REF', [
    rule({ conditions: [{ operator: 'EQUAL', compareType: 'field', compareToField: 'missing' }] }),
  ]),
  ruled('a rule targeting no field', 'CONFIG_UNKNOWN_FIELD_REF', [rule({ targets: [{ id: 'missing', type: 'field' }] })]),
  ruled('a rule targeting no tab', 'CONFIG_UNKNOWN_TAB_REF', [rule({ targets: [{ id: 'missing', type: 'tab' }] })]),
  ruled('a validation action on a tab', 'CONFIG_TAB_ACTION_IGNORED', [
    rule({ action: { type: 'validation', value: 'Check this' }, targets: [{ id: 'main', type: 'tab' }] }),
  ]),
  ruled('a target that is neither field nor tab', 'CONFIG_UNKNOWN_TARGET_TYPE', [rule({ targets: [{ id: 'name', type: 'section' }] })]),
];

/** `main.name`, at config version 2. */
const PLANNED = { ...(one([text('name')]) as EntityFormConfig), version: 2 };
const planned = (entries: unknown, extra: Record<string, unknown> = {}): unknown => ({ entity: 'e', entries, ...extra });

/** A tab-level array moved by its override, so a 2.2 plan names it by its old address. */
const MOVED: EntityFormConfig = {
  entity: 'e',
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [phones({ refererField: 'contact.phones' })] }],
};

export const PLAN_CASES: readonly PlanCase[] = [
  { name: 'a plan that is not an object', code: 'PLAN_SHAPE', plan: null, config: PLANNED },
  { name: 'entries that are not a list', code: 'PLAN_SHAPE', plan: planned('nope'), config: PLANNED },
  { name: 'an entry that is not an object', code: 'PLAN_SHAPE', plan: planned([null]), config: PLANNED },
  { name: 'an entry with no ref', code: 'PLAN_SHAPE', plan: planned([{ column: 0 }]), config: PLANNED },
  { name: 'a plan for another entity', code: 'PLAN_TARGET_MISMATCH', plan: { ...(planned([{ ref: 'main.name', column: 0 }]) as object), entity: 'other' }, config: PLANNED },
  {
    name: 'a plan for an older config version',
    code: 'PLAN_TARGET_MISMATCH',
    plan: planned([{ ref: 'main.name', column: 0 }], { configVersion: 1 }),
    config: PLANNED,
  },
  { name: 'a 2.2 ref of a moved array', code: 'PLAN_LEGACY_REF', plan: planned([{ ref: 'phones.number', column: 0 }]), config: MOVED },
  { name: 'a ref no field has', code: 'PLAN_UNKNOWN_REF', plan: planned([{ ref: 'main.nope', column: 0 }]), config: PLANNED },
  { name: 'a ref into __proto__', code: 'PLAN_UNKNOWN_REF', plan: planned([{ ref: '__proto__.polluted', column: 0 }]), config: PLANNED },
  {
    name: 'one ref mapped twice',
    code: 'PLAN_DUPLICATE_REF',
    plan: planned([
      { ref: 'main.name', column: 0 },
      { ref: 'main.name', column: 1 },
    ]),
    config: PLANNED,
  },
  {
    name: 'an entry with a column and a constant',
    code: 'PLAN_SOURCE',
    plan: planned([{ ref: 'main.name', column: 0, constant: 'x' }]),
    config: PLANNED,
  },
  { name: 'an entry with neither', code: 'PLAN_SOURCE', plan: planned([{ ref: 'main.name' }]), config: PLANNED },
  { name: 'a negative column', code: 'PLAN_SOURCE', plan: planned([{ ref: 'main.name', column: -1 }]), config: PLANNED },
];

/** The moved-container configs `import-moved-containers.spec.ts` builds, as data. */
export const MOVED_CONTAINER_CONFIGS: readonly [string, EntityFormConfig][] = [
  ['a moved array', MOVED],
  [
    'a moved group',
    {
      entity: 'e',
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          flatData: true,
          fields: [typed('group', { id: 'addr', refererField: 'customer.address', children: [text('city')] })],
        },
      ],
    },
  ],
  ['an array override the form ignores', one([typed('group', { id: 'wrap', children: [phones({ refererField: 'contact.phones' })] })]) as EntityFormConfig],
  ['an authored override inside an array', one([phones({ children: [text('number', { refererField: 'primaryPhone' })] })]) as EntityFormConfig],
];
