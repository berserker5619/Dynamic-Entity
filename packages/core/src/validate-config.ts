/**
 * validate-config.ts — check an `EntityFormConfig` before anything tries to render it.
 *
 * A config is data: authored in the builder, stored, fetched from an API. TypeScript cannot
 * police any of that, so the first sign of a malformed one used to be a field that quietly
 * failed to render. The repository's own reference dataset shipped for a long time naming
 * three field types that do not exist, and nothing noticed.
 *
 * Pure and dependency-free, so the same check runs in a build step, in a server handler
 * before persisting, or in a test.
 */

import { FIELD_TYPE_CATALOG } from './field-catalog';
import { ROOT_SCOPE, ambiguousFieldIds, collectFieldScopes, parseFieldRef, refOf } from './field-scopes';
import type { EntityFormConfig, FormRule, NestedFieldConfig, NestedTabConfig } from './form-model.types';

export interface ConfigProblem {
  /** `error` means it will not render correctly; `warning` means it is suspicious but usable. */
  level: 'error' | 'warning';
  /** Where the problem is, e.g. `tabs[0].fields[2]` or `tabs[1].id`. */
  path: string;
  message: string;
}

export interface ValidateConfigOptions {
  /**
   * Field types beyond the built-in catalog — anything registered with `registerFieldType`
   * or provided to the renderer with `provideFieldTypes`. Without these, a config using a
   * custom type would be reported as invalid.
   */
  additionalFieldTypes?: readonly string[];
  /**
   * Rules live beside the config, not in it (`[rules]` on the renderer). Pass them here so
   * `fieldId`, `compareToField` and field `targets` get the same reference check as `showWhen`.
   * Omit them and those references are not checked — the renderer still warns in dev.
   */
  rules?: readonly FormRule[];
}

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Validate a config's structure, ids and field types.
 *
 * Returns every problem found rather than throwing at the first, so an author fixing a config
 * sees the whole list. An empty array means the config is structurally sound. Pass `rules` to
 * also check a rule's trigger, `compareToField` and field targets against the same path/id
 * rule as `showWhen`.
 */
/**
 * `fields`, `children` and `tabs` are config data, so they may be any shape at all.
 * `?.forEach` guards `undefined` and nothing else — a string or a number reached it and
 * threw, crashing the validator on the input it exists to describe.
 */
