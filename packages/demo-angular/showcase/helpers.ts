import type { Locator, Page } from '@playwright/test';

/** A pause long enough for a viewer to register what just changed. */
export const beat = (page: Page, ms = 900): Promise<void> => page.waitForTimeout(ms);

/** Types like a person rather than pasting, so the field is readable while it fills. */
export async function typeInto(locator: Locator, text: string, delay = 35): Promise<void> {
  await locator.click();
  await locator.pressSequentially(text, { delay });
}

/**
 * Puts the shot back at the top.
 *
 * Playwright scrolls whatever it is about to click into view, so a clip that touches the
 * palette and then the preview drifts and never comes back — the frame wanders while the app
 * stands still.
 *
 * Resetting `window` alone does nothing here: the builder body is its own scroll container
 * (`max-height: calc(100vh - 40px); overflow: auto`), so the window is already at zero while
 * the columns are half-way down. Anything actually scrolled gets reset.
 */
export async function toTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo({ top: 0 });
    document.querySelectorAll('*').forEach(el => {
      if (el.scrollTop > 0) el.scrollTop = 0;
    });
  });
  await page.waitForTimeout(240);
}
