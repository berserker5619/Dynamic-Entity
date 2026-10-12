/**
 * import-columns.ts — what a spreadsheet may contain for a given config, and whether a plan fits it.
 *
 * The derivation is in `import-derive.ts` and is re-exported from here unchanged, so this is
 * still where it is imported from. What this file adds is `validateMappingPlan`, which since
 * 3.0 is sheet-to-schema's plan reader and checks, run over `entityFormConfigAdapter`.
 */

import { preparePlan } from 'sheet-to-schema';
import { entityFormConfigAdapter } from './entity-form-config-adapter';
import type { EntityFormConfig } from './form-model.types';
import type { DeriveColumnsOptions } from './import-derive';
import type { AnyMappingPlan } from './import-model.types';
import type { ConfigProblem } from './validate-config';

export * from './import-derive';

/**
 * A 2.x plan that names no entity, given the config's.
 *
 * A 2.x plan with no `entity`, or an empty one, was read without complaint: there was simply
 * nothing to compare with the config. The plan reader requires a target, because a plan that
 * names none cannot be checked against any schema. Here the schema is known, so a 2.x plan is
 * taken to be for it, which is what 2.x did.
 *
 * **Only a 2.x plan.** Plan v2 says `planVersion: 2` and must name its `target`: a v2 plan
 * without one is refused, as the spec has it. Anything that is not a plan is left for the
 * reader to refuse too.
 *
 * One v2 plan is let through: `target: ''`, the empty string. That is what `suggestMapping`
 * writes when its caller passes no entity, as its two-argument form always allowed, and such a
 * suggestion has to be importable against the config it was made for. A v2 plan with no
 * `target` at all was written by something else, and is refused.
 */
export function planFor(plan: unknown, config: EntityFormConfig | null | undefined): unknown {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) return plan;
  const named = plan as { target?: unknown; entity?: unknown; planVersion?: unknown };
  if (named.target || named.entity) return plan;
  const entity = config?.entity ?? '';
  if (named.planVersion !== undefined) return named.target === '' ? { ...plan, target: entity } : plan;
  const rest = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'target' && key !== 'entity'));
  return { ...rest, entity };
}

/**
 * Check a mapping plan against the config it claims to target.
 *
 * Returns `ConfigProblem[]` — the same shape `validateConfig` returns, so a plan's problems
 * print through `formatConfigProblems` and read like a config's. A server must run this
 * **before** reading a single row: a plan naming fields that do not exist is not something to
 * discover halfway through a 50,000-row file.
 *
 * Takes a plan in either shape, v2 or 2.x. Since 3.0 the checks are sheet-to-schema's, so the
 * messages are its messages: tell problems apart by `code`.
 */
export function validateMappingPlan(
  plan: AnyMappingPlan | null | undefined,
  config: EntityFormConfig | null | undefined,
  options: DeriveColumnsOptions = {},
): ConfigProblem[] {
  const adapter = entityFormConfigAdapter(config as EntityFormConfig, {
    includeReadonly: options.includeReadonly ?? false,
    includeSystemDefault: options.includeSystemDefault ?? false,
  });
  return preparePlan(planFor(plan, config), adapter).problems;
}
