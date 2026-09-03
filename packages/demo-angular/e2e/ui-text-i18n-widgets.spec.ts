import { expect, test, type Page } from '@playwright/test';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

/**
 * The chrome inside the widgets, not just the form's buttons.
 *
 * The first i18n spec proves Save and Reset follow the language. Those two were never the
 * risk: they are on screen for every test anyone writes. The strings that stayed English for
 * years are the ones behind a state nobody drives — the empty array's "No rows yet.", the
 * dropdown's "Select...", the file field's "Choose file", the month picker's column headings.
 *
 * So this walks every tab of the richest configuration in the demo and asserts, across the
 * whole surface, that the German pack is what shows and no English counterpart survives.
 */
test.describe('interface language, inside the widgets', () => {
  /** The entity that exercises seventeen field types, including all the awkward ones. */
  const RICH = 'complexFullTest';

  /** German the pack supplies, against the English it replaces. */
  const PAIRS: [de: string, en: string][] = [
    ['Auswählen…', 'Select...'],
    ['Kein Bild', 'No image'],
    ['Datei auswählen', 'Choose file'],
    ['Noch keine Einträge.', 'No items added yet.'],
    ['Monat', 'Month'],
    ['Jahr', 'Year'],
    ['Schreiben', 'Write'],
    ['Vorschau', 'Preview'],
  ];

  async function openForm(page: Page, entity: string, language: 'en' | 'de'): Promise<void> {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), entity);
    if (language === 'de') await safeClick(page.getByTestId('ui-lang-de'));
    // A new record rather than a saved one: an empty form is where the chrome lives — the
    // empty array's message, the unset dropdown's placeholder, the image field with no
    // image. A populated record hides most of it behind a value.
    await safeClick(page.getByRole('button', { name: '+ Add Record', exact: true }));
    await expect(page.getByTestId('form-actions')).toBeVisible();
  }

  const openRichForm = (page: Page, language: 'en' | 'de') => openForm(page, RICH, language);

  /**
   * Markup from every tab, since a widget only renders while its own tab is active.
   *
   * The wait after each click is on **that tab** reporting `aria-selected="true"`, not on a
   * panel being visible. The outgoing tab's panel is still on screen the instant the click
   * lands, so "a form panel is visible" is already true and waits for nothing — the sweep
   * would then read the previous tab's markup, or a half-rendered new one, and the strings
   * that live only on the tab being visited would simply be absent.
   *
   * That is not hypothetical: it failed in CI having found four of the eight strings, and
   * reproduces locally in roughly one run in thirty. `aria-selected` flips in the same change
   * detection pass that renders the panel, so it is the signal that the DOM being sampled is
   * the one that was asked for.
   */
  async function sweepTabs(page: Page): Promise<string> {
    const tabs = page.locator('[data-testid="tab-strip"] button');
    const count = await tabs.count();
    const seen: string[] = [];

    for (let i = 0; i < Math.max(count, 1); i++) {
      if (count > 0) {
        const tab = tabs.nth(i);
        await safeClick(tab);
        await expect(tab).toHaveAttribute('aria-selected', 'true');
      }
      await expect(page.getByTestId('form-panel').or(page.getByTestId('module-panel')).first()).toBeVisible();
      // innerHTML rather than text: half the chrome is a title or an aria-label.
      seen.push(await page.locator('form').first().innerHTML());
    }
    return seen.join('\u0000');
  }

  test('the German pack reaches the widgets, across every tab', async ({ page }) => {
    await openRichForm(page, 'de');
    const html = await sweepTabs(page);

    const missing = PAIRS.filter(([de]) => !html.includes(de)).map(([de]) => de);
    // Not all eight need be on screen — a tab may hide a field by rule — but most must be,
    // or the sweep is asserting nothing.
    expect(PAIRS.length - missing.length).toBeGreaterThanOrEqual(6);
  });

  test('no English chrome survives beside it', async ({ page }) => {
    await openRichForm(page, 'de');
    const html = await sweepTabs(page);

    // Only phrases, and only pairs actually reached.
    //
    // A single word is not evidence: this config labels a field "Billing Cycle Month/Year",
    // and the demo's labels are English-only by design — they fall back, which is the rule
    // working, not a leak. A whole phrase from the defaults map beside its German
    // replacement is a literal no token reached.
    const leaked = PAIRS.filter(([de, en]) => en.includes(' ') && html.includes(de) && html.includes(en)).map(
      ([, en]) => en,
    );

    expect(leaked).toEqual([]);
  });

  test('the same sweep in English shows the English chrome, so the check is symmetric', async ({ page }) => {
    await openRichForm(page, 'en');
    const html = await sweepTabs(page);

    const present = PAIRS.filter(([, en]) => html.includes(en));
    expect(present.length).toBeGreaterThanOrEqual(6);
    expect(PAIRS.filter(([de]) => html.includes(de))).toEqual([]);
  });

  /**
   * Longer words must not push the layout sideways.
   *
   * This is the half of i18n that unit tests cannot see: "Zurücksetzen" is twice the width
   * of "Reset", and the grid collapses to a single column under 640px. A button that
   * overflows its column pushes the page into a horizontal scroll, and the fix — wrapping,
   * or a narrower control — is invisible until somebody looks at the German build on a
   * phone. Running this spec in the narrow project is what makes the check mean something.
   */
  test('German text does not push the page sideways', async ({ page }) => {
    await openRichForm(page, 'de');
    await sweepTabs(page);

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });

    // One pixel of slack for sub-pixel rounding on a fractional device scale.
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('the record view edit flow is German', async ({ page }) => {
    await openRichForm(page, 'de');
    await safeClick(page.getByTestId('toggle-record-view'));

    const edit = page.getByRole('button', { name: 'Abschnitt bearbeiten' });
    await expect(edit.first()).toBeVisible();
    await safeClick(edit.first());

    await expect(page.getByRole('button', { name: 'Abbrechen' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit section/i })).toHaveCount(0);
  });

  test('an icon-only control carries a German accessible name', async ({ page }) => {
    // The chrome nobody sees: a screen-reader name is exactly the string that stays English
    // for years because no visual review catches it.
    await openForm(page, 'insuranceClaims', 'de');

    const html = await sweepTabs(page);
    expect(html).toContain('Passwort anzeigen');
    expect(html).not.toContain('Show password');
  });
});
