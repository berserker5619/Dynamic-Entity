/**
 * history-records.ts — what changed in a record, as structured changes and plain sentences.
 *
 * The diffing and the wording are `audit-trail-text`'s. What this file adds is the reading of
 * an `EntityFormConfig` as the JSON Schema that package takes, so a consumer never writes a
 * key-to-label map by hand: tabs, groups and arrays become nested objects and keyed lists in
 * exactly the shape DE saves, labels become language maps, and choice values are shown by
 * their option's label in the reader's language.
 *
 * Published from `@dynamic-entity/core/history`, not from the root entry: `audit-trail-text`
 * is ESM-only, and the root entry's CommonJS build must keep loading on every Node version an
 * app that never looks at history runs on.
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
} from 'audit-trail-text';

import { ROOT_SCOPE, isRefOverride } from './field-scopes';
import { resolveLabel } from './form-logic';
import type { EntityFormConfig, LocalizedText, NestedFieldConfig, NestedTabConfig } from './form-model.types';
import { applyRowIds, migrateRecord, type RecordMigration } from './migration';
import { ROW_ID_KEY } from './row-ids';

type Schema = Record<string, unknown>;

/** Field types whose stored value is a number. */
const NUMBER_TYPES = new Set(['number', 'currency', 'slider', 'rating']);
/** Field types whose stored value is a boolean. */
const BOOLEAN_TYPES = new Set(['boolean', 'checkbox']);
/** Field types that name a row best, in order of preference, for an array's item label. */
const LABEL_TYPES = ['text', 'email', 'phone', 'url', 'textarea'];

export interface EntityAuditAdapterOptions {
  /**
   * The language a label falls back to when a language map lacks the reader's. Default: the
   * config's `defaultLanguage`, else `en`.
   */
  language?: string;
}

/**
 * An `audit-trail-text` adapter for records of one config.
 *
 * - **Shape.** A tab nests under its id unless it sets `flatData`, a sub-tab nests under its
 *   parent, a `group` is an object and an `array` with `children` is a list of rows matched by
 *   `$rowId`, never by position, and named by its first text column.
 * - **Labels.** Every field, tab and the record itself carry their `LocalizedText` as an
 *   `x-title` language map, so one stored change reads in any language.
 * - **Choices.** `dropdown`, `radio` and `multiSelect` options authored as `{ value, label }`
 *   store the code, which is shown by its label. Options stored as language maps, and lookup
 *   lists, are compared as one value by `$key` and shown in the reader's language: renaming
 *   an option is not a change to the records that hold it.
 * - **Other values.** A file or image is one value keyed by its `url` and named by its file
 *   name. An `entity-ref` stores the referenced record's id, so it is compared and shown as
 *   that id. Dates, date-times, numbers and booleans are typed so they read as dates, digits
 *   and Yes / No.
 * - **Sensitive values.** A `password` field, and any field marked `maskData` — or sitting on
 *   a tab or a config marked `maskData` — is reported without its values.
 *
 * System fields (`_configVersion`, `_deletedAt`, `_id` and any other root key starting with
 * `_` that is not a field) and the second copy of a field moved by `refererField` are not in
 * the schema; `diffEntityRecords` ignores them. Diff rows that carry a `$rowId`: run
 * `applyRowIds` on both records first, as `diffEntityRecords` does.
 */
export function entityAuditAdapter(config: EntityFormConfig, options: EntityAuditAdapterOptions = {}): Adapter {
  return jsonSchemaAdapter(entitySchema(config, options));
}

/** The JSON Schema `entityAuditAdapter` reads. Exposed for inspection and for tests. */
export function entitySchema(config: EntityFormConfig, options: EntityAuditAdapterOptions = {}): Schema {
  const lang = options.language ?? config.defaultLanguage ?? 'en';
  const root: Schema = { type: 'object', ...titled(config.name, config.entity, lang), properties: {} };

  const walkTabs = (tabs: NestedTabConfig[] | undefined, container: Schema, masked: boolean) => {
    for (const tab of tabs ?? []) {
      if (!tab?.id) continue;
      const tabMasked = masked || !!tab.maskData;
      let target = container;
      if (!tab.flatData) {
        target = { type: 'object', ...titled(tab.label, tab.id, lang), properties: {} };
        propertiesOf(container)[tab.id] = target;
      }
      for (const field of tab.fields ?? []) {
        if (field?.id) propertiesOf(target)[field.id] = fieldSchema(field, tabMasked, lang);
      }
      walkTabs(tab.children, target, tabMasked);
    }
  };

  walkTabs(config.tabs, root, !!config.maskData);
  return root;
}

