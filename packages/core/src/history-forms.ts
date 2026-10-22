/**
 * history-forms.ts — what changed between two versions of a form's config.
 *
 * The same engine as record history, over a fixed schema for `EntityFormConfig` itself: tabs
 * keyed by id, fields keyed by id within each list, options keyed by `$key`, rules keyed by id.
 * A field moved to another tab reads as removed from one and added to the other; its id is
 * only unique within a list, so nothing else would be honest.
 */

import {
  describe,
  diffRecords,
  jsonSchemaAdapter,
  type Adapter,
  type Change,
  type DescribeOptions,
  type DiffOptions,
  type Sentence,
  type Template,
  type TemplateValues,
} from 'audit-trail-text';

import { optionKeyOf, resolveLabel } from './form-logic';
import type { EntityFormConfig, FormRule, NestedFieldConfig, NestedTabConfig } from './form-model.types';

type Doc = Record<string, unknown>;

const atomicText = (title: string): Doc => ({ title, type: 'object', 'x-atomic': true, 'x-label': '@lang' });
const text = (title: string): Doc => ({ title, type: 'string' });
const flag = (title: string): Doc => ({ title, type: 'boolean' });
const num = (title: string): Doc => ({ title, type: 'number' });

/**
 * The schema of a config, as `diffFormConfigs` normalises it. `name` is the label in the
 * config's default language: it names an item in a sentence and is never reported itself —
 * `label`, the whole language map, is.
 */
const FORM_SCHEMA: Doc = {
  title: 'Form',
  type: 'object',
  properties: {
    entity: text('Entity'),
    name: atomicText('Name'),
    version: num('Version'),
    defaultLanguage: text('Default language'),
    maskData: flag('Masked'),
    tabs: { $ref: '#/$defs/tabList' },
    rules: { $ref: '#/$defs/ruleList' },
    rulesValue: { title: 'Rules', type: 'string', 'x-sensitive': true },
  },
  $defs: {
    tabList: { title: 'Tabs', type: 'array', 'x-itemNoun': 'Tab', 'x-key': 'id', 'x-label': '{name}', items: { $ref: '#/$defs/tab' } },
    tab: {
      title: 'Tab',
      type: 'object',
      properties: {
        id: text('Id'),
        label: atomicText('Label'),
        visibility: flag('Visible'),
        flatData: flag('Flat data'),
        maskData: flag('Masked'),
        moduleName: text('Module'),
        fields: { $ref: '#/$defs/fieldList' },
        children: { $ref: '#/$defs/tabList' },
      },
    },
    fieldList: { title: 'Fields', type: 'array', 'x-itemNoun': 'Field', 'x-key': 'id', 'x-label': '{name}', items: { $ref: '#/$defs/field' } },
    field: {
      title: 'Field',
      type: 'object',
      properties: {
        id: text('Id'),
        label: atomicText('Label'),
        type: text('Type'),
        visibility: flag('Visible'),
        showWhen: text('Show when'),
        readonly: flag('Read-only'),
        disabled: flag('Disabled'),
        maskData: flag('Masked'),
        criticalField: flag('Critical'),
        refererField: text('Record path'),
        listName: text('Lookup list'),
        defaultValue: text('Default value'),
        validators: {
          title: 'Validators',
          type: 'object',
          properties: {
            required: flag('Required'),
            min: num('Minimum'),
            max: num('Maximum'),
            minLength: num('Minimum length'),
            maxLength: num('Maximum length'),
            pattern: text('Pattern'),
            email: flag('Email format'),
            url: flag('URL format'),
            phone: flag('Phone format'),
            custom: text('Custom validators'),
            customAsync: text('Async validators'),
          },
        },
        options: {
          title: 'Options',
          type: 'array',
          'x-itemNoun': 'Option',
          'x-key': 'key',
          'x-label': '{name}',
          items: { type: 'object', properties: { key: text('Key'), label: atomicText('Label') } },
        },
        children: { $ref: '#/$defs/fieldList' },
      },
    },
    ruleList: {
      title: 'Rules',
      type: 'array',
      'x-itemNoun': 'Rule',
      'x-key': 'id',
      'x-label': '{id}',
      items: {
        type: 'object',
        properties: {
          id: text('Id'),
          fieldId: text('Trigger field'),
          conditions: text('Conditions'),
          action: text('Action'),
          targets: text('Targets'),
          enabled: flag('Enabled'),
          priority: num('Priority'),
        },
      },
    },
  },
};

let formAdapter: Adapter | undefined;

