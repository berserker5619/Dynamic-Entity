import { Injectable } from '@angular/core';
import type { EntityFormConfig, FormRule, RuleEvaluationResult } from '@dynamic-entity/core';
import { evaluateFormRules, filterRulesForTab } from '@dynamic-entity/core';

/**
 * RulesEvaluationService — evaluates dynamic form rules against active reactive form state.
 */
@Injectable({ providedIn: 'root' })
export class RulesEvaluationService {
  /**
   * Evaluate rules against form values and optional original baseline values.
   */
  evaluate(
    rules: FormRule[] | undefined | null,
    values: Record<string, unknown>,
    originalValues?: Record<string, unknown>,
  ): RuleEvaluationResult {
    return evaluateFormRules(rules, values, originalValues);
  }

  /**
   * Filter rules pertinent to a single tab.
   */
  filterForTab(rules: FormRule[] | undefined | null, tabId: string, config: EntityFormConfig): FormRule[] {
    return filterRulesForTab(rules, tabId, config);
  }
}
