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
  /*
   * One rule per behaviour that only a browser can show: a banner a person dismisses, a tab
   * that leaves the form, a warning that depends on what the record was loaded with, and a
   * field that answers an array growing. `rules-banners-and-tabs.spec.ts` drives each.
   */
  patientIntake: [
    {
      id: 'severe-pain-banner',
      formConfigId: 'patientIntake',
      fieldId: '[clinicalHistory.painLevel]',
      // `info` is always a dismissible banner. It is keyed by target, so it sits on the slider
      // that raised it rather than at the top of the form.
      conditions: [{ operator: 'MORE_THAN_EQUAL', compareType: 'value', value: 8 }],
      action: { type: 'info', value: 'Severe pain reported: notify the attending physician.' },
      targets: [{ id: '[clinicalHistory.painLevel]', type: 'field' }],
      enabled: true,
      priority: 1,
    },
    {
      id: 'hide-consent-for-minors',
      formConfigId: 'patientIntake',
      fieldId: '[demographics.dateOfBirth]',
      // A minor's consent is a guardian's, recorded elsewhere, so the whole tab goes — and with
      // it the three required fields on it, which a hidden tab must not hold a Save hostage to.
      // The cut-off is computed when the demo loads: a fixed date would make every patient
      // an adult eventually, and the rule would quietly stop firing.
      conditions: [{ operator: 'DATE_AFTER', compareType: 'value', value: adultCutoff() }],
      action: { type: 'visibility', value: false },
      targets: [{ id: 'consentSignoff', type: 'tab' }],
      enabled: true,
      priority: 1,
    },
    {
      id: 'triage-change-warning',
      formConfigId: 'patientIntake',
      fieldId: '[demographics.triageLevel]',
      // Against the record as it was loaded, not the previous keystroke: re-selecting the
      // original level clears the warning again.
      conditions: [{ operator: 'VALUE_CHANGED', compareType: 'value' }],
      action: {
        type: 'validation',
        value: 'Triage level changed: record the reason in the chief complaint.',
        severity: 'warning',
      },
      targets: [{ id: '[demographics.triageLevel]', type: 'field' }],
      enabled: true,
      priority: 1,
    },
    {
      id: 'show-allergy-action-plan',
      formConfigId: 'patientIntake',
      fieldId: '[clinicalHistory.knownAllergens]',
      // `allergyActionPlan` carries `visibility: false`, so this show is the only way onto the
      // screen — the first allergen added puts it there, removing the last takes it away.
      conditions: [{ operator: 'HAS_ITEMS', compareType: 'value' }],
      action: { type: 'visibility', value: true },
      targets: [{ id: '[clinicalHistory.allergyActionPlan]', type: 'field' }],
      enabled: true,
      priority: 1,
    },
  ],
};

/** Eighteen years before today, as the bare `YYYY-MM-DD` a date field stores. */
function adultCutoff(): string {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${today.getFullYear() - 18}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

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
