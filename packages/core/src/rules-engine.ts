import type {
  EntityFormConfig,
  FormRule,
  RuleCondition,
  RuleEvaluationResult,
} from './form-model.types';
import { findTab, valuesEqual } from './form-logic';
import { fieldsUnderTab, parseFieldRef, refOf, tabIdsUnderTab, toRefToken } from './field-scopes';

/** Config collections may be any shape; `?.` guards undefined and nothing else. */
function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Evaluate a single rule condition against the current form values (and optional baseline values).
 *
 * Equality here is `valuesEqual`, not `valuesMatch`: a rule asks "does this fire", which is a
 * stricter question than "did the user pick this option". `EQUAL 0` does not match `'0'`, and
 * `EQUAL false` does not match `'false'`. The ordering, string and date operators keep their
 * deliberate coercion — `LESS_THAN` over a numeric string is the documented behaviour.
 */
export function evaluateCondition(
  condition: RuleCondition,
  actualValue: unknown,
  formValues: Record<string, unknown>,
  originalValue?: unknown,
): boolean {
  const compareTarget =
    condition.compareType === 'field' && condition.compareToField
      ? formValues[condition.compareToField]
      : condition.value;

  switch (condition.operator) {
    case 'EQUAL':
      return valuesEqual(actualValue, compareTarget);

    case 'NOT_EQUAL':
      return !valuesEqual(actualValue, compareTarget);

    case 'CONTAINS': {
      if (typeof actualValue === 'string') return actualValue.includes(String(compareTarget ?? ''));
      if (Array.isArray(actualValue)) return actualValue.some(item => valuesEqual(item, compareTarget));
      return false;
    }

    case 'NOT_CONTAINS': {
      if (typeof actualValue === 'string') return !actualValue.includes(String(compareTarget ?? ''));
      if (Array.isArray(actualValue)) return !actualValue.some(item => valuesEqual(item, compareTarget));
      return true;
    }

    case 'STARTS_WITH':
      return typeof actualValue === 'string' && actualValue.startsWith(String(compareTarget ?? ''));

    case 'ENDS_WITH':
      return typeof actualValue === 'string' && actualValue.endsWith(String(compareTarget ?? ''));

    case 'IS_EMPTY':
      return actualValue == null || actualValue === '' || (Array.isArray(actualValue) && actualValue.length === 0);

    case 'IS_NOT_EMPTY':
      return actualValue != null && actualValue !== '' && (!Array.isArray(actualValue) || actualValue.length > 0);

    case 'LESS_THAN':
      return Number(actualValue) < Number(compareTarget);

    case 'MORE_THAN':
      return Number(actualValue) > Number(compareTarget);

    case 'LESS_THAN_EQUAL':
      return Number(actualValue) <= Number(compareTarget);

    case 'MORE_THAN_EQUAL':
      return Number(actualValue) >= Number(compareTarget);

    case 'DATE_BEFORE': {
      const d1 = new Date(actualValue as string).getTime();
      const d2 = new Date(compareTarget as string).getTime();
      return !Number.isNaN(d1) && !Number.isNaN(d2) && d1 < d2;
    }

    case 'DATE_AFTER': {
      const d1 = new Date(actualValue as string).getTime();
      const d2 = new Date(compareTarget as string).getTime();
      return !Number.isNaN(d1) && !Number.isNaN(d2) && d1 > d2;
    }

    case 'IN':
      return Array.isArray(compareTarget) && compareTarget.some(target => valuesEqual(actualValue, target));

    /*
     * A non-array target is vacuously "not in" it.
     *
     * This returned `false`, so `IN` and `NOT_IN` against the same malformed target were
     * *both* false and a rule and its negation could not partition anything. A condition
     * that cannot be satisfied either way is a rule silently switched off.
     */
    case 'NOT_IN':
      return !Array.isArray(compareTarget) || !compareTarget.some(target => valuesEqual(actualValue, target));

    case 'HAS_ITEMS':
      return Array.isArray(actualValue) && actualValue.length > 0;

    /*
     * Changed against the session baseline.
     *
     * Two fixes over `originalValue !== undefined && actualValue !== originalValue`:
     * identity comparison called every object-valued field changed on every evaluation —
     * which is every choice field, because the displayed text *is* the stored object — and
     * requiring a defined baseline excluded the commonest change of all, a field the record
     * had no value for that the user has just filled in.
     */
    case 'VALUE_CHANGED':
      return !valuesEqual(actualValue, originalValue);

    default:
      return false;
  }
}

/** Optional hooks for `evaluateFormRules`. */
export interface EvaluateFormRulesOptions {
  /**
   * Called once per rule dropped for being malformed.
   *
   * The engine reports rather than logs: it runs inside change detection on the client and
   * inside a request handler on the server, and which of those should print is not its
   * decision. The renderer passes a dev-mode `console.warn`; a server passes its logger, or
   * nothing at all.
   */
  onProblem?: (message: string) => void;
}

