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
import { OPTION_KEY, UNSAFE_PATH_KEYS, isUnsafePath, resolveLabel } from './form-logic';
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
  /**
   * Validator names the consumer registered with `provideNgxDynamicEntity({ validators,
   * asyncValidators })`, plus any parameterised built-in the schema uses.
   *
   * A `validators.custom` entry naming something unregistered is silently dropped at render
   * time — including a `customAsync` uniqueness check, which is the worst failure mode this
   * library has: the form saves, the duplicate lands, and nothing anywhere said so. Pass the
   * registered names and an unknown one becomes an error here instead.
   *
   * Omit it and the check does not run, exactly like `rules`. The built-ins the registry
   * resolves without a consumer — `required`, `email`, and `min:`/`max:`/`minLength:`/
   * `maxLength:` with a numeric argument — are always accepted.
   */
  knownValidators?: readonly string[];
}

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Built-in validator names the registry resolves without anything registered. */
const PARAMETERISED_BUILTINS = new Set(['min', 'max', 'minLength', 'maxLength']);
const BARE_BUILTINS = new Set(['required', 'email']);

/**
 * Whether the renderer's `ValidatorRegistryService` could resolve this name on its own.
 *
 * Mirrors `resolve()` there: the two bare built-ins, and the four parameterised ones when the
 * argument parses as a number. Anything else has to come from the consumer's registry.
 */
