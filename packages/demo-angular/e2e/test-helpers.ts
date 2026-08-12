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

export function fieldByLabel(page: Page, label: string): Locator {
  return page.locator('.ngx-field').filter({ hasText: label }).first();
}

export function builderPaletteButton(page: Page, name: string): Locator {
  return page.locator('ngx-field-palette .deb-palette__item').filter({ hasText: name }).first();
}

export async function safeClick(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 5000 });
  try {
    await expect(locator).toBeEnabled({ timeout: 5000 });
  } catch {
    // Some elements (like anchors) may not expose enabled state; ignore.
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
