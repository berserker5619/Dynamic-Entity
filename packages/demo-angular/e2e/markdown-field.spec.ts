import { expect, test, type Page } from '@playwright/test';
import { fieldPart, gotoDemo, recordButton, safeClick, safeFill, safeSelect } from './test-helpers';

/**
 * `markdown` end to end, on the `complexFullTest` config.
 *
 * The unit specs cover the component in isolation with a stub renderer. What they cannot
 * show is the thing that actually matters to a consumer: that the source survives a real
 * save and reload, and that what lands in storage is markdown rather than HTML.
 *
 * The demo registers a small local `MARKDOWN_RENDERER`, so the rendered path, the Preview
 * tab and sanitisation are all reachable here rather than only in unit tests with a stub.
 */
test.describe('markdown field', () => {
  const SOURCE = '# Title\n\nSome **bold** text.';

  async function openFirstRecord(page: Page): Promise<void> {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'complexFullTest');
    await safeClick(recordButton(page, 'Helena Vasquez'));
    await expect(page.locator('[data-testid="form-panel"]')).toBeVisible();
  }

  test('edits markdown in a textarea and shows the seeded source', async ({ page }) => {
    await openFirstRecord(page);

    const input = fieldPart(page, 'releaseNotes', 'input');
    await expect(input).toBeVisible();
    // Seeded as markdown source, and shown back verbatim.
    await expect(input).toHaveValue(/^# Q3 rollout/);
    await expect(input).toHaveValue(/\*\*three\*\*/);
  });

  test('offers Write and Preview, and Preview renders the source', async ({ page }) => {
    await openFirstRecord(page);

    await safeClick(fieldPart(page, 'releaseNotes', 'preview'));
    const preview = fieldPart(page, 'releaseNotes', 'preview-body');
    // The seeded source starts `# Q3 rollout` and contains `**three**`.
    await expect(preview.locator('h1')).toHaveText('Q3 rollout');
    await expect(preview.locator('strong')).toHaveText('three');
    await expect(preview.locator('li')).toHaveCount(3);

    // Write returns to the source, unchanged by having been previewed.
    await safeClick(fieldPart(page, 'releaseNotes', 'write'));
    await expect(fieldPart(page, 'releaseNotes', 'input')).toHaveValue(/^# Q3 rollout/);
  });

  test('escapes HTML in the source rather than letting it through', async ({ page }) => {
    await openFirstRecord(page);
    await safeFill(
      fieldPart(page, 'releaseNotes', 'input'),
      '# Title\n\n<script>window.pwned = true;</script>',
    );
    await safeClick(fieldPart(page, 'releaseNotes', 'preview'));

    const preview = fieldPart(page, 'releaseNotes', 'preview-body');
    await expect(preview.locator('h1')).toHaveText('Title');
    await expect(preview.locator('script')).toHaveCount(0);
    // Escaped, so the author can see what they typed rather than losing it silently.
    await expect(preview).toContainText('<script>');
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['pwned'])).toBeUndefined();
  });

  test('stores the source through a save and reload, never HTML', async ({ page }) => {
    await openFirstRecord(page);

    await safeFill(fieldPart(page, 'releaseNotes', 'input'), SOURCE);
    await safeClick(page.getByRole('button', { name: /^Save$/i }));
    await safeClick(recordButton(page, 'Helena Vasquez'));

    await expect(fieldPart(page, 'releaseNotes', 'input')).toHaveValue(SOURCE);

    // The record is the contract: plain markdown, no markup, nothing rendered on the way in.
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('de_demo_records_complexFullTest');
      const rows = raw ? (JSON.parse(raw) as Record<string, any>[]) : [];
      return rows[0]?.['generalTab']?.['releaseNotes'] ?? null;
    });
    expect(stored).toBe(SOURCE);
    expect(stored).not.toContain('<h1');
    expect(stored).not.toContain('<strong');
  });

  test('renders the markdown in Data only, not the raw source', async ({ page }) => {
    await openFirstRecord(page);
    await safeClick(page.getByTestId('mode-data'));

    const value = fieldPart(page, 'releaseNotes', 'value');
    await expect(value).toBeVisible();
    // A read-only view is where rendering matters most — nobody wants to read `**bold**`.
    await expect(value.locator('h1')).toHaveText('Q3 rollout');
    await expect(value.locator('strong')).toHaveText('three');
    await expect(value).not.toContainText('# Q3 rollout');
  });

  test('is masked for a role that may not see it', async ({ page }) => {
    await gotoDemo(page);
    await safeSelect(page.locator('#entitySelect'), 'complexFullTest');
    await safeClick(page.getByRole('button', { name: 'Viewer (Readonly)', exact: true }));
    await safeClick(recordButton(page, 'Helena Vasquez'));

    // `complexFullTest` denies `viewer` edit rights, so the whole record is read-only —
    // the markdown field included, rendered as a value rather than a textarea.
    await expect(fieldPart(page, 'releaseNotes', 'input')).toHaveCount(0);
    await expect(fieldPart(page, 'releaseNotes', 'value')).toBeVisible();
  });
});
