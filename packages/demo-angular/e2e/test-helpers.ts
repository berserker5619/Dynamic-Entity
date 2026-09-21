import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The mask the demo renders, imported rather than repeated.
 *
 * `demo-mask.ts` has no imports of its own precisely so this line is safe: the value these
 * assertions expect and the value the application provides to `MASKED_PLACEHOLDER` cannot
 * drift apart. `XXXXXXXXX` is still the *library* default, and
 * `masked-placeholder-reaches-every-field.spec.ts` in the renderer package is what pins it.
 */
export { DEMO_MASK } from '../src/app/mock/demo-mask';

export async function gotoDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.keys(window.localStorage)
      .filter(key => key.startsWith('de_demo_'))
      .forEach(key => window.localStorage.removeItem(key));
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dynamic Entity Demo' })).toBeVisible();
}

export function recordButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name: new RegExp(name, 'i') });
}

/**
 * Locators below address the DOM through `data-testid`, never through CSS classes.
 *
 * Class names are presentation: the builder tree (phase 7.1) and the Material rewrite
 * (phase 9) both replace the markup these specs used to assert on. The hooks are the
 * contract that survives both, so a rewrite lands under a green suite instead of taking
 * the suite with it.
 *
 * Naming: a field is `field-{fieldId}`, its parts `field-{fieldId}-{part}` where part is
 * one of input / value / masked / error / hint / month / year / add / row / remove-{i}.
 * A field **root** also carries `data-field-type`, which is the only way to say "a field"
 * without also matching its parts — every part id starts with `field-` too.
 */

/** A field's root element, found by its visible label. Prefer `fieldById` when the id is known. */
export function fieldByLabel(page: Page, label: string): Locator {
  return page.locator('[data-field-type]').filter({ hasText: label }).first();
}

/** A field's root element by field id — exact, and immune to label or language changes. */
export function fieldById(page: Page, fieldId: string): Locator {
  return page.getByTestId(`field-${fieldId}`);
}

/** One part of a field: `fieldPart(page, 'salary', 'masked')`. */
export function fieldPart(page: Page, fieldId: string, part: string): Locator {
  return page.getByTestId(`field-${fieldId}-${part}`);
}

/** Every field row on the builder canvas — countable. */
export function builderFieldRows(page: Page): Locator {
  return page.getByTestId('builder-field-row');
}

/** The id badge of one builder row, which is how a spec proves a field was created. */
export function builderRowId(page: Page, fieldId: string): Locator {
  return page.getByTestId(`row-id-${fieldId}`);
}

/** Tab-name inputs in the builder's tab manager, in order. */
export function builderTabInputs(page: Page): Locator {
  return page.locator('[data-testid^="tab-row-"] mat-form-field input');
}

export function builderPaletteButton(page: Page, name: string): Locator {
  return page.locator('[data-testid^="palette-"]').filter({ hasText: name }).first();
}

export async function safeClick(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 5000 });
  const tagName = await locator.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
  if (['button', 'input', 'select', 'textarea'].includes(tagName)) {
    await expect(locator).toBeEnabled({ timeout: 5000 });
  }
  await locator.click();
}

export async function safeFill(locator: Locator, value: string): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 5000 });
  await locator.fill(value);
}

export async function fillFieldByLabel(page: Page, label: string, value: string): Promise<void> {
  const field = fieldByLabel(page, label);
  const input = field.locator('input,textarea').first();
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(value);
}

/**
 * Select an option by DOM value, falling back to its exact label.
 *
 * The label fallback is not optional: an option holding a `LocalizedText` is bound with
 * `[ngValue]`, so its DOM value is Angular's `"1: Object"` and only the label identifies it.
 *
 * Matching is **exact**. A previous version fell back to a case-insensitive substring match,
 * which meant `safeSelect(select, 'Active')` would happily land on "Inactive" — a test could
 * assert the wrong option was chosen and still pass.
 */
export async function safeSelect(locator: Locator, value: string): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 5000 });
  try {
    await locator.selectOption(value, { timeout: 2000 });
    return;
  } catch {
    // Fall through to the label match below.
  }

  const labels = (await locator.locator('option').allInnerTexts()).map(text => text.trim());
  const match = labels.find(label => label === value.trim());
  if (!match) {
    throw new Error(`safeSelect: no option with value or label "${value}". Options: ${labels.join(' | ')}`);
  }
  await locator.selectOption({ label: match });
}

/**
 * Picks an option from an Angular Material `mat-select`.
 *
 * Material opens the option list in a CDK overlay with a full-screen backdrop, and closing it
 * is animated — the backdrop outlives the click that dismissed it. A second interaction
 * started before it detaches lands on the backdrop instead of the trigger, so the select
 * never reopens and the next option is simply never in the DOM. That surfaced as an
 * "element(s) not found" on roughly one run in twenty, always on the *second* select of a
 * test, never the first.
 *
 * Waiting for the backdrop to detach is what makes the sequence deterministic.
 */
