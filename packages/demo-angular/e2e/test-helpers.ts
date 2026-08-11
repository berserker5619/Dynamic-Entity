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

export async function safeSelect(locator: Locator, value: string): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 5000 });
  try {
    await locator.selectOption(value);
  } catch {
    try {
      await locator.selectOption({ label: value });
    } catch {
      const options = await locator.locator('option').allInnerTexts();
      const match = options.find(opt => opt.trim().toLowerCase() === value.trim().toLowerCase() || opt.trim().toLowerCase().includes(value.trim().toLowerCase()));
      if (match) {
        await locator.selectOption({ label: match.trim() });
      } else {
        await locator.selectOption(value);
      }
    }
  }
}
