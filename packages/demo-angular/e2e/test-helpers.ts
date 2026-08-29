import { expect, type Locator, type Page } from '@playwright/test';

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
  return page
    .locator('[data-testid^="palette-"]')
    .filter({ hasText: name })
    .first();
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
    throw new Error(
      `safeSelect: no option with value or label "${value}". Options: ${labels.join(' | ')}`,
    );
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
  await safeClick(page.getByRole('option', { name: optionName }));
  await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
}
