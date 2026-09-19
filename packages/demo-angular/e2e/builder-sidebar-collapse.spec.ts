import { expect, test, type Page } from '@playwright/test';
import { gotoDemo, safeClick, safeSelect } from './test-helpers';

/** What `Locator.boundingBox()` resolves to, minus the null a visible element never returns. */
type BoundingBox = { x: number; y: number; width: number; height: number };

/**
 * The builder's two side rails collapse, to give the canvas the screen on a laptop.
 *
 * These assertions are here rather than only in the unit suite because what makes a sidebar
 * collapse is CSS, and jsdom does not model enough of the cascade to see it. The unit test
 * can prove the `hidden` attribute is set; only a browser can prove the column then goes
 * away, that the remaining columns keep their row, and that nothing overflows.
 */
test.describe('builder sidebars collapse and reopen', () => {
  async function openBuilder(page: Page, entity?: string): Promise<void> {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: /Form Builder/i }));
    // `insuranceClaims` is the config with enough fields to fill a sidebar past the viewport.
    if (entity) await safeSelect(page.getByTestId('builder-entity-select'), entity);
    await expect(page.getByTestId('toggle-left-sidebar')).toBeVisible();
  }

  const horizontalOverflow = (page: Page): Promise<number> =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

  const width = async (page: Page, testId: string): Promise<number> =>
    (await page.getByTestId(testId).boundingBox())!.width;

  /** The track animates, so measurements have to wait for it to come to rest. */
  async function settled(page: Page, testId: string): Promise<number> {
    let last = -1;
    for (let i = 0; i < 20; i++) {
      const now = await width(page, testId);
      if (Math.abs(now - last) < 0.5) return now;
      last = now;
      await page.waitForTimeout(80);
    }
    return last;
  }

  /**
   * A whole box, read once the shell has stopped moving.
   *
   * `entity-builder.component.css` transitions `grid-template-columns` over 250ms, so a box
   * read straight after a collapse toggle is mid-animation geometry — the rail has not
   * reached its final `x` yet. That is exactly how `a collapsed side leaves a narrow rail`
   * failed on CI while passing on a developer's machine: the assertion was right and the
   * measurement was early, so the failure followed whichever machine was slower that day.
   *
   * Polls until two consecutive reads agree rather than sleeping for the transition's
   * declared duration — a fixed sleep is a guess that goes stale the moment the duration
   * changes, and costs its full length even when nothing is moving.
   */
  async function settledBox(page: Page, testId: string): Promise<BoundingBox> {
    const locator = page.getByTestId(testId);
    await expect(locator).toBeVisible();

    let last: BoundingBox | null = null;
    for (let i = 0; i < 25; i++) {
      const now = await locator.boundingBox();
      if (
        last &&
        now &&
        Math.abs(now.x - last.x) < 0.5 &&
        Math.abs(now.y - last.y) < 0.5 &&
        Math.abs(now.width - last.width) < 0.5 &&
        Math.abs(now.height - last.height) < 0.5
      ) {
        return now;
      }
      last = now;
      await page.waitForTimeout(60);
    }
    throw new Error(`settledBox: "${testId}" never stopped moving`);
  }

  /*
    * Pinned to a desktop width on purpose: the default 1280 viewport now sits below the
    * 1300px breakpoint, where the inspector stacks under the canvas and there is no third
    * column to reason about. This test is about the three-column layout.
    */
  test('each side collapses independently and gives its room to the canvas', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBuilder(page);
    const left = page.getByTestId('builder-left-sidebar');
    const right = page.getByTestId('builder-right-sidebar');

    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    await expect(page.getByTestId('expand-left-sidebar')).toHaveCount(0);
    const bothOpen = await settled(page, 'builder-canvas-column');

    await safeClick(page.getByTestId('toggle-left-sidebar'));
    await expect(left).toBeHidden();
    await expect(right).toBeVisible();
    const leftCollapsed = await settled(page, 'builder-canvas-column');
    expect(leftCollapsed).toBeGreaterThan(bothOpen);

    await safeClick(page.getByTestId('toggle-right-sidebar'));
    await expect(right).toBeHidden();
    const bothCollapsed = await settled(page, 'builder-canvas-column');
    expect(bothCollapsed).toBeGreaterThan(leftCollapsed);
  });

  /**
   * Collapsing the inspector widens the palette column, not the canvas.
   *
   * The canvas was the wrong place for that space: a field row wants about 380px and the rest
   * was gutter between a label and its badges, while the tab cards next to it were truncating
   * names to "Persona". `--deb-left-wide` is computed as left + right - rail, so the palette
   * gains exactly what the inspector gave up and the canvas does not move at all.
   */
  test('the inspector hands its width to the palette, not to the canvas', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBuilder(page, 'insuranceClaims');
    await page.waitForTimeout(400);

    const before = {
      left: await settled(page, 'builder-left-sidebar'),
      canvas: await settled(page, 'builder-canvas-column'),
      right: await settled(page, 'builder-right-sidebar'),
    };

    await safeClick(page.getByTestId('toggle-right-sidebar'));
    await expect(page.getByTestId('builder-right-sidebar')).toBeHidden();
    await page.waitForTimeout(600);

    const after = {
      left: await settled(page, 'builder-left-sidebar'),
      canvas: await settled(page, 'builder-canvas-column'),
    };

    // The canvas is unmoved, and the palette gained what the inspector released.
    expect(Math.abs(after.canvas - before.canvas)).toBeLessThanOrEqual(2);
    expect(after.left - before.left).toBeGreaterThan(before.right * 0.75);
  });

  /**
   * A narrower canvas is only an improvement while the rows still fit inside it.
   *
   * The phone widths are here for a different reason than the desktop ones. A row carries a
   * handle, a type icon, a name, two badges and four 40px buttons — and on touch there is no
   * hover to hide the buttons behind, so all of it is on screen at once and wants about 380px
   * in a canvas 308px wide. The row wraps below 560px; without that it overflowed its own card.
   */
  test('field rows fit the canvas at every width', async ({ page }) => {
    for (const width of [412, 560, 768, 1250, 1320, 1440, 1600, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 412) await openBuilder(page, 'insuranceClaims');
      await page.waitForTimeout(500);
      // Selecting a row reveals its action buttons — the widest the row ever gets.
      await page.locator('[data-testid="builder-field-row"]').first().click();
      await page.waitForTimeout(300);

      const worst = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="builder-field-row"]'))
          .reduce((m, el) => Math.max(m, el.scrollWidth - el.clientWidth), 0),
      );
      expect(worst, `field rows overflow by ${worst}px at ${width}px wide`).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The regression this guards: the rail button is a child of the same grid as the columns,
   * so a collapsed side that dropped its track left the grid with more children than columns
   * and pushed the inspector onto a second row underneath the canvas.
   */
  test('the inspector keeps its place beside the canvas when the palette collapses', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBuilder(page);
    await safeClick(page.getByTestId('toggle-left-sidebar'));
    await expect(page.getByTestId('builder-left-sidebar')).toBeHidden();

    const canvas = await settledBox(page, 'builder-canvas-column');
    const inspector = await settledBox(page, 'builder-right-sidebar');

    expect(inspector.x).toBeGreaterThan(canvas.x + canvas.width - 1);
    expect(Math.abs(inspector.y - canvas.y)).toBeLessThan(40);
  });

  test('a collapsed side leaves a narrow rail that reopens it', async ({ page }) => {
    await openBuilder(page);
    await safeClick(page.getByTestId('toggle-left-sidebar'));
    await safeClick(page.getByTestId('toggle-right-sidebar'));
    // Both sides are mid-transition here, and this test used to measure straight through it.
    await expect(page.getByTestId('builder-left-sidebar')).toBeHidden();
    await expect(page.getByTestId('builder-right-sidebar')).toBeHidden();

    const canvas = await settledBox(page, 'builder-canvas-column');
    const railLeft = await settledBox(page, 'expand-left-sidebar');
    const railRight = await settledBox(page, 'expand-right-sidebar');

    // Rails flank the canvas rather than floating over it.
    expect(railLeft.x).toBeLessThan(canvas.x);
    expect(railRight.x).toBeGreaterThan(canvas.x + canvas.width - 1);
    expect(railLeft.width).toBeLessThan(60);
    expect(railRight.width).toBeLessThan(60);

    await safeClick(page.getByTestId('expand-left-sidebar'));
    await expect(page.getByTestId('builder-left-sidebar')).toBeVisible();
    await safeClick(page.getByTestId('expand-right-sidebar'));
    await expect(page.getByTestId('builder-right-sidebar')).toBeVisible();
  });

  test('the collapse button inside each card closes its own side', async ({ page }) => {
    await openBuilder(page);
    await safeClick(page.getByTestId('collapse-left-sidebar'));
    await expect(page.getByTestId('builder-left-sidebar')).toBeHidden();
    await expect(page.getByTestId('builder-right-sidebar')).toBeVisible();

    await safeClick(page.getByTestId('collapse-right-sidebar'));
    await expect(page.getByTestId('builder-right-sidebar')).toBeHidden();
  });

  /**
   * Between 900 and 1300px an *expanded* inspector drops under the canvas, because 380px is
   * width the canvas cannot spare. A collapsed one is only a rail, so it keeps its column and
   * stays in sight — it used to follow the panel down and strand itself under the live
   * preview, a long scroll from the canvas it had just made room on.
   */
  test('at 1100px a collapsed rail keeps its column beside the canvas', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openBuilder(page);
    const overflowBefore = await horizontalOverflow(page);

    await safeClick(page.getByTestId('toggle-right-sidebar'));
    await expect(page.getByTestId('builder-right-sidebar')).toBeHidden();

    const canvas = await settledBox(page, 'builder-canvas-column');
    const rail = await settledBox(page, 'expand-right-sidebar');
    expect(rail.x).toBeGreaterThan(canvas.x + canvas.width - 1);
    expect(rail.y).toBeLessThan(canvas.y + 80);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(overflowBefore);
  });

  /**
   * On a phone everything stacks, rails included: a field row already wants more width than
   * the viewport has, so the canvas keeps every pixel and collapsing costs it none.
   *
   * Reaching a collapsed panel here does not depend on seeing its rail. The toolbar is
   * sticky, so the toggle that reopens it is on screen at any scroll position — which is the
   * assertion that matters, and the one that replaces hunting for the rail.
   */
  test('on a phone the canvas keeps its width and the toolbar stays reachable', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 800 });
    await openBuilder(page, 'insuranceClaims');
    await page.waitForTimeout(300);

    const canvasBefore = (await page.getByTestId('builder-canvas-column').boundingBox())!.width;
    const overflowBefore = await horizontalOverflow(page);

    await safeClick(page.getByTestId('toggle-left-sidebar'));
    await expect(page.getByTestId('builder-left-sidebar')).toBeHidden();
    await page.waitForTimeout(400);

    const canvasAfter = (await page.getByTestId('builder-canvas-column').boundingBox())!.width;
    expect(canvasAfter).toBeGreaterThanOrEqual(canvasBefore - 1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(overflowBefore);

    // Scroll well down the canvas; the toolbar and its toggle come along.
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(400);
    const bar = (await page.locator('.deb-toolbar').boundingBox())!;
    expect(bar.y).toBeGreaterThanOrEqual(-1);
    expect(bar.y).toBeLessThan(80);

    await safeClick(page.getByTestId('toggle-left-sidebar'));
    await expect(page.getByTestId('builder-left-sidebar')).toBeVisible();
  });

  /** The sticky bar must not sit on top of the panel it toggles. */
  test('the sticky toolbar never covers the sidebar beneath it', async ({ page }) => {
    await openBuilder(page, 'insuranceClaims');
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(400);

    const bar = (await page.locator('.deb-toolbar').boundingBox())!;
    const left = (await page.getByTestId('builder-left-sidebar').boundingBox())!;
    expect(left.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  });

  test('neither sidebar clips its own content', async ({ page }) => {
    await openBuilder(page, 'insuranceClaims');
    // A field has to be selected for the inspector to hold anything worth measuring.
    await page.locator('[data-testid="builder-field-row"]').first().click();
    await page.waitForTimeout(400);

    const clipped = await page.evaluate(() =>
      ['.deb-card--palette', '.deb-card--inspector'].map(sel => {
        const el = document.querySelector(sel);
        return { sel, hidden: el ? el.scrollHeight - el.clientHeight : -1 };
      }),
    );

    for (const card of clipped) {
      expect(card.hidden, `${card.sel} hides ${card.hidden}px of its content`).toBeLessThanOrEqual(1);
    }

    // And the column is what scrolls instead.
    const column = await page.evaluate(() => {
      const el = document.querySelector('.deb-col--left')!;
      return { overflowY: getComputedStyle(el).overflowY, scrollable: el.scrollHeight > el.clientHeight };
    });
    expect(column.overflowY).toBe('auto');
    expect(column.scrollable).toBe(true);
  });

  /**
   * The builder stores nothing itself; the demo host binds the state and keeps it. Testing it
   * here rather than in the library is the point — this is the wiring a consumer copies.
   */
  test('a collapsed panel is still collapsed after a reload', async ({ page }) => {
    await openBuilder(page);
    await safeClick(page.getByTestId('toggle-left-sidebar'));
    await expect(page.getByTestId('builder-left-sidebar')).toBeHidden();

    /*
     * A second page in the same context, not `reload()`: `gotoDemo` registers an init script
     * that clears every `de_demo_` key, and Playwright re-runs that on each navigation of the
     * page it was registered on — including a reload, which would wipe the very key under
     * test. A sibling page carries no init script and shares the same origin's storage, so
     * this is the fresh load a person actually gets.
     */
    const fresh = await page.context().newPage();
    await fresh.goto('/');
    await safeClick(fresh.getByRole('button', { name: /Form Builder/i }));

    await expect(fresh.getByTestId('builder-left-sidebar')).toBeHidden();
    await expect(fresh.getByTestId('expand-left-sidebar')).toBeVisible();
    // The side that was left open is still open, so the two are remembered separately.
    await expect(fresh.getByTestId('builder-right-sidebar')).toBeVisible();
    await fresh.close();
  });

  /**
   * Collapsing destroys the button that was pressed. Without help the browser drops focus on
   * `<body>`, and a keyboard user restarts the tab sequence from the top of the document.
   */
  test('focus follows the panel rather than falling to the body', async ({ page }) => {
    await openBuilder(page);
    const focusedTestId = () =>
      page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);

    await safeClick(page.getByTestId('collapse-left-sidebar'));
    await expect(page.getByTestId('expand-left-sidebar')).toBeFocused();
    expect(await focusedTestId()).toBe('expand-left-sidebar');

    // And back the other way, into the control that closes it again.
    await page.getByTestId('expand-left-sidebar').press('Enter');
    await expect(page.getByTestId('collapse-left-sidebar')).toBeFocused();
  });

  test('the rail is reachable and operable by keyboard alone', async ({ page }) => {
    await openBuilder(page);
    await safeClick(page.getByTestId('toggle-left-sidebar'));
    await expect(page.getByTestId('builder-left-sidebar')).toBeHidden();

    // Tab from the top of the document until the rail takes focus.
    await page.locator('body').press('Tab');
    for (let i = 0; i < 40; i++) {
      const onRail = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') === 'expand-left-sidebar',
      );
      if (onRail) break;
      await page.keyboard.press('Tab');
    }
    await expect(page.getByTestId('expand-left-sidebar')).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('builder-left-sidebar')).toBeVisible();
  });

  test('each control reports the panel it owns and whether it is open', async ({ page }) => {
    await openBuilder(page);
    const left = page.getByTestId('toggle-left-sidebar');
    const right = page.getByTestId('toggle-right-sidebar');

    await expect(left).toHaveAttribute('aria-expanded', 'true');
    await expect(left).toHaveAttribute('aria-controls', 'deb-left-sidebar');
    await expect(page.locator('#deb-left-sidebar')).toHaveCount(1);
    await expect(right).toHaveAttribute('aria-controls', 'deb-right-sidebar');
    await expect(page.locator('#deb-right-sidebar')).toHaveCount(1);

    await safeClick(left);
    await expect(left).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('expand-left-sidebar')).toHaveAttribute('aria-expanded', 'false');

    // Icon-only controls still have to say what they are.
    for (const id of ['toggle-left-sidebar', 'toggle-right-sidebar', 'expand-left-sidebar']) {
      const name = await page.getByTestId(id).getAttribute('aria-label');
      expect(name, `${id} has no accessible name`).toBeTruthy();
    }
  });

  /**
   * A 44px rail can only hold a word by turning it on its side, and a rotated word is one you
   * read by tilting your head — worse in German, where the inspector's name is thirteen
   * letters. So the standing rail shows the panel's own icon and leaves the words to the
   * tooltip; the label comes back only where the rail lies flat and can be read normally.
   */
  test('the standing rail shows an icon, not a word turned on its side', async ({ page }) => {
    await openBuilder(page);
    await safeClick(page.getByTestId('toggle-left-sidebar'));
    const rail = page.getByTestId('expand-left-sidebar');
    await expect(rail).toBeVisible();

    // The identifying icon is what is actually on screen.
    await expect(rail.locator('.deb-dock-btn__icon')).toBeVisible();
    await expect(rail.locator('.deb-dock-btn__label')).toBeHidden();

    // Nothing on screen is rotated.
    const rotated = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.deb-dock-btn *')).some(el => {
        const wm = getComputedStyle(el).writingMode;
        return wm.startsWith('vertical') || wm.startsWith('sideways');
      }),
    );
    expect(rotated).toBe(false);

    // The words still exist, for anyone who hovers or listens.
    expect(await rail.getAttribute('aria-label')).toBeTruthy();

    // Flat rail, narrow screen: the label is readable, so it is shown.
    await page.setViewportSize({ width: 412, height: 800 });
    await page.waitForTimeout(400);
    await expect(rail.locator('.deb-dock-btn__label')).toBeVisible();
  });

  test('collapsing never pushes the page into horizontal scroll', async ({ page }) => {
    await openBuilder(page);
    await safeClick(page.getByTestId('toggle-left-sidebar'));
    await safeClick(page.getByTestId('toggle-right-sidebar'));
    await page.waitForTimeout(400);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