function fieldSchema(field: NestedFieldConfig, masked: boolean, lang: string): Schema {
  const sensitive = masked || !!field.maskData || field.type === 'password';
  const base: Schema = { ...titled(field.label, field.id, lang), ...(sensitive ? { 'x-sensitive': true } : {}) };
  const children = field.children ?? [];

  switch (field.type) {
    case 'group': {
      const properties: Record<string, Schema> = {};
      for (const child of children) if (child?.id) properties[child.id] = fieldSchema(child, sensitive, lang);
      return { ...base, type: 'object', properties };
    }
    case 'array': {
      if (!children.length) return { ...base, type: 'array', items: {} };
      const properties: Record<string, Schema> = { [ROW_ID_KEY]: { type: 'string' } };
      for (const child of children) if (child?.id) properties[child.id] = fieldSchema(child, sensitive, lang);
      const name = rowLabelField(children);
      return {
        ...base,
        type: 'array',
        'x-key': ROW_ID_KEY,
        'x-itemNoun': 'Row',
        ...(name ? { 'x-label': `{${name}}` } : {}),
        items: { type: 'object', properties },
      };
    }
    case 'dropdown':
    case 'radio':
      return { ...base, ...choiceSchema(field, lang) };
    case 'multiSelect':
      return { ...base, type: 'array', items: choiceSchema(field, lang) };
    case 'tags':
      return { ...base, type: 'array', items: { type: 'string' } };
    case 'file':
    case 'image':
      return { ...base, type: 'object', 'x-atomic': true, 'x-key': 'url', 'x-label': '{name}' };
    case 'date':
      return { ...base, type: 'string', format: 'date' };
    case 'datetime':
      return { ...base, type: 'string', format: 'date-time' };
    default:
      if (NUMBER_TYPES.has(field.type)) return { ...base, type: 'number' };
      if (BOOLEAN_TYPES.has(field.type)) return { ...base, type: 'boolean' };
      return { ...base, type: 'string' };
  }
}

/**
 * How a choice value is stored decides how it is read.
 *
 * Options authored as `{ value, label }` store the bare code (`"ENG"`), which `oneOf` shows by
 * its label. Options that are language maps, and lookup lists, store the whole option, which
 * is compared as one value by `$key` and named by its own text in the reader's language.
 */
function choiceSchema(field: NestedFieldConfig, lang: string): Schema {
  const raw = (Array.isArray(field.options) ? field.options : []) as unknown[];
  const coded = raw.filter(
    (option): option is { value: string | number; label?: unknown } =>
      !!option && typeof option === 'object' && 'value' in option && ['string', 'number'].includes(typeof (option as { value: unknown }).value),
  );
  if (coded.length && coded.length === raw.length) {
    return {
      type: typeof coded[0].value === 'number' ? 'number' : 'string',
      oneOf: coded.map(option => {
        const label = toLangMap(option.label) ?? { [lang]: String(option.value) };
        return { const: option.value, title: resolveLabel(label, lang) || String(option.value), 'x-title': label };
      }),
    };
  }
  return { type: 'object', 'x-atomic': true, 'x-key': '$key', 'x-label': '@lang' };
}

/** The child that names a row: the first text column, else the first column of any text-like type. */
function rowLabelField(children: NestedFieldConfig[]): string | undefined {
  for (const type of LABEL_TYPES) {
    const match = children.find(child => child?.id && child.type === type);
    if (match) return match.id;
  }
  return undefined;
}

function titled(label: LocalizedText | undefined, fallback: string, lang: string): Schema {
  const map = toLangMap(label);
  if (!map) return { title: fallback };
  return { title: resolveLabel(map, lang) || fallback, 'x-title': map };
}