function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function validateConfig(
  config: EntityFormConfig | null | undefined,
  options: ValidateConfigOptions = {},
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const add = (level: ConfigProblem['level'], path: string, message: string) =>
    problems.push({ level, path, message });

  if (!config || typeof config !== 'object') {
    add('error', '', 'Config is missing or not an object.');
    return problems;
  }

  if (!config.entity || typeof config.entity !== 'string' || !config.entity.trim()) {
    add('error', 'entity', 'An entity name is required.');
  }

  if (config.version !== undefined && (typeof config.version !== 'number' || config.version < 1)) {
    add('error', 'version', 'version must be a positive number when present.');
  }

  const knownTypes = new Set<string>([
    ...FIELD_TYPE_CATALOG.map(m => m.type as string),
    ...(options.additionalFieldTypes ?? []),
  ]);

  /**
   * Field ids are unique **within a scope**, not across the whole config.
   *
   * A scope is the object a field is stored under, which is exactly the group the renderer
   * builds a control in: a tab makes one, a `flatData` tab merges into its parent's, and a
   * `group` field makes one for its children. So `address` on Personal Details and `address`
   * on Work Details are two different fields, stored and rendered as
   * `{ personal: { address }, work: { address } }` — which is what the runtime has always
   * done. Only this validator insisted otherwise.
   *
   * What genuinely cannot be duplicated is an id a *bare* reference addresses. `showWhen`,
   * cascades, `patchOnTrue` and rules may still name a field by id with no scope, so if that
   * name is ambiguous the reference has no answer. A bracketed path names exactly one field
   * and is the form the builder authors. Both are checked separately below.
   */
  const fieldIds = new Map<string, string>();
  const tabIds = new Map<string, string>();

  // The scope rule lives in field-scopes.ts so the renderer can apply exactly the same one.
  const scopesById = ambiguousFieldIds(config);
  const scopeKey = (scope: readonly string[]): string => scope.join('.') || ROOT_SCOPE;

  const visitField = (field: NestedFieldConfig, path: string, scope: readonly string[]) => {
    if (!field || typeof field !== 'object') {
      add('error', path, 'Field is missing or not an object.');
      return;
    }

    if (!field.id || typeof field.id !== 'string') {
      add('error', `${path}.id`, 'A field id is required.');
    } else {
      if (!ID_PATTERN.test(field.id)) {
        add(
          'warning',
          `${path}.id`,
          `"${field.id}" is not a plain identifier; it is used as an object key in saved records.`,
        );
      }
      const key = `${scopeKey(scope)}::${field.id}`;
      const seenAt = fieldIds.get(key);
      if (seenAt) {
        add(
          'error',
          `${path}.id`,
          `Duplicate field id "${field.id}" (also at ${seenAt}). Two fields in ${scopeKey(scope)} would share one control and one record key.`,
        );
      } else {
        fieldIds.set(key, path);
      }
    }

    if (!field.type) {
      add('error', `${path}.type`, 'A field type is required.');
    } else if (!knownTypes.has(field.type)) {
      add(
        'error',
        `${path}.type`,
        `Unknown field type "${field.type}". It will not render. Known types: ${[...knownTypes].sort().join(', ')}.`,
      );
    }

    if (field.label === undefined) {
      add('warning', `${path}.label`, 'No label; the field will render without one.');
    }

    const isContainer = field.type === 'group' || field.type === 'array';
    if (isContainer && (!field.children || field.children.length === 0)) {
      add('warning', `${path}.children`, `A "${field.type}" field with no children renders nothing.`);
    }
    if (!isContainer && field.children?.length) {
      add('warning', `${path}.children`, `Children on a "${field.type}" field are ignored.`);
    }

    if (field.options?.length && field.listName) {
      add(
        'warning',
        `${path}.listName`,
        'Both inline options and listName are set; inline options win and listName is dropped.',
      );
    }

    if (field.colSpan !== undefined && (field.colSpan < 1 || field.colSpan > 12)) {
      add('error', `${path}.colSpan`, 'colSpan must be between 1 and 12.');
    }

    // A `group` field stores its children under itself, so they get their own scope. An
    // `array` field's rows do too. Either way the children are not siblings of the field.
    const childScope = isContainer ? [...scope, field.id] : scope;
    // Present but not a collection: the children are dropped, and without this nothing says
    // so. `asArray` stops the crash; this is what stops the silence.
    if (field.children !== undefined && !Array.isArray(field.children)) {
      add('error', `${path}.children`, 'children must be an array; it will be ignored.');
    }
    asArray(field.children).forEach((child, i) => visitField(child, `${path}.children[${i}]`, childScope));
  };

  const visitTab = (tab: NestedTabConfig, path: string, scope: readonly string[]) => {
    if (!tab || typeof tab !== 'object') {
      add('error', path, 'Tab is missing or not an object.');
      return;
    }

    if (!tab.id || typeof tab.id !== 'string') {
      add('error', `${path}.id`, 'A tab id is required.');
    } else {
      const seenAt = tabIds.get(tab.id);
      if (seenAt) {
        add('error', `${path}.id`, `Duplicate tab id "${tab.id}" (also at ${seenAt}).`);
      } else {
        tabIds.set(tab.id, path);
      }
    }

    if (!tab.fields?.length && !tab.children?.length && !tab.moduleName) {
      add('warning', path, 'Tab has no fields, no sub-tabs and no module; it renders empty.');
    }

    // `flatData` puts the tab's fields at the parent's level instead of under the tab id,
    // so such a tab shares its parent's scope rather than opening one.
    const tabScope = tab.flatData || !tab.id ? scope : [...scope, tab.id];
    for (const [key, value] of [
      ['fields', tab.fields],
      ['children', tab.children],
    ] as const) {
      if (value !== undefined && !Array.isArray(value)) {
        add('error', `${path}.${key}`, `${key} must be an array; it will be ignored.`);
      }
    }
    asArray(tab.fields).forEach((f, i) => visitField(f, `${path}.fields[${i}]`, tabScope));
    asArray(tab.children).forEach((t, i) => visitTab(t, `${path}.children[${i}]`, tabScope));
  };

  if (!Array.isArray(config.tabs) || config.tabs.length === 0) {
    add('error', 'tabs', 'At least one tab is required.');
  } else {
    config.tabs.forEach((tab, i) => visitTab(tab, `tabs[${i}]`, []));
  }

  // A field referencing a sibling that does not exist never becomes visible, and a cascade
  // pointing at a missing parent never loads — both silent at runtime.
  const entries = collectFieldScopes(config);
  const allIds = new Set(entries.map(e => e.field?.id).filter(Boolean) as string[]);
  const allPaths = new Set(
    entries.filter(e => e.field?.id).map(e => refOf(e.field, e.scope)),
  );

  /**
   * Resolves one reference — a `showWhen` key or a cascade parent.
   *
   * A bracketed path names exactly one field and is the form the builder authors. A bare name
   * is a field id, which is how every config written before paths existed addresses a field;
   * it resolves only while one scope defines it.
   */
  const referenceProblem = (reference: string): string | null => {
    const parsed = parseFieldRef(reference);
    if (parsed.kind === 'ref') {
      return allPaths.has(parsed.value)
        ? null
        : `No field at path "${parsed.value}".`;
    }
    if (!allIds.has(parsed.value)) return `References unknown field "${parsed.value}".`;
    const scopes = scopesById.get(parsed.value);
    return scopes
      ? `Ambiguous reference to "${parsed.value}": defined in ${scopes.join(' and ')}. Name it by path instead, as [${scopes[0]}.${parsed.value}].`
      : null;
  };

  /**
   * An id that exists in more than one scope cannot be named by a bare id.
   *
   * A bracketed path (`[work.address]`) names exactly one field. A bare id does not, so when
   * two scopes both define that id there is no answer to which one is meant — and the runtime
   * would pick by search order, silently. Duplicating an id is fine right up until something
   * points at it by name, which is the line this draws.
   */
  const flagRef = (reference: string | undefined, path: string, suffix: string) => {
    if (!reference) return;
    const problem = referenceProblem(reference);
    if (problem) add('error', path, `${problem} ${suffix}`);
  };

  const checkRefs = (field: NestedFieldConfig, path: string) => {
    // This pass walks the tree a second time and so needs its own guard. `visitField`
    // reports a malformed entry and returns; without the same check here a `null` in
    // `fields` threw a TypeError instead — crashing the validator on exactly the input it
    // exists to describe, and taking `dynamic-entity validate` down with it in CI.
    if (!field || typeof field !== 'object') return;

    for (const key of Object.keys(field.showWhen ?? {})) {
      flagRef(key, `${path}.showWhen`, 'This field will never show.');
    }
    flagRef(
      field.entityReference?.parentField,
      `${path}.entityReference.parentField`,
      'The cascade will never load.',
    );
    field.patchOnTrue?.forEach((mapping, i) => {
      flagRef(mapping.from, `${path}.patchOnTrue[${i}].from`, 'Nothing will be copied from.');
      flagRef(mapping.to, `${path}.patchOnTrue[${i}].to`, 'Nothing will be copied to.');
    });
    asArray(field.children).forEach((c, i) => checkRefs(c, `${path}.children[${i}]`));
  };
  const walkTabsForRefs = (tabs: NestedTabConfig[] | undefined, base: string) => {
    asArray(tabs).forEach((tab, i) => {
      if (!tab || typeof tab !== 'object') return;
      asArray(tab.fields).forEach((f, j) => checkRefs(f, `${base}[${i}].fields[${j}]`));
      walkTabsForRefs(tab.children, `${base}[${i}].children`);
    });
  };
  walkTabsForRefs(config.tabs, 'tabs');

  options.rules?.forEach((rule, i) => {
    if (!rule || typeof rule !== 'object') {
      add('error', `rules[${i}]`, 'Rule is missing or not an object.');
      return;
    }
    const base = `rules[${i}]`;
    flagRef(rule.fieldId, `${base}.fieldId`, 'The rule will never trigger.');
    rule.conditions?.forEach((condition, j) => {
      flagRef(
        condition?.compareToField,
        `${base}.conditions[${j}].compareToField`,
        'The comparison will never match.',
      );
    });
    rule.targets?.forEach((target, j) => {
      if (!target?.id) return;
      if (target.type === 'tab') {
        if (!tabIds.has(target.id)) {
          add('error', `${base}.targets[${j}].id`, `References unknown tab "${target.id}".`);
        }
        return;
      }
      flagRef(target.id, `${base}.targets[${j}].id`, 'The action will never apply.');
    });
  });

  return problems;
}

/** True when `validateConfig` found nothing at `error` level. */
export function isConfigValid(
  config: EntityFormConfig | null | undefined,
  options?: ValidateConfigOptions,
): boolean {
  return !validateConfig(config, options).some(p => p.level === 'error');
}

/** The problems as one readable block, for a thrown error or a log line. */
export function formatConfigProblems(problems: readonly ConfigProblem[]): string {
  return problems.map(p => `  [${p.level}] ${p.path || '(root)'}: ${p.message}`).join('\n');
}
