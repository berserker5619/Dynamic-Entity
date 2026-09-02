import { expect, test, type Page } from '@playwright/test';
import { builderPaletteButton, gotoDemo, recordButton, safeClick, safeSelect, selectMatOption } from './test-helpers';

/**
 * The libraries' own chrome follows the interface language.
 *
 * The unit specs prove the resolution rule: overrides beat defaults, per key, with the
 * English fallback. What they cannot show is that the resolved value actually reaches the
 * rendered button — the failure that started this work was a hundred templates holding
 * English literals that no token could touch, and that is only visible end to end.
 *
 * The demo's own configs are en-only, so a field label falls back to English while the
 * chrome switches. That is the point being demonstrated: the two are separately sourced.
 */
test.describe('interface language', () => {
  const german = (page: Page) => safeClick(page.getByTestId('ui-lang-de'));
  const english = (page: Page) => safeClick(page.getByTestId('ui-lang-en'));

  async function openAcme(page: Page): Promise<void> {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'clients');
    await safeClick(recordButton(page, 'Acme Corp'));
    await expect(page.getByTestId('form-actions')).toBeVisible();
  }

  async function openBuilder(page: Page): Promise<void> {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    await expect(page.locator('ngx-entity-builder')).toBeVisible();
  }

  test('the form actions are English until the language changes', async ({ page }) => {
    await openAcme(page);
    await expect(page.getByTestId('form-submit')).toHaveText(/Save/);
    await expect(page.getByTestId('form-reset')).toHaveText(/Reset/);
  });

  test('the form actions follow the language', async ({ page }) => {
    await openAcme(page);
    await german(page);

    await expect(page.getByTestId('form-submit')).toHaveText(/Speichern/);
    await expect(page.getByTestId('form-reset')).toHaveText(/Zurücksetzen/);
    // A bound attribute, not a text node — the sweep that found these missed attributes
    // entirely on its first pass.
    await expect(page.getByTestId('form-submit')).toHaveAttribute('title', /Strg\+S/);
  });

  test('switching back restores English, so nothing is one-way', async ({ page }) => {
    await openAcme(page);
    await german(page);
    await expect(page.getByTestId('form-submit')).toHaveText(/Speichern/);

    await english(page);
    await expect(page.getByTestId('form-submit')).toHaveText(/Save/);
  });

  test('config labels and library chrome are separately sourced', async ({ page }) => {
    await openAcme(page);
    await german(page);

    // The demo's configs are en-only, so a label falls back to English by the same per-key
    // rule the chrome follows. Both are visible at once, which is exactly the state that was
    // impossible to fix before: German labels around English buttons, inverted.
    await expect(page.getByTestId('form-panel')).toContainText('Company');
    await expect(page.getByTestId('form-submit')).toHaveText(/Speichern/);
  });

  test('the builder chrome follows uiLanguage', async ({ page }) => {
    await openBuilder(page);
    await expect(page.locator('.deb-toolbar__title')).toHaveText(/Entity Builder/);

    await german(page);
    await expect(page.locator('ngx-entity-builder')).toBeVisible();
    await expect(page.locator('.deb-toolbar__title')).toHaveText(/Entitäten-Baukasten/);
    await expect(page.getByTestId('builder-undo')).toBeVisible();
  });

  test('the builder chrome language is not the authoring language', async ({ page }) => {
    await openBuilder(page);
    await safeClick(builderPaletteButton(page, 'text'));

    const builder = page.locator('ngx-entity-builder');
    await expect(builder).toContainText(/Field id/);

    // `Editing language` chooses which LocalizedText entry a label is authored in. Wiring
    // the chrome to it would flip the whole interface every time an author switched the
    // language they were typing a label in, which is the opposite of what it means.
    await selectMatOption(page, 'builder-editing-language', 'de');

    await expect(page.locator('.deb-toolbar__title')).toHaveText(/Entity Builder/);
    await expect(builder).toContainText(/Field id/);
    await expect(builder).not.toContainText(/Feld-ID/);
  });
});