/** Why this engine cannot apply a rule, or `null` when it can. */
function ruleProblem(rule: FormRule, index: number): string | null {
  const at = rule.id ? `Rule "${rule.id}"` : `Rule at index ${index}`;
  if (!Array.isArray(rule.conditions)) return `${at} has no conditions array.`;
  if (!Array.isArray(rule.targets)) return `${at} has no targets array.`;
  if (!rule.action || typeof rule.action !== 'object') return `${at} has no action object.`;
  return null;
}

/**
 * Evaluate all active form rules against form values (and optional session-original baseline values).
 *
 * **Priority sorts ascending, so the highest number wins.** Rules apply in `priority` order
 * and `validationErrors`, `validationWarnings` and `infoBanners` are keyed by target, so when
 * two rules write a message for one target the rule applied last is the one left standing.
 * The hidden and shown lists accumulate instead, and order does not affect them.
 *
 * A malformed rule is dropped and reported through `options.onProblem`; the rest still apply.
 * This used to throw out of `rule.conditions.every`, taking the whole evaluation — and, on
 * the client, the change-detection pass it ran inside — down with it.
 */
export function evaluateFormRules(
  rules: FormRule[] | undefined | null,
  formValues: Record<string, unknown>,
  originalValues?: Record<string, unknown>,
  options: EvaluateFormRulesOptions = {},
): RuleEvaluationResult {
  const result: RuleEvaluationResult = {
    hiddenFields: [],
    hiddenTabs: [],
    shownFields: [],
    shownTabs: [],
    validationErrors: {},
    validationWarnings: {},
    infoBanners: {},
  };

  if (!Array.isArray(rules) || !rules.length) return result;

  const usable: FormRule[] = [];
  rules.forEach((rule, i) => {
    if (!rule || typeof rule !== 'object') {
      options.onProblem?.(`Rule at index ${i} is not an object; it was skipped.`);
      return;
    }
    if (!rule.enabled) return;
    const problem = ruleProblem(rule, i);
    if (problem) {
      options.onProblem?.(`${problem} It was skipped; the other rules still applied.`);
      return;
    }
    usable.push(rule);
  });

  const sorted = usable.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  for (const rule of sorted) {
    const fieldValue = formValues[rule.fieldId];
    const originalValue = originalValues?.[rule.fieldId];

    const allConditionsMet = rule.conditions.every(cond =>
      evaluateCondition(cond, fieldValue, formValues, originalValue),
    );

    if (!allConditionsMet) continue;

    const action = rule.action;
    for (const target of rule.targets) {
      if (!target || typeof target !== 'object' || !target.id) continue;

      if (action.type === 'visibility') {
        // `true` was read and then discarded, which made `{ type: 'visibility', value: true }`
        // a documented no-op. It is a positive show now — precedence is on
        // `RuleEvaluationResult.shownFields`.
        const hide = action.value === false || action.value === 'false';
        const fields = hide ? result.hiddenFields : result.shownFields;
        const tabs = hide ? result.hiddenTabs : result.shownTabs;
        if (target.type === 'field') fields.push(target.id);
        else if (target.type === 'tab') tabs.push(target.id);
      } else if (action.type === 'validation') {
        const msg = String(action.value ?? 'Validation error');
        if (action.severity === 'warning') {
          result.validationWarnings[target.id] = msg;
        } else {
          result.validationErrors[target.id] = msg;
        }
      } else if (action.type === 'info') {
        result.infoBanners[target.id] = String(action.value ?? '');
      }
    }
  }

  return result;
}

/**
 * The rules that apply to one tab — used by per-section save, which validates a tab at a time.
 *
 * A rule names a field the way everything else does: a bare id, or a bracketed path
 * (`[personal.addresses.city]`). The builder writes paths, because that is the only form that
 * can name one of two fields sharing an id. This compared *bare ids against the tab's
 * top-level fields only*, so for every builder-authored config it matched nothing at all and
 * per-section save applied no rule validation whatsoever.
 *
 * Both halves are fixed by one code path: `fieldsUnderTab` yields every field the tab owns at
 * any depth, and each contributes both of its names to the match set.
 */
export function filterRulesForTab(
  rules: FormRule[] | undefined | null,
  tabId: string,
  config: EntityFormConfig,
): FormRule[] {
  if (!Array.isArray(rules) || !rules.length) return [];
  // A tab that does not exist owns nothing. Without this it would still collect the rules
  // whose tab target happens to spell its id.
  if (!findTab(config?.tabs, tabId)) return [];

  const names = new Set<string>();
  for (const entry of fieldsUnderTab(config, tabId)) {
    const field = entry.field;
    if (!field?.id) continue;
    names.add(field.id);
    names.add(toRefToken(refOf(field, entry.scope)));
  }
  const tabs = tabIdsUnderTab(config, tabId);

  const namesField = (reference: unknown): boolean => {
    if (typeof reference !== 'string' || !reference) return false;
    const parsed = parseFieldRef(reference);
    return parsed.kind === 'ref' ? names.has(toRefToken(parsed.value)) : names.has(parsed.value);
  };

  return rules.filter(rule => {
    if (!rule || typeof rule !== 'object') return false;
    if (namesField(rule.fieldId)) return true;
    return asArray(rule.targets).some(target =>
      target?.type === 'tab' ? tabs.has(target.id) : namesField(target?.id),
    );
  });
}
