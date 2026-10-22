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
 * The schema of a config, as `diffFormConfigs` normalises it.
 *
 * A tab, field or option is named by its `label`, the whole language map, so a stored change
 * carries the name in every language and reads in the reader's. The words around the names
 * ("Field", "Label", "Options") are plain English, so `translateLabel` can put them in any
 * language: a language map would be read as it is and never reach it.
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
    tabList: { title: 'Tabs', type: 'array', 'x-itemNoun': 'Tab', 'x-key': 'id', 'x-label': '{label}', items: { $ref: '#/$defs/tab' } },
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
    fieldList: { title: 'Fields', type: 'array', 'x-itemNoun': 'Field', 'x-key': 'id', 'x-label': '{label}', items: { $ref: '#/$defs/field' } },
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
          'x-label': '{label}',
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
  );
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
    let label = textMap(labelSource) ?? { [lang]: String(raw['value'] ?? '') };
    const value = 'value' in raw && ['string', 'number'].includes(typeof raw['value']) ? String(raw['value']) : undefined;
    let key = optionKeyOf(raw) ?? value ?? resolveLabel(label, lang);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) {
      key = `${key} #${count}`;
      label = Object.fromEntries(Object.entries(label).map(([language, text]) => [language, `${text} #${count}`]));
    }
    return { key, label };
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

/**
 * The sentences form history writes, one per change, as templates with tokens:
 *
 * - `{item}` the tab, field, option or rule added or removed, `{itemNoun}` what it is ("Field")
 * - `{parent}` the tab or field it belongs to, `{list}` the list it is in ("Fields")
 * - `{field}` the property that changed, `{before}` and `{after}` its values
 * - `{context}` the tab and field a property sits in: "Contact › Phone"
 *
 * Names are in the reader's language. A `FIELD_*` template without `{context}` gets
 * "{context}: " in front when there is one. A `:root` variant is used for an item with no
 * parent, such as a tab, and `:redacted` for the rules compared as one value.
 */
export type FormMessageKey =
  | 'ITEM_ADDED'
  | 'ITEM_ADDED:root'
  | 'ITEM_REMOVED'
  | 'ITEM_REMOVED:root'
  | 'LIST_REORDERED'
  | 'LIST_REORDERED:root'
  | 'FIELD_CHANGED'
  | 'FIELD_CHANGED:redacted'
  | 'FIELD_SET'
  | 'FIELD_SET:redacted'
  | 'FIELD_CLEARED'
  | 'FIELD_CLEARED:redacted'
  | 'RECORD_CREATED'
  | 'RECORD_DELETED';

/** English. An app adds a language by passing its own `messages`, as for record history. */
export const formChangeMessages: Readonly<Record<FormMessageKey, string>> = {
  ITEM_ADDED: '{itemNoun} "{item}" added to {parent}',
  'ITEM_ADDED:root': '{itemNoun} "{item}" added',
  ITEM_REMOVED: '{itemNoun} "{item}" removed from {parent}',
  'ITEM_REMOVED:root': '{itemNoun} "{item}" removed',
  LIST_REORDERED: '{list} reordered in {parent}',
  'LIST_REORDERED:root': '{list} reordered',
  FIELD_CHANGED: '{field} changed from {before} to {after}',
  'FIELD_CHANGED:redacted': '{field} changed',
  FIELD_SET: '{field} set to {after}',
  'FIELD_SET:redacted': '{field} set',
  FIELD_CLEARED: '{field} cleared (was {before})',
  'FIELD_CLEARED:redacted': '{field} cleared',
  RECORD_CREATED: 'Form created',
  RECORD_DELETED: 'Form deleted',
};

export interface DescribeFormChangesOptions extends Omit<DescribeOptions, 'messages'> {
  /** The config the changes came from: its `defaultLanguage` is the default `language`. */
  config?: EntityFormConfig;
  /** Templates that win over `formChangeMessages`: how an app words form history in its language. */
  messages?: Partial<Record<FormMessageKey, string>>;
}