function toLangMap(value: unknown): Record<string, string> | undefined {
  if (typeof value === 'string') return value ? { en: value } : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const map: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (!key.startsWith('$') && typeof text === 'string') map[key] = text;
  }
  return Object.keys(map).length ? map : undefined;
}

function propertiesOf(schema: Schema): Record<string, Schema> {
  return schema['properties'] as Record<string, Schema>;
}

// ─── Diffing records ─────────────────────────────────────────────────────────

export interface DiffEntityRecordsOptions extends DiffOptions {
  /**
   * Steps that bring a record saved under an older config `version` up to the current one.
   * Both records are migrated before they are compared, so a field a migration renamed or
   * moved reads as no change, never as one value cleared and another set.
   */
  migrations?: RecordMigration[];
  /** The version to assume for a record with no `_configVersion`; see `migrateRecord`. */
  assumeVersion?: number;
  /** A ready adapter, to reuse across many diffs of one config. Default: built from `config`. */
  adapter?: Adapter;
}

/**
 * The changes between two saved versions of a record: `null` before is a create, `null` after
 * a delete.
 *
 * Both records are first brought to the config's version with `migrateRecord`, then given row
 * ids with `applyRowIds`, so a record saved by 3.1, with no ids on its rows, is matched row for
 * row with the same record saved since. System fields and the copy of a field moved by
 * `refererField` are ignored. Store the changes, not the sentences: `describeEntityChanges`
 * reads them later in any language.
 */
export function diffEntityRecords(
  before: Record<string, any> | null,
  after: Record<string, any> | null,
  config: EntityFormConfig,
  options: DiffEntityRecordsOptions = {},
): Change[] {
  const { migrations, assumeVersion, adapter, ...diffOptions } = options;
  const prepare = (record: Record<string, any> | null): Record<string, any> | null => {
    if (!record) return record;
    const migrated = migrations?.length
      ? migrateRecord(record, config, migrations, assumeVersion === undefined ? {} : { assumeVersion }).record
      : record;
    return applyRowIds(migrated, config);
  };

  const a = prepare(before);
  const b = prepare(after);
  const ignore = [...(diffOptions.ignore ?? []), ...ignoredPaths(config, a, b)];
  return diffRecords(a, b, adapter ?? entityAuditAdapter(config), { ...diffOptions, ignore });
}

/** System fields, and the second copy a tab-level `refererField` writes. */
function ignoredPaths(config: EntityFormConfig, ...records: (Record<string, any> | null)[]): string[] {
  // A root key starting with `_` is a system field unless the schema puts something there.
  const described = new Set(Object.keys(propertiesOf(entitySchema(config))));
  const paths = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record ?? {})) {
      if (key.startsWith('_') && !described.has(key)) paths.add(`/${key}`);
    }
  }

  const walkTabs = (tabs: NestedTabConfig[] | undefined, scope: string[]) => {
    for (const tab of tabs ?? []) {
      if (!tab?.id) continue;
      const own = tab.flatData ? scope : [...scope, tab.id];
      const scopeKey = own.join('.') || ROOT_SCOPE;
      for (const field of tab.fields ?? []) {
        if (field?.id && isRefOverride(field, scopeKey)) paths.add(`/${field.refererField!.split('.').join('/')}`);
      }
      walkTabs(tab.children, own);
    }
  };
  walkTabs(config.tabs, []);
  return [...paths];
}

export interface DescribeEntityChangesOptions extends DescribeOptions {
  /** The config the changes came from: its `defaultLanguage` is the default `language`. */
  config?: EntityFormConfig;
}

/**
 * One sentence per change, with labels in `language` — by default the config's
 * `defaultLanguage`. The sentence templates are English; pass `messages` for another language.
 */
export function describeEntityChanges(changes: readonly Change[], options: DescribeEntityChangesOptions = {}): Sentence[] {
  const { config, ...rest } = options;
  const language = rest.language ?? config?.defaultLanguage;
  return describe(changes, { ...rest, ...(language ? { language } : {}) });
}