function isBuiltInValidator(name: string): boolean {
  if (BARE_BUILTINS.has(name)) return true;
  const [base, param] = name.split(':');
  return PARAMETERISED_BUILTINS.has(base) && param !== undefined && !Number.isNaN(parseFloat(param));
}

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

  /**
   * Validator settings that cannot do what they say.
   *
   * `pattern` is the one that mattered: `import-engine` swallows an unparseable regex with a
   * comment saying this function reports it, and this function had no such check — so on the
   * server the field's format validation silently did not run, and on the client
   * `Validators.pattern` threw while the control was being built.
   */
  const checkValidators = (field: NestedFieldConfig, path: string) => {
    const v = field.validators;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;

    if (v.pattern !== undefined) {
      if (typeof v.pattern !== 'string' || !v.pattern) {
        add('error', `${path}.validators.pattern`, 'pattern must be a non-empty string.');
      } else {
        try {
          new RegExp(v.pattern);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          add(
            'error',
            `${path}.validators.pattern`,
            `"${v.pattern}" is not a valid regular expression (${reason}). It is skipped ` +
              `server-side and throws when the control is built.`,
          );
        }
      }
    }

    if (typeof v.min === 'number' && typeof v.max === 'number' && v.min > v.max) {
      add(
        'error',
        `${path}.validators`,
        `min (${v.min}) is greater than max (${v.max}); no value can satisfy both.`,
      );
    }
    if (typeof v.minLength === 'number' && typeof v.maxLength === 'number' && v.minLength > v.maxLength) {
      add(
        'error',
        `${path}.validators`,
        `minLength (${v.minLength}) is greater than maxLength (${v.maxLength}); no value can satisfy both.`,
      );
    }

    // Without `knownValidators` this cannot tell an unregistered name from one the caller
    // simply did not list, so the check is opt-in — the same shape as `rules`.
    if (!options.knownValidators) return;
    const known = new Set(options.knownValidators);
    for (const [key, list] of [
      ['custom', v.custom],
      ['customAsync', v.customAsync],
    ] as const) {
      if (list !== undefined && !Array.isArray(list)) {
        add('error', `${path}.validators.${key}`, `${key} must be an array of validator names.`);
        continue;
      }
      (list ?? []).forEach((name, i) => {
        if (typeof name !== 'string' || !name) {
          add('error', `${path}.validators.${key}[${i}]`, 'A validator name must be a non-empty string.');
          return;
        }
        if (known.has(name)) return;
        if (key === 'custom' && isBuiltInValidator(name)) return;
        const consequence =
          key === 'customAsync'
            ? ' An async check that quietly does not run is how a duplicate gets saved.'
            : '';
        add(
          'error',
          `${path}.validators.${key}[${i}]`,
          `No validator named "${name}" is registered, so it is dropped and never runs.${consequence}`,
        );
      });
    }
  };

  /** A default the control cannot hold is a field that starts out wrong for no stated reason. */
  const checkDefaultValue = (field: NestedFieldConfig, path: string) => {
    const value = field.defaultValue;
    if (value === undefined || value === null) return;
    if ((field.type === 'number' || field.type === 'currency') && typeof value !== 'number') {
      add(
        'error',
        `${path}.defaultValue`,
        `A "${field.type}" field's default must be a number; this is a ${typeof value}.`,
      );
    }
    if ((field.type === 'boolean' || field.type === 'checkbox') && typeof value !== 'boolean') {
      add(
        'error',
        `${path}.defaultValue`,
        `A "${field.type}" field's default must be a boolean; this is a ${typeof value}.`,
      );
    }
  };

  /**
   * Options must be distinguishable, and must not invent reserved keys.
   *
   * The displayed text is the stored value, so two options resolving to the same label in the
   * active language are the same value twice — the user can pick either and nothing can tell
   * them apart afterwards. `$key` gives an option an identity independent of its text; two
   * options carrying the same one is that identity failing to be one.
   */
  const checkOptions = (field: NestedFieldConfig, path: string) => {
    if (!Array.isArray(field.options)) return;
    const lang = config.defaultLanguage ?? 'en';
    const labels = new Map<string, number>();
    const keys = new Map<string, number>();

    field.options.forEach((option, i) => {
      const at = `${path}.options[${i}]`;
      if (!option || typeof option !== 'object' || Array.isArray(option)) {
        add('error', at, 'An option must be a language-keyed object.');
        return;
      }

      for (const key of Object.keys(option)) {
        if (key.startsWith('$') && key !== OPTION_KEY) {
          add(
            'error',
            `${at}.${key}`,
            `"${key}" is reserved. "$" cannot begin a language subtag, so the only "$" key an ` +
              `option may carry is "${OPTION_KEY}".`,
          );
        }
      }

      const key = (option as Record<string, unknown>)[OPTION_KEY];
      if (key !== undefined) {
        if (typeof key !== 'string' || !key) {
          add('error', `${at}.${OPTION_KEY}`, `${OPTION_KEY} must be a non-empty string.`);
        } else {
          const clash = keys.get(key);
          if (clash !== undefined) {
            add('error', `${at}.${OPTION_KEY}`, `Duplicate option key "${key}" (also at index ${clash}).`);
          } else {
            keys.set(key, i);
          }
        }
      }

      const label = resolveLabel(option, lang);
      if (!label) return;
      const seen = labels.get(label);
      if (seen !== undefined) {
        add(
          'warning',
          at,
          `Two options both read "${label}" in "${lang}" (also at index ${seen}). The ` +
            `displayed text is the stored value, so a record cannot say which was picked.`,
        );
      } else {
        labels.set(label, i);
      }
    });
  };

  const visitField = (field: NestedFieldConfig, path: string, scope: readonly string[]) => {
    if (!field || typeof field !== 'object') {
      add('error', path, 'Field is missing or not an object.');
      return;
    }

    if (!field.id || typeof field.id !== 'string') {
      add('error', `${path}.id`, 'A field id is required.');
    } else {
      if (UNSAFE_PATH_KEYS.has(field.id)) {
        // `__proto__` and `constructor` sail through ID_PATTERN, and then every path guard
        // in `form-logic` refuses to read or write them. The result is a field that renders,
        // accepts input and can never hold a value — silently. That is not a naming-style
        // problem, so it is not a warning.
        add(
          'error',
          `${path}.id`,
          `"${field.id}" is a reserved object key. A field with this id can never store a ` +
            `value: every path guard refuses to read or write it. Rename the field.`,
        );
      } else if (!ID_PATTERN.test(field.id)) {
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

    checkValidators(field, path);
    checkDefaultValue(field, path);
    checkOptions(field, path);

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
      if (UNSAFE_PATH_KEYS.has(tab.id)) {
        // A tab id is a scope segment, so it meets the same path guards a field id does —
        // and takes every field on the tab down with it.
        add(
          'error',
          `${path}.id`,
          `"${tab.id}" is a reserved object key. No field on this tab could store a value.`,
        );
      }
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

  /**
   * A config-supplied key that would reach an object's prototype.
   *
   * SECURITY.md states without qualification that a config cannot do this. The path guards
   * in `form-logic` make that true for reads and writes by path; `applyAutoPatch` and
   * `applyPatchOnTrue` build a fresh object from config-supplied keys and now skip these.
   * Skipping silently would leave a mapping that looks wired up and copies nothing, so it is
   * reported here as well.
   */
  const flagUnsafe = (key: string | undefined, path: string) => {
    if (!key || !isUnsafePath(key)) return;
    add(
      'error',
      path,
      `"${key}" names a reserved object key, so it is skipped rather than written. ` +
        `Rename the field it points at.`,
    );
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
    asArray(field.patchOnTrue).forEach((mapping, i) => {
      if (!mapping) return;
      flagRef(mapping.from, `${path}.patchOnTrue[${i}].from`, 'Nothing will be copied from.');
      flagRef(mapping.to, `${path}.patchOnTrue[${i}].to`, 'Nothing will be copied to.');
      flagUnsafe(mapping.to, `${path}.patchOnTrue[${i}].to`);
    });
    // `autoPatch` targets were never checked at all, and they are config-supplied keys
    // written into an object — the one place SECURITY.md's prototype claim could have been
    // broken. `applyAutoPatch` now skips such a mapping; this is what says so out loud.
    asArray(field.autoPatch?.mappings).forEach((mapping, i) => {
      if (!mapping) return;
      flagUnsafe(mapping.target, `${path}.autoPatch.mappings[${i}].target`);
    });
    flagUnsafe(field.refererField, `${path}.refererField`);
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

    /*
     * The shape the engine needs.
     *
     * This loop used `rule.conditions?.forEach`, which validates clean for exactly the shape
     * that used to crash `evaluateFormRules` — `?.` guards `undefined` and nothing else, and
     * a rule authored without conditions is the commonest half-finished rule there is. The
     * engine now drops such a rule instead of throwing, so the config is no longer fatal;
     * a rule that is silently never applied is still the failure this validator is for.
     */
    if (!Array.isArray(rule.conditions)) {
      add('error', `${base}.conditions`, 'conditions must be an array; the rule is skipped at runtime.');
    }
    if (!Array.isArray(rule.targets)) {
      add('error', `${base}.targets`, 'targets must be an array; the rule is skipped at runtime.');
    }
    if (!rule.action || typeof rule.action !== 'object' || Array.isArray(rule.action)) {
      add('error', `${base}.action`, 'An action object is required; the rule is skipped at runtime.');
    }

    flagRef(rule.fieldId, `${base}.fieldId`, 'The rule will never trigger.');
    asArray(rule.conditions).forEach((condition, j) => {
      flagRef(
        condition?.compareToField,
        `${base}.conditions[${j}].compareToField`,
        'The comparison will never match.',
      );
    });
    asArray(rule.targets).forEach((target, j) => {
      if (!target?.id) return;
      if (target.type === 'tab') {
        if (!tabIds.has(target.id)) {
          add('error', `${base}.targets[${j}].id`, `References unknown tab "${target.id}".`);
        }
        // Only `visibility` reaches a tab. `validationErrors` and `infoBanners` are keyed by
        // target and read per field, so a tab-targeted message is written and never rendered.
        if (rule.action?.type === 'validation' || rule.action?.type === 'info') {
          add(
            'warning',
            `${base}.targets[${j}]`,
            `A "${rule.action.type}" action on a tab has no effect — only "visibility" applies ` +
              `to a tab. Target the fields instead.`,
          );
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
