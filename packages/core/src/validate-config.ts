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
import type { EntityFormConfig, NestedFieldConfig, NestedTabConfig } from './form-model.types';

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
}

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Validate a config's structure, ids and field types.
 *
 * Returns every problem found rather than throwing at the first, so an author fixing a config
 * sees the whole list. An empty array means the config is structurally sound — it does not
 * mean the rules or references it declares will resolve at runtime.
 */
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

  // Field ids must be unique across the entire config, not per tab: rules, showWhen keys and
  // autoPatch mappings all address a field by bare id, so two fields sharing one silently
  // interfere with each other.
  const fieldIds = new Map<string, string>();
  const tabIds = new Map<string, string>();

  const visitField = (field: NestedFieldConfig, path: string) => {
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
      const seenAt = fieldIds.get(field.id);
      if (seenAt) {
        add(
          'error',
          `${path}.id`,
          `Duplicate field id "${field.id}" (also at ${seenAt}). Ids must be unique across the whole config — rules and showWhen address fields by bare id.`,
        );
      } else {
        fieldIds.set(field.id, path);
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

    field.children?.forEach((child, i) => visitField(child, `${path}.children[${i}]`));
  };

  const visitTab = (tab: NestedTabConfig, path: string) => {
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

    tab.fields?.forEach((f, i) => visitField(f, `${path}.fields[${i}]`));
    tab.children?.forEach((t, i) => visitTab(t, `${path}.children[${i}]`));
  };

  if (!Array.isArray(config.tabs) || config.tabs.length === 0) {
    add('error', 'tabs', 'At least one tab is required.');
  } else {
    config.tabs.forEach((tab, i) => visitTab(tab, `tabs[${i}]`));
  }

  // A field referencing a sibling that does not exist never becomes visible, and a cascade
  // pointing at a missing parent never loads — both silent at runtime.
  const allIds = new Set(fieldIds.keys());
  const checkRefs = (field: NestedFieldConfig, path: string) => {
    for (const key of Object.keys(field.showWhen ?? {})) {
      if (!allIds.has(key)) {
        add('error', `${path}.showWhen`, `References unknown field "${key}"; this field will never show.`);
      }
    }
    const parent = field.entityReference?.parentField;
    if (parent && !allIds.has(parent)) {
      add(
        'error',
        `${path}.entityReference.parentField`,
        `References unknown field "${parent}"; the cascade will never load.`,
      );
    }
    field.children?.forEach((c, i) => checkRefs(c, `${path}.children[${i}]`));
  };
  const walkTabsForRefs = (tabs: NestedTabConfig[] | undefined, base: string) => {
    tabs?.forEach((tab, i) => {
      tab.fields?.forEach((f, j) => checkRefs(f, `${base}[${i}].fields[${j}]`));
      walkTabsForRefs(tab.children, `${base}[${i}].children`);
    });
  };
  walkTabsForRefs(config.tabs, 'tabs');

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
