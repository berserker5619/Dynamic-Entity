/**
 * Text contrast, in both colour schemes.
 *
 * The dark pass is the point. The renderer ships a `prefers-color-scheme: dark` block that
 * re-declares its whole palette on `.ngx-form` / `.ngx-record-editor` — the same selectors,
 * at the same specificity, a consumer overrides those tokens on. A consumer that pins some
 * of them and not others gets a hybrid: its own accent under the library's dark accent-text.
 * That is how Save came to be near-black on indigo at 3:1 for anyone whose machine was set
 * to dark, while every light-mode check passed and nothing ever looked at the other scheme.
 *
 * Ratios are computed here rather than delegated to axe because the failure was a *pairing*
 * between two stylesheets, and it only shows up once the composited colours are measured on
 * a live page in the scheme that triggers it.
 */
import { expect, test, type Page } from '@playwright/test';
import { gotoDemo, safeClick, safeSelect, recordButton } from './test-helpers';

type Bad = { text: string; fg: string; bg: string; ratio: number; need: number; size: number; cls: string };

// A real function, not a string: Playwright serialises it, so no escaping layer can eat a regex.
function auditAA(): Bad[] {
  type C = { r: number; g: number; b: number; a: number };
  const parse = (s: string): C | null => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    if (p.some(n => Number.isNaN(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (f: C, b: C): C => ({
    r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1,
  });
  const bgOf = (el: Element): C => {
    let n: Element | null = el, acc: C | null = null;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.01) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.99) return acc; }
      n = n.parentElement;
    }
    const pc = parse(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, pc) : pc;
  };
  const h2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  const hex = (c: C) => '#' + h2(c.r) + h2(c.g) + h2(c.b);
  const lum = (c: C) => {
    const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a: C, b: C) => {
    const A = lum(a), B = lum(b), hi = Math.max(A, B), lo = Math.min(A, B);
    return (hi + 0.05) / (lo + 0.05);
  };

  const out: Bad[] = [];
  const seen = new Set<string>();
  document.querySelectorAll('body *').forEach(el => {
    if (el.matches('script,style,svg,path,option,head')) return;
    // A gradient leaves backgroundColor transparent, so the surface cannot be sampled.
    if (getComputedStyle(el).backgroundImage !== 'none') return;
    // WCAG exempts disabled controls.
    if ((el as HTMLInputElement).disabled || el.closest('[disabled],[aria-disabled="true"]')) return;
    let own = '';
    el.childNodes.forEach(n => { if (n.nodeType === 3) own += n.textContent; });
    own = own.trim();
    if (!own) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.3) return;
    const fgR = parse(cs.color);
    if (!fgR || fgR.a < 0.3) return;
    const bg = bgOf(el);
    const fg = fgR.a < 1 ? over(fgR, bg) : fgR;
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight) || 400;
    /*
     * An icon font is a graphic, not text: its glyph carries the meaning and 1.4.11 asks 3:1
     * of it, not the 4.5:1 that prose owes a reader. Without this the ligature name inside
     * every <mat-icon> is scored as if someone had to read the word "add_circle_outline".
     */
    const isIcon = el.matches('mat-icon, .material-icons, [class*="material-icons"]');
    const need = isIcon || size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const cr = ratio(fg, bg);
    if (!Number.isFinite(cr) || cr >= need) return;
    const key = hex(fg) + hex(bg) + own.slice(0, 12);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: own.replace(/\s+/g, ' ').slice(0, 26), fg: hex(fg), bg: hex(bg),
      ratio: Math.round(cr * 100) / 100, need, size, cls: (el.className || '').toString().slice(0, 44) });
  });
  return out;
}

async function sweep(page: Page, scheme: string) {
  const steps: Array<[string, () => Promise<void>]> = [
    ['records list', async () => {}],
    ['record form', async () => {
      await safeSelect(page.locator('#entitySelect'), 'clients');
      await safeClick(recordButton(page, 'Acme Corp'));
      await expect(page.getByTestId('form-actions')).toBeVisible();
    }],
    ['record view', async () => { await safeClick(page.getByTestId('toggle-record-view')); }],
    ['entity manager', async () => { await safeClick(page.getByRole('button', { name: /Entity Manager/i })); }],
    ['builder', async () => {
      await safeClick(page.getByRole('button', { name: /Form Builder/i }));
      await safeSelect(page.getByTestId('builder-entity-select'), 'insuranceClaims');
      await page.locator('[data-testid="builder-field-row"]').first().click();
    }],
  ];
  for (const [name, go] of steps) {
    try { await go(); } catch { console.log(`  (${scheme}/${name} unreachable)`); continue; }
    await page.waitForTimeout(500);
    const bad = await page.evaluate(auditAA);
    expect(bad, `${scheme} / ${name}: ${JSON.stringify(bad, null, 2)}`).toEqual([]);
  }
}

test('light sweep', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoDemo(page); await sweep(page, 'LIGHT');
});
test.describe('dark', () => {
  test.use({ colorScheme: 'dark' });
  test('dark sweep', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoDemo(page); await sweep(page, 'DARK');
  });
});
