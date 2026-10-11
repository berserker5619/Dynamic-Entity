/**
 * validate-plan.ts — the checks that need the adapter's targets (spec §4, Decision 10).
 *
 * `readPlan` has already made every check a plan can fail on its own, so the plan here is
 * well-formed. What remains is whether it fits this schema: every ref a target, every `split`
 * on a list, every `lists` key and `collect` entry one of the schema's arrays, and the
 * target and version the plan was written for.
 *
 * Run after `readPlan` and after the adapter's `upgradeRefs`, so a 2.2 ref has already been
 * rewritten and is not reported as unknown.
 */
import type { ImportTarget, SchemaAdapter } from './adapter.types';
import type { NormalizedPlan, PlanProblem } from './plan.types';
import { planSlots, slotOf } from './plan-slots';
import type { PlanProblemCode } from './problem-codes';

export function validatePlan<TMeta, TCtx>(plan: NormalizedPlan, adapter: SchemaAdapter<TMeta, TCtx>): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const add = (level: PlanProblem['level'], code: PlanProblemCode, path: string, message: string): void => {
    problems.push({ level, code, path, message });
  };

  // §4: the plan's target and version against the adapter's. Never an error.
  if (plan.target !== adapter.id) {
    add('warning', 'PLAN_TARGET_MISMATCH', 'target', `The plan was written for "${plan.target}"; this schema is "${adapter.id}".`);
  }
  if (plan.schemaVersion !== undefined && adapter.version !== undefined && plan.schemaVersion !== adapter.version) {
    add(
      'warning',
      'PLAN_TARGET_MISMATCH',
      'schemaVersion',
      `The plan was written against schema version ${plan.schemaVersion}; it is now ${adapter.version}.`,
    );
  }

  // Sized from the plan itself (§7). A collected array is mapped by shape ref, with no slot,
  // so it is asked for one slot to learn its item targets.
  const collected = new Set(plan.group?.collect ?? []);
  const slots = planSlots(plan);
  for (const ref of collected) slots[ref] = Math.max(slots[ref] ?? 0, 1);
  const set = adapter.targets({ slots });

  const byRef = new Map<string, ImportTarget<TMeta>>(set.targets.map(target => [target.ref, target]));
  const byShape = new Map<string, ImportTarget<TMeta>>();
  for (const target of set.targets) {
    if (target.arrayRef !== undefined && collected.has(target.arrayRef)) byShape.set(target.shapeRef, target);
  }
  const arrays = new Map(set.arrays.map(array => [array.ref, array]));

  plan.entries.forEach((entry, i) => {
    const at = `entries[${i}].ref`;
    const slot = slotOf(entry.ref);
    // §6: one item per row means an item ref with no slot index.
    if (slot && collected.has(slot.arrayRef)) {
      add('error', 'PLAN_GROUP', at, `"${slot.arrayRef}" is collected across a group's rows, so its fields are mapped without a slot index.`);
      return;
    }
    const target = byShape.get(entry.ref) ?? byRef.get(entry.ref);
    if (!target) {
      add('error', 'PLAN_UNKNOWN_REF', at, `References unknown field "${entry.ref}".`);
      return;
    }
    if (entry.split !== undefined && target.value.kind !== 'list') {
      add('error', 'PLAN_SPLIT_TARGET', `entries[${i}].split`, `"${entry.ref}" is not a list, so its cells cannot be split.`);
    }
  });

  for (const [ref, options] of Object.entries(plan.lists ?? {})) {
    const at = `lists[${JSON.stringify(ref)}]`;
    const array = arrays.get(ref);
    if (!array) {
      add('error', 'PLAN_LIST_OPTION', at, `"${ref}" is not one of this schema's arrays.`);
      continue;
    }
    // §6: never silently compacted when the adapter cannot keep positions.
    if (options.compact === false && !array.positional) {
      add('error', 'PLAN_LIST_OPTION', `${at}.compact`, `"${ref}" cannot keep empty slots in place; this schema compacts it.`);
    }
  }

  plan.group?.collect.forEach((ref, i) => {
    if (!arrays.has(ref)) add('error', 'PLAN_GROUP', `group.collect[${i}]`, `"${ref}" is not one of this schema's arrays.`);
  });

  return problems;
}
