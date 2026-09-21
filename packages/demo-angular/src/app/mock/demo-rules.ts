import type { FormRule } from '@dynamic-entity/core';

/**
 * The rules the demo renders its forms with, keyed by entity.
 *
 * Both of these exist to be driven end to end, because both are behaviours that only a real
 * round trip can prove: the renderer's unit suites can assert the engine's output, but only
 * the demo shows a person a field appearing, or a section save being refused.
 *
 * They are addressed **by path** (`[personal.status]`), which is what the builder writes and
 * what a rule has to use to name a field inside a `group`. Before 2.0.0 a path matched
 * nothing when a tab's rules were filtered for a per-section save, so the second rule here
 * could not have fired at all.
 */
export const DEMO_RULES: Readonly<Record<string, FormRule[]>> = {
  employees: [
    {
      id: 'show-termination-reason',
      formConfigId: 'employees',
      fieldId: '[personal.status]',
      conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'Terminated' }],
      // `visibility: true` was a documented no-op until 2.0.0. `terminationReason` carries
      // `visibility: false` in the config, so this rule is the only thing that can put it on
      // screen — which is the point of a show: a rule that could only hide what the config
      // already hides would have nothing to say.
      action: { type: 'visibility', value: true },
      targets: [{ id: '[personal.terminationReason]', type: 'field' }],
      enabled: true,
      priority: 1,
    },
    {
      id: 'contact-email-required',
      formConfigId: 'employees',
      // Both the trigger and the target are inside a `group`, addressed by path. Per-section
      // save filters the rules down to the tab being saved, and that filter compared bare
      // ids against a tab's *top-level* fields — so this rule was silently absent from every
      // section save, and an employee could be saved without one.
      //
      // A `validation` action raises its message for as long as its conditions hold, so the
      // condition has to be the thing that makes the record wrong. Putting it on the status
      // field instead would raise an error no edit to the email could ever clear.
      fieldId: '[personal.contact.email]',
      conditions: [{ operator: 'IS_EMPTY', compareType: 'value' }],
      action: { type: 'validation', value: 'An employee needs a contact email.', severity: 'error' },
      targets: [{ id: '[personal.contact.email]', type: 'field' }],
      enabled: true,
      priority: 1,
    },
  ],
};

const STORAGE_KEY = 'de_demo_rules';

/**
 * Rules the user authored in the builder, by entity.
 *
 * A host has to store rules somewhere — they live beside a config, not inside it, so
 * `saveConfig` does not carry them. `localStorage` is what the rest of this demo uses, and
 * the point here is the round trip, not the storage: author a rule in the builder, save,
 * open the record form, watch it fire.
 */
function readSaved(): Record<string, FormRule[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, FormRule[]>) : {};
  } catch {
    // Private browsing and blocked site data make even reading throw. A demo that will not
    // open because it could not remember a rule is the worse failure.
    return {};
  }
}

/** Persist the rules authored for one entity. */
export function saveDemoRules(entity: string, rules: readonly FormRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readSaved(), [entity]: rules }));
  } catch {
    /* Nothing to do: the rules simply will not be remembered. */
  }
}

/**
 * The rules for an entity: what the user authored, else the shipped seed.
 *
 * Authored rules replace the seed rather than merging with it — a user who deletes a seeded
 * rule in the builder and saves means it to be gone.
 */
export function demoRulesFor(entity: string): FormRule[] {
  const saved = readSaved()[entity];
  return saved ?? DEMO_RULES[entity] ?? [];
}
