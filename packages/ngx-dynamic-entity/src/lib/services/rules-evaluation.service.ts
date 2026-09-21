import { Injectable } from '@angular/core';
import type {
  EntityFormConfig,
  EvaluateFormRulesOptions,
  FieldScopeEntry,
  FormRule,
  NestedFieldConfig,
  NestedTabConfig,
  RuleEvaluationResult,
} from '@dynamic-entity/core';
import type { AbstractControl } from '@angular/forms';
import { evaluateFieldVisibility, evaluateFormRules, filterRulesForTab } from '@dynamic-entity/core';

/** What `syncHiddenFieldState` needs from the form it is operating on. */
export interface RuleSyncContext {
  result: RuleEvaluationResult;
  /** The values `showWhen` is evaluated against — the flat map the rules engine reads. */
  values: Record<string, unknown>;
  /** Every name a field answers to: its bare id, and its bracketed path. */
  namesOf(field: NestedFieldConfig): readonly string[];
  /**
   * The field's dotted address, unbracketed — `personal.address.city`.
   *
   * Separate from `namesOf` because it is compared as a *prefix*: a container hides its
   * descendants, and `[personal.address]` is not a prefix of `[personal.address.city]` once
   * the brackets are in the way.
   */
  addressOf(field: NestedFieldConfig): string;
  /** The control a scope entry addresses, or `null` when it has no static path. */
  controlFor(entry: FieldScopeEntry): AbstractControl | null;
}

/**
 * RulesEvaluationService — evaluates rules, and owns what a result *means*.
 *
 * It used to be two passthrough methods, with the interpretation spread across the component:
 * the render filter decided one way what a rule result did to a field, and the validity sync
 * decided again forty lines further down. They disagreed about what "every field" meant, and
 * the consequence was a required field inside a `group` that a rule had hidden holding
 * `form.invalid` true forever with nothing on screen to explain it.
 *
 * Precedence lives here now, in one method that both callers go through. Still stateless —
 * every method takes the result it is interpreting, so there is nothing to go stale against a
 * rebuilt form and nothing to reset between configs.
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
    options?: EvaluateFormRulesOptions,
  ): RuleEvaluationResult {
    return evaluateFormRules(rules, values, originalValues, options);
  }

  /**
   * Filter rules pertinent to a single tab.
   */
  filterForTab(rules: FormRule[] | undefined | null, tabId: string, config: EntityFormConfig): FormRule[] {
    return filterRulesForTab(rules, tabId, config);
  }

  /**
   * Whether a field renders, under the precedence documented on `RuleEvaluationResult`.
   *
   * An explicit hide beats everything. A show beats static hiding — `visibility: false`, or a
   * `showWhen` that does not currently hold — because a rule that could only hide what the
   * config already hides would have nothing to say, and `{ visibility: true }` was a
   * documented no-op until it did. Otherwise the config's own visibility decides.
   */
  isFieldVisible(
    result: RuleEvaluationResult,
    field: NestedFieldConfig,
    names: readonly string[],
    values: Record<string, unknown>,
  ): boolean {
    const sets = this.nameSets(result);
    if (names.some(name => sets.hidden.has(name))) return false;
    if (names.some(name => sets.shown.has(name))) return true;
    return evaluateFieldVisibility(field, values);
  }

  /** The same precedence for a tab. */
  isTabVisible(result: RuleEvaluationResult, tab: NestedTabConfig): boolean {
    if (result.hiddenTabs.includes(tab.id)) return false;
    return tab.visibility !== false || result.shownTabs.includes(tab.id);
  }

  /**
   * Keep a hidden field's control out of form validity.
   *
   * A field hidden by a rule or a `showWhen` is filtered out of the render, but its
   * validators stay attached — so a hidden *required* field holds `form.invalid` true
   * forever, permanently disabling Save with nothing on screen to explain why.
   *
   * Disabling is the fix rather than stripping validators: Angular excludes disabled controls
   * from validity, and the field's own validators survive intact for when it comes back.
   * Values are untouched — a disabled control still carries its value, so rule evaluation and
   * the emitted record see exactly what they saw before. That also keeps this from feeding
   * back on itself: hiding a field cannot change the values the rules are evaluated over.
   *
   * The predicate is `isFieldVisible`, the same one the render filter uses, so what is on
   * screen and what counts toward validity cannot drift apart.
   *
   * Entries must arrive parent-first, which is what `collectFieldScopes` yields: a container's
   * children are skipped once the container itself is hidden, because Angular's `disable()`
   * cascades to descendants and a child's `enable()` walks back up recalculating ancestors.
   * Toggling a child inside a hidden group would fight its parent.
   */
  syncHiddenFieldState(entries: readonly FieldScopeEntry[], ctx: RuleSyncContext): void {
    const hiddenContainers: string[] = [];

    for (const entry of entries) {
      const field = entry.field;
      if (!field?.id) continue;

      const address = ctx.addressOf(field);
      if (hiddenContainers.some(prefix => address.startsWith(`${prefix}.`))) continue;

      const hidden = !this.isFieldVisible(ctx.result, field, ctx.namesOf(field), ctx.values);
      if (hidden && (field.type === 'group' || field.type === 'array')) hiddenContainers.push(address);

      const ctrl = ctx.controlFor(entry);
      if (!ctrl) continue;

      if (hidden) {
        if (ctrl.enabled) ctrl.disable({ emitEvent: false });
      } else if (ctrl.disabled && !field.disabled) {
        ctrl.enable({ emitEvent: false });
      }
    }
  }

  /**
   * The hidden and shown names as sets, memoised against the result they came from.
   *
   * `isFieldVisible` runs once per field per change-detection pass; building two sets from
   * two arrays each time turns a rule result into allocation proportional to the form. A
   * `WeakMap` keyed by the result means it is built once per evaluation and collected with it.
   */
  private nameSets(result: RuleEvaluationResult): { hidden: Set<string>; shown: Set<string> } {
    let sets = this.nameSetCache.get(result);
    if (!sets) {
      sets = { hidden: new Set(result.hiddenFields), shown: new Set(result.shownFields) };
      this.nameSetCache.set(result, sets);
    }
    return sets;
  }

  private readonly nameSetCache = new WeakMap<
    RuleEvaluationResult,
    { hidden: Set<string>; shown: Set<string> }
  >();
}
