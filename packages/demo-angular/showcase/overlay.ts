import type { Page } from '@playwright/test';

/**
 * A cursor and a caption bar, injected into the page itself.
 *
 * Playwright dispatches real mouse events but the browser draws no pointer, so a screen
 * recording shows fields filling and panels opening with no visible cause — the single thing
 * that made the first cut unwatchable. This draws a pointer that follows those events and
 * pulses on click, and a caption bar the spec writes to as it goes.
 *
 * Burned into the recording rather than added afterwards, so there is no separate edit pass
 * and the caption is always in sync with what is on screen.
 */
const SCRIPT = `
(() => {
  if (window.__showcaseReady) return;
  window.__showcaseReady = true;

  let caption = null;
  let pending = '';

  // The init script runs at document start, before <head> exists, so the API is defined now
  // and the elements are built once the document has one. Without this, the first caption
  // call raced the page and threw.
  window.__caption = text => {
    pending = text || '';
    if (caption) {
      caption.textContent = pending;
      caption.classList.toggle('on', !!pending);
    }
  };

  const build = () => {
    if (caption) return;
    const style = document.createElement('style');
    style.textContent = \`
      #showcase-cursor {
        position: fixed; z-index: 2147483647; width: 22px; height: 22px;
        margin: -11px 0 0 -11px; border-radius: 50%; pointer-events: none;
        background: rgba(37, 99, 235, 0.35);
        border: 2px solid rgba(37, 99, 235, 0.95);
        box-shadow: 0 0 0 2px rgba(255,255,255,0.85);
        transition: transform 90ms ease-out; left: -100px; top: -100px;
      }
      #showcase-cursor.down { transform: scale(0.55); background: rgba(37, 99, 235, 0.75); }
      #showcase-ping {
        position: fixed; z-index: 2147483646; width: 22px; height: 22px;
        margin: -11px 0 0 -11px; border-radius: 50%; pointer-events: none;
        border: 2px solid rgba(37, 99, 235, 0.9); opacity: 0;
      }
      @keyframes showcase-ping { from { transform: scale(1); opacity: 0.9; } to { transform: scale(3.2); opacity: 0; } }
      #showcase-caption {
        position: fixed; z-index: 2147483647; left: 50%; bottom: 26px; transform: translateX(-50%);
        max-width: 84vw; padding: 12px 24px; border-radius: 999px;
        background: rgba(15, 23, 42, 0.94); color: #fff; pointer-events: none;
        font: 600 20px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
        text-align: center; box-shadow: 0 8px 28px rgba(0,0,0,0.34);
        opacity: 0; transition: opacity 220ms ease;
      }
      #showcase-caption.on { opacity: 1; }
    \`;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = 'showcase-cursor';
    const ping = document.createElement('div');
    ping.id = 'showcase-ping';
    caption = document.createElement('div');
    caption.id = 'showcase-caption';
    document.documentElement.append(cursor, ping, caption);

    addEventListener('mousemove', e => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    }, true);
    addEventListener('mousedown', e => {
      cursor.classList.add('down');
      ping.style.left = e.clientX + 'px';
      ping.style.top = e.clientY + 'px';
      ping.style.animation = 'none';
      void ping.offsetWidth;
      ping.style.animation = 'showcase-ping 520ms ease-out';
    }, true);
    addEventListener('mouseup', () => cursor.classList.remove('down'), true);

    window.__caption(pending);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build, { once: true });
  } else {
    build();
  }
})();
`;

/** Injects the cursor and caption bar, and keeps them across navigations. */
export async function installOverlay(page: Page): Promise<void> {
  await page.addInitScript(SCRIPT);
}

/** Puts a line on screen, and holds it long enough to be read. */
export async function say(page: Page, text: string, hold = 1500): Promise<void> {
  await page.evaluate(t => (window as unknown as { __caption(s: string): void }).__caption(t), text);
  await page.waitForTimeout(hold);
}

/** Clears the caption. */
export async function clearCaption(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __caption(s: string): void }).__caption(''));
}
