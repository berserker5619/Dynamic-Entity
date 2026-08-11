import type {
  EntityFormConfig,
  FormRule,
  RuleCondition,
  RuleEvaluationResult,
} from './form-model.types';
import { findTab, valuesMatch } from './form-logic';

/**
 * Evaluate a single rule condition against the current form values (and optional baseline values).
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
      return valuesMatch(actualValue, compareTarget);

    case 'NOT_EQUAL':
      return !valuesMatch(actualValue, compareTarget);

    case 'CONTAINS': {
      if (typeof actualValue === 'string') return actualValue.includes(String(compareTarget ?? ''));
      if (Array.isArray(actualValue)) return actualValue.some(item => valuesMatch(item, compareTarget));
      return false;
    }

    case 'NOT_CONTAINS': {
      if (typeof actualValue === 'string') return !actualValue.includes(String(compareTarget ?? ''));
      if (Array.isArray(actualValue)) return !actualValue.some(item => valuesMatch(item, compareTarget));
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
      return Array.isArray(compareTarget) && compareTarget.some(target => valuesMatch(actualValue, target));

    case 'NOT_IN':
      return Array.isArray(compareTarget) && !compareTarget.some(target => valuesMatch(actualValue, target));

    case 'HAS_ITEMS':
      return Array.isArray(actualValue) && actualValue.length > 0;

    case 'VALUE_CHANGED':
      return originalValue !== undefined && actualValue !== originalValue;

    default:
      return false;
  }
}

/**
 * Evaluate all active form rules against form values (and optional session-original baseline values).
 */
export function evaluateFormRules(
  rules: FormRule[] | undefined | null,
  formValues: Record<string, unknown>,
  originalValues?: Record<string, unknown>,
): RuleEvaluationResult {
  const result: RuleEvaluationResult = {
    hiddenFields: [],
    hiddenTabs: [],
    validationErrors: {},
    validationWarnings: {},
    infoBanners: {},
  };

  if (!rules?.length) return result;

  // Sort rules by priority (ascending)
  const sorted = [...rules].filter(r => r.enabled).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  for (const rule of sorted) {
    const fieldValue = formValues[rule.fieldId];
    const originalValue = originalValues?.[rule.fieldId];

    const allConditionsMet = rule.conditions.every(cond =>
      evaluateCondition(cond, fieldValue, formValues, originalValue),
    );

    if (!allConditionsMet) continue;

    const action = rule.action;
    for (const target of rule.targets) {
      if (action.type === 'visibility') {
        const hide = action.value === false || action.value === 'false';
        if (hide) {
          if (target.type === 'field') result.hiddenFields.push(target.id);
          else if (target.type === 'tab') result.hiddenTabs.push(target.id);
        }
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
 * Filter form rules applicable to a specific tab.
 */
export function filterRulesForTab(
  rules: FormRule[] | undefined | null,
  tabId: string,
  config: EntityFormConfig,
): FormRule[] {
  if (!rules?.length) return [];
  const tab = findTab(config.tabs, tabId);
  if (!tab) return [];

  const tabFieldIds = new Set((tab.fields ?? []).map(f => f.id));

  return rules.filter(rule => {
    if (tabFieldIds.has(rule.fieldId)) return true;
    return rule.targets.some(t => t.id === tabId || tabFieldIds.has(t.id));
  });
}