export interface FormRules {
  /** The rules that went with the old config. */
  oldRules?: readonly FormRule[];
  /** The rules that go with the new config. */
  newRules?: readonly FormRule[];
}

export interface DiffFormConfigsOptions extends DiffOptions, FormRules {}

/**
 * The changes between two versions of a form's config, and optionally of its rules.
 *
 * - Tabs are matched by id, fields by id within their list, options by `$key`, else by their
 *   `value`, else by their label in the config's `defaultLanguage`. Rules are matched by id.
 * - Labels, validators, visibility and `showWhen` are reported as changes to the field.
 * - A field moved from one tab to another reads as removed from one and added to the other.
 * - If any rule in either version has no `id`, the rules are compared as one value and a
 *   change reads "Rules changed": a rule with no id cannot be followed across an edit.
 *
 * Read the result with `describeFormChanges`.
 */
export function diffFormConfigs(
  oldConfig: EntityFormConfig | null,
  newConfig: EntityFormConfig | null,
  options: DiffFormConfigsOptions = {},
): Change[] {
  const { oldRules, newRules, ...diffOptions } = options;
  const rulesAsValue = [oldRules, newRules].some(rules => rules?.some(rule => !rule?.id));
  formAdapter ??= jsonSchemaAdapter(FORM_SCHEMA);
  return diffRecords(
    oldConfig && formDocument(oldConfig, oldRules, rulesAsValue),
    newConfig && formDocument(newConfig, newRules, rulesAsValue),
    formAdapter,
    // Validators gained on a field read one by one ("Required set to Yes"), not as an object.
    { expandObjects: true, ...diffOptions },
  ).filter(change => !isNameChange(change));
}

/** `name` mirrors `label` in one language, so a change to it is always reported as the label's. */
function isNameChange(change: Change): boolean {
  const path = change.afterPath ?? change.beforePath ?? '';
  return change.code.startsWith('FIELD_') && /\/name$/.test(path) && path !== '/name';
}

/** A config as the form schema reads it. */
function formDocument(config: EntityFormConfig, rules: readonly FormRule[] | undefined, rulesAsValue: boolean): Doc {
  const lang = config.defaultLanguage ?? 'en';
  const doc: Doc = {
    entity: config.entity,
    name: textMap(config.name),
    version: config.version,
    defaultLanguage: config.defaultLanguage,
    maskData: config.maskData,
    tabs: (config.tabs ?? []).filter(tab => tab?.id).map(tab => tabDocument(tab, lang)),
  };
  if (rules) {
    if (rulesAsValue) doc['rulesValue'] = stableJson(rules);
    else doc['rules'] = rules.map(ruleDocument);
  }
  return doc;
}

function tabDocument(tab: NestedTabConfig, lang: string): Doc {
  return {
    id: tab.id,
    name: resolveLabel(tab.label, lang) || tab.id,
    label: textMap(tab.label),
    visibility: tab.visibility,
    flatData: tab.flatData,
    maskData: tab.maskData,
    moduleName: tab.moduleName,
    fields: (tab.fields ?? []).filter(field => field?.id).map(field => fieldDocument(field, lang)),
    children: (tab.children ?? []).filter(child => child?.id).map(child => tabDocument(child, lang)),
  };
}

function fieldDocument(field: NestedFieldConfig, lang: string): Doc {
  const v = field.validators;
  return {
    id: field.id,
    name: resolveLabel(field.label, lang) || field.id,
    label: textMap(field.label),
    type: field.type,
    visibility: field.visibility,
    showWhen: field.showWhen === undefined ? undefined : stableJson(field.showWhen),
    readonly: field.readonly,
    disabled: field.disabled,
    maskData: field.maskData,
    criticalField: field.criticalField,
    refererField: field.refererField,
    listName: field.listName,
    defaultValue: field.defaultValue === undefined ? undefined : stableJson(field.defaultValue),
    validators: v
      ? {
          ...v,
          custom: v.custom?.length ? v.custom.join(', ') : undefined,
          customAsync: v.customAsync?.length ? v.customAsync.join(', ') : undefined,
        }
      : undefined,
    options: optionDocuments(field.options as unknown[] | undefined, lang),
    children: (field.children ?? []).filter(child => child?.id).map(child => fieldDocument(child, lang)),
  };
}

/**
 * Options keyed by `$key`, else by the code a `{ value, label }` option stores, else by the
 * label in the default language. Two options that come to the same key are told apart by
 * position (`Open`, `Open #2`), so a duplicate never stops the diff.
 */