export async function selectMatOption(page: Page, triggerTestId: string, optionName: string): Promise<void> {
  await safeClick(page.getByTestId(triggerTestId));
  // Scoped to the open panel: a native `<option>` also carries role=option, so an unscoped
  // lookup matches every entity in the two `<select>` elements on the page and fails strict
  // mode. It passed until an option name happened to collide with one of them. The panel is
  // the only `listbox` on the page — a collapsed native select exposes none.
  await safeClick(page.getByRole('listbox').getByRole('option', { name: optionName }));
  await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
}

/**
 * Whether the form would refuse a save right now.
 *
 * Save is deliberately not `disabled` while a form is merely invalid — a disabled button
 * cannot explain itself, and pressing it is how the user gets the error summary and the jump
 * to the first offending field. The form says "this will not go yet" with `aria-disabled`
 * instead, which is what these assert on.
 *
 * Deliberately not asserted by clicking Save: a refused submit switches tabs and moves focus
 * to the first invalid field, so using it as a probe would walk the test off the tab it was
 * working on. These read `data-blocked` instead, which the form sets for exactly this state
 * and which the stylesheet mutes the button with. The specs that are *about* the refusal
 * press the button and assert on `error-summary`.
 */
export async function expectSaveWithheld(page: Page): Promise<void> {
  await expect(page.getByTestId('form-submit')).toHaveAttribute('data-blocked', '');
}

export async function expectSaveReady(page: Page): Promise<void> {
  const save = page.getByTestId('form-submit');
  await expect(save).not.toHaveAttribute('data-blocked', '');
  await expect(save).toBeEnabled();
}

/**
 * Opens one of the field inspector's collapsible sections, by its heading.
 *
 * The inspector's advanced half — Display, Visibility, Automation, Rules, Reference — starts
 * closed for a field that does not use it, and a closed `<details>` hides its contents from
 * the page as well as from the eye. A spec that wants to *add* the first condition or the
 * first rule to a field has to open the section, which is what a person does too.
 *
 * Idempotent: a section that is already open (because the field already uses it) is left
 * alone, so a spec need not know which state it will find.
 */
export async function openInspectorSection(page: Page, heading: string): Promise<void> {
  const section = page.locator('details.deb-inspector__section').filter({
    has: page.locator('summary', { hasText: heading }),
  });
  await expect(section).toHaveCount(1);
  if (await section.evaluate((el: HTMLDetailsElement) => el.open)) return;
  await safeClick(section.locator('summary'));
  await expect(section).toHaveAttribute('open', '');
}

/** The inspector's Label input for the active language. */
export async function setInspectorLabel(page: Page, label: string): Promise<void> {
  await safeFill(page.getByTestId('field-label'), label);
}

/**
 * Add one inline option to the selected choice field.
 *
 * The Options section is open by default, but a closed `<details>` hides the control, and
 * the live preview under the canvas re-renders on every edit — so the click is the test-id,
 * not a substring match on "Option" (which also matches the section heading "Options").
 */
export async function addInspectorOption(page: Page, label: string): Promise<void> {
  await openInspectorSection(page, 'Options');
  const rows = page.getByTestId('option-row');
  const before = await rows.count();
  await safeClick(page.getByTestId('add-option'));
  await expect(rows).toHaveCount(before + 1);
  await safeFill(rows.nth(before).locator('input'), label);
}

export interface PageErrorMonitor {
  readonly errors: string[];
  readonly libraryWarnings: string[];
  assertNoErrors(): void;
}

/**
 * Monitors the page for unhandled exceptions, console errors, and [ngx-dynamic-entity] warnings.
 */
export function capturePageErrors(page: Page): PageErrorMonitor {
  const errors: string[] = [];
  const libraryWarnings: string[] = [];

  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      errors.push(`Console error: ${text}`);
    } else if (msg.type() === 'warning' && text.includes('[ngx-dynamic-entity]')) {
      libraryWarnings.push(text);
    }
  });

  return {
    errors,
    libraryWarnings,
    assertNoErrors() {
      expect(errors, `Expected no page errors or console errors, but found: ${errors.join('; ')}`).toEqual([]);
      expect(libraryWarnings, `Expected no [ngx-dynamic-entity] warnings, but found: ${libraryWarnings.join('; ')}`).toEqual([]);
    },
  };
}

/** Fills an input or textarea identified by testId. */
export async function fillMatInput(page: Page, testId: string, value: string): Promise<void> {
  const locator = page.getByTestId(testId);
  const target = (await locator.locator('input,textarea').count()) > 0 ? locator.locator('input,textarea').first() : locator;
  await safeFill(target, value);
}