/**
 * One sentence per form change, with every tab, field and option named in the reader's
 * `language` — by default the config's `defaultLanguage`:
 *
 *     Field "Phone" added to Contact
 *     Contact › Mobile: Label changed from Phone to Mobile
 *     Option "Inactive" removed from Status
 *
 * The wording is English unless `messages` say otherwise; `translateLabel` translates the
 * words around the names ("Field", "Label").
 */
export function describeFormChanges(changes: readonly Change[], options: DescribeFormChangesOptions = {}): Sentence[] {
  const { config, messages, ...rest } = options;
  const language = rest.language ?? config?.defaultLanguage ?? (rest.locale ?? 'en').split('-')[0];
  const fallback = rest.fallbackLanguage ?? 'en';
  const words: Record<string, string> = { ...formChangeMessages, ...messages };

  const sentence = (key: FormMessageKey, change: Change, v: TemplateValues): string => {
    const names = namesOf(change, language, fallback);
    const itemAt = change.display.itemLabels ?? [];
    const isItem = change.code === 'ITEM_ADDED' || change.code === 'ITEM_REMOVED';
    // An item change's path ends with the item itself; its parent is the item before it.
    const around = itemAt.filter(index => !(isItem && index === change.labels.length - 1)).map(index => names[index]);
    const tokens: Record<string, string> = {
      itemNoun: v.itemNoun,
      item: isItem ? (names[change.labels.length - 1] ?? v.item) : v.item,
      parent: around.at(-1) ?? '',
      list: v.list,
      field: v.field,
      before: v.before,
      after: v.after,
      context: around.join(' › '),
    };
    const root = !tokens['parent'] && (isItem || change.code === 'LIST_REORDERED');
    let template = words[root ? `${key}:root` : key] ?? words[key] ?? '';
    if (change.code.startsWith('FIELD_') && tokens['context'] && !template.includes('{context}')) {
      template = `{context}: ${template}`;
    }
    return template.replace(/\{(\w+)\}/g, (match, token: string) => tokens[token] ?? match);
  };

  const template =
    (key: FormMessageKey): Template =>
    (change, v) =>
      sentence(change.redacted && words[`${key}:redacted`] !== undefined ? (`${key}:redacted` as FormMessageKey) : key, change, v);

  return describe(changes, {
    ...rest,
    language,
    messages: {
      ITEM_ADDED: template('ITEM_ADDED'),
      ITEM_REMOVED: template('ITEM_REMOVED'),
      LIST_REORDERED: template('LIST_REORDERED'),
      FIELD_CHANGED: template('FIELD_CHANGED'),
      'FIELD_CHANGED:redacted': template('FIELD_CHANGED'),
      FIELD_SET: template('FIELD_SET'),
      'FIELD_SET:redacted': template('FIELD_SET'),
      FIELD_CLEARED: template('FIELD_CLEARED'),
      'FIELD_CLEARED:redacted': template('FIELD_CLEARED'),
      RECORD_CREATED: template('RECORD_CREATED'),
      RECORD_DELETED: template('RECORD_DELETED'),
    },
  });
}

/** Every label on a change's path in `language`, from the language maps stored with it. */
function namesOf(change: Change, language: string, fallback: string): string[] {
  const maps = change.display.i18n?.labels ?? [];
  return change.labels.map((label, index) => {
    const map = maps[index];
    return map ? pickLanguage(map, language, fallback) || label : label;
  });
}

/** The exact language, then its base (`de` for `de-CH`), then `fallback`, then the first there is. */
function pickLanguage(map: Record<string, string>, language: string, fallback: string): string {
  const keys = Object.keys(map).filter(key => !key.startsWith('$'));
  const find = (wanted: string) =>
    keys.find(key => key.toLowerCase() === wanted.toLowerCase()) ??
    keys.find(key => key.toLowerCase() === wanted.toLowerCase().split('-')[0]);
  const key = find(language) ?? find(fallback) ?? keys[0];
  return key === undefined ? '' : map[key];
}