function optionDocuments(options: unknown[] | undefined, lang: string): Doc[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const seen = new Map<string, number>();
  return options.map(option => {
    const raw = option && typeof option === 'object' ? (option as Record<string, unknown>) : { en: String(option) };
    const labelSource = 'label' in raw ? raw['label'] : 'value' in raw ? raw['value'] : raw;
    const label = textMap(labelSource) ?? { [lang]: String(raw['value'] ?? '') };
    const name = resolveLabel(label, lang);
    const value = 'value' in raw && ['string', 'number'].includes(typeof raw['value']) ? String(raw['value']) : undefined;
    let key = optionKeyOf(raw) ?? value ?? name;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) key = `${key} #${count}`;
    return { key, name: count > 1 ? `${name} #${count}` : name, label };
  });
}

function ruleDocument(rule: FormRule): Doc {
  return {
    id: rule.id,
    fieldId: rule.fieldId,
    conditions: stableJson(rule.conditions ?? []),
    action: stableJson(rule.action ?? null),
    targets: stableJson(rule.targets ?? []),
    enabled: rule.enabled,
    priority: (rule as { priority?: number }).priority,
  };
}

function textMap(value: unknown): Record<string, string> | undefined {
  if (typeof value === 'string') return value ? { en: value } : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key.startsWith('$') && typeof entry === 'string') map[key] = entry;
  }
  return Object.keys(map).length ? map : undefined;
}

/** JSON with sorted keys, so two configs that differ only in key order compare equal. */
function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map(key => [key, sort((v as Record<string, unknown>)[key])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value)) ?? '';
}

// ─── Describing form changes ─────────────────────────────────────────────────

/** The items a change sits inside, outermost first: "Contact", "Status". */
function itemsAround(change: Change): string[] {
  return (change.display.itemLabels ?? []).map(index => change.labels[index]).filter(Boolean);
}

const prefixed = (change: Change, sentence: string): string => {
  const around = itemsAround(change);
  return around.length ? `${around.join(' › ')}: ${sentence}` : sentence;
};
/**
 * The tab or field an added, removed or reordered item belongs to. An item change's path ends
 * with the item itself ("Contact", "Phone"), so its parent is the one before it.
 */
const parentOf = (change: Change): string | undefined => {
  const around = itemsAround(change);
  return change.code === 'LIST_REORDERED' ? around.at(-1) : around.at(-2);
};

/** Sentences that name the tab or field a change is in, not the lists it passed through. */
export const formChangeMessages: Partial<Record<string, Template>> = {
  ITEM_ADDED: (change: Change, v: TemplateValues) => {
    const parent = parentOf(change);
    return `${v.itemNoun} "${v.item}" added${parent ? ` to ${parent}` : ''}`;
  },
  ITEM_REMOVED: (change: Change, v: TemplateValues) => {
    const parent = parentOf(change);
    return `${v.itemNoun} "${v.item}" removed${parent ? ` from ${parent}` : ''}`;
  },
  LIST_REORDERED: (change: Change, v: TemplateValues) => {
    const parent = parentOf(change);
    return `${v.list} reordered${parent ? ` in ${parent}` : ''}`;
  },
  FIELD_CHANGED: (change: Change, v: TemplateValues) => prefixed(change, `${v.field} changed from ${v.before} to ${v.after}`),
  'FIELD_CHANGED:redacted': (change: Change, v: TemplateValues) => prefixed(change, `${v.field} changed`),
  FIELD_SET: (change: Change, v: TemplateValues) => prefixed(change, `${v.field} set to ${v.after}`),
  'FIELD_SET:redacted': (change: Change, v: TemplateValues) => prefixed(change, `${v.field} set`),
  FIELD_CLEARED: (change: Change, v: TemplateValues) => prefixed(change, `${v.field} cleared (was ${v.before})`),
  'FIELD_CLEARED:redacted': (change: Change, v: TemplateValues) => prefixed(change, `${v.field} cleared`),
};

export interface DescribeFormChangesOptions extends DescribeOptions {
  /** The config the changes came from: its `defaultLanguage` is the default `language`. */
  config?: EntityFormConfig;
}

/**
 * One sentence per form change: "Field "Phone" added to Contact", "Contact › Phone: Label
 * changed from Phone to Mobile", "Option "Inactive" removed from Status". `messages` you pass
 * win over these.
 */
export function describeFormChanges(changes: readonly Change[], options: DescribeFormChangesOptions = {}): Sentence[] {
  const { config, messages, ...rest } = options;
  const language = rest.language ?? config?.defaultLanguage;
  return describe(changes, {
    ...rest,
    ...(language ? { language } : {}),
    messages: { ...(formChangeMessages as DescribeOptions['messages']), ...messages },
  });
}
