import { expect, test, type Page } from '@playwright/test';
import { builderRowId, fieldById, fieldPart, gotoDemo, recordButton, safeClick, safeSelect } from './test-helpers';

/**
 * The builder operations no other spec drives: removing and duplicating a field, the tab
 * manager, the two centre panels, the rule graph's navigation, the rule list, permissions,
 * and Save refusing an invalid schema.
 *
 * Every test that changes the schema saves it and reads back what the demo persisted —
 * `de_demo_configs` for the config, `de_demo_rules` for rules — or drives the record form
 * that consumes it. A builder that showed the change and saved something else fails.
 *
 * **Not covered, because the UI has no such control:** reordering *sub-tabs*. The tab
 * manager offers move up/down on top-level tabs only; a sub-tab can be added, renamed and
 * removed. Coverage steps may add test hooks, not features, so this stays a gap.
 *
 * **The live preview does not apply rules** — the demo renders it with no `[rules]` — so a
 * disabled rule is proved through the record form after Save, which is where it matters.
 */

type Json = Record<string, any>;

async function openBuilder(page: Page, entity: string): Promise<void> {
  await gotoDemo(page);
  await safeClick(page.getByRole('button', { name: 'Form Builder' }));
  await safeSelect(page.getByTestId('builder-entity-select'), entity);
  await expect(page.getByTestId('builder-toolbar-entity')).toHaveText(entity);
}

async function saveBuilder(page: Page): Promise<void> {
  await safeClick(page.getByRole('button', { name: /^Save/ }).first());
  await expect(page.getByTestId('builder-toast')).toHaveAttribute('data-error', 'false');
}

async function savedConfig(page: Page, entity: string): Promise<Json> {
  const config = await page.evaluate(
    name => (JSON.parse(localStorage.getItem('de_demo_configs') ?? '[]') as Json[]).find(c => c['entity'] === name),
    entity,
  );
  if (!config) throw new Error(`no saved config for ${entity}`);
  return config;
}

async function savedRules(page: Page, entity: string): Promise<Json[] | undefined> {
  return page.evaluate(
    name => (JSON.parse(localStorage.getItem('de_demo_rules') ?? '{}') as Record<string, Json[]>)[name],
    entity,
  );
}

const fieldIds = (tab: Json): string[] => (tab['fields'] ?? []).map((f: Json) => f['id']);
const preview = (page: Page) => page.getByTestId('builder-preview');
const selectRow = (page: Page, fieldId: string) => safeClick(page.getByTestId(`row-label-${fieldId}`));

test.describe('fields', () => {
  test('removing a field takes it off the canvas and the preview; undo puts it back', async ({ page }) => {
    await openBuilder(page, 'employees');
    await expect(preview(page).getByTestId('field-lastName')).toBeVisible();

    await safeClick(page.getByTestId('row-delete-lastName'));
    await expect(builderRowId(page, 'lastName')).toHaveCount(0);
    await expect(preview(page).getByTestId('field-lastName')).toHaveCount(0);

    await safeClick(page.getByTestId('builder-undo'));
    await expect(builderRowId(page, 'lastName')).toBeVisible();
    await expect(preview(page).getByTestId('field-lastName')).toBeVisible();

    await safeClick(page.getByTestId('row-delete-lastName'));
    await saveBuilder(page);
    const personal = (await savedConfig(page, 'employees'))['tabs'].find((t: Json) => t['id'] === 'personal');
    expect(fieldIds(personal)).not.toContain('lastName');
    expect(fieldIds(personal)).toContain('firstName');
  });

  test('duplicating a field inserts a copy with a new id and the same settings', async ({ page }) => {
    await openBuilder(page, 'clients');
    const rowsBefore = await page.getByTestId('builder-field-row').count();

    await safeClick(page.getByTestId('row-duplicate-name'));
    await expect(page.getByTestId('builder-field-row')).toHaveCount(rowsBefore + 1);

    // The copy is selected, so the inspector names it.
    const copyId = await page.getByTestId('field-id').inputValue();
    expect(copyId).not.toBe('name');
    await expect(builderRowId(page, copyId)).toBeVisible();

    await saveBuilder(page);
    const general = (await savedConfig(page, 'clients'))['tabs'][0];
    const ids = fieldIds(general);
    // Inserted directly after its source.
    expect(ids.indexOf(copyId)).toBe(ids.indexOf('name') + 1);
    const source = general['fields'].find((f: Json) => f['id'] === 'name');
    const copy = general['fields'].find((f: Json) => f['id'] === copyId);
    const settings = (f: Json) => {
      const rest = { ...f };
      delete rest['id'];
      delete rest['refererField'];
      return rest;
    };
    expect(settings(copy)).toEqual(settings(source));
    expect(copy['validators']).toEqual({ required: true });
  });
});

test.describe('tabs', () => {
  test('add, rename and reorder a tab, and add and rename a sub-tab', async ({ page }) => {
    await openBuilder(page, 'employees');
    const tabRows = page.locator('[data-testid^="tab-row-"]');
    const before = await tabRows.count();

    await safeClick(page.getByTestId('add-tab'));
    await expect(tabRows).toHaveCount(before + 1);
    const newTabId = ((await tabRows.last().getAttribute('data-testid')) ?? '').replace('tab-row-', '');
    expect(newTabId).toBeTruthy();

    await page.getByTestId(`tab-label-${newTabId}`).fill('Benefits');
    // Last to second-to-last.
    await safeClick(page.getByTestId(`tab-up-${newTabId}`));
    await expect(tabRows.nth(before - 1)).toHaveAttribute('data-testid', `tab-row-${newTabId}`);

    const subRows = page.locator('[data-testid^="subtab-row-"]');
    const subBefore = await subRows.count();
    await safeClick(page.getByTestId(`add-subtab-${newTabId}`));
    await expect(subRows).toHaveCount(subBefore + 1);
    const subId = ((await subRows.last().getAttribute('data-testid')) ?? '').replace('subtab-row-', '');
    await page.getByTestId(`subtab-label-${subId}`).fill('Pension');

    // A field, so the new tab is not an empty one the renderer would skip.
    await safeClick(page.locator('[data-testid^="palette-"]').filter({ hasText: 'Text' }).first());

    await saveBuilder(page);
    const tabs = (await savedConfig(page, 'employees'))['tabs'] as Json[];
    expect(tabs).toHaveLength(before + 1);
    const moved = tabs[before - 1];
    expect(moved['id']).toBe(newTabId);
    expect(moved['label']['en']).toBe('Benefits');
    expect(tabs[before]['id']).toBe('addressesTab');
    expect(moved['children']).toHaveLength(1);
    expect(moved['children'][0]).toMatchObject({ id: subId, label: { en: 'Pension' } });
  });
});

test.describe('centre panels', () => {
  test('fields and preview collapse and expand independently, by toolbar and by card', async ({ page }) => {
    await openBuilder(page, 'employees');
    const fields = page.getByTestId('builder-fields-section');
    const previewSection = page.getByTestId('builder-preview-section');

    await safeClick(page.getByTestId('collapse-fields'));
    await expect(fields).toBeHidden();
    await expect(previewSection).toBeVisible();
    await safeClick(page.getByTestId('expand-fields'));
    await expect(fields).toBeVisible();

    await safeClick(page.getByTestId('collapse-preview'));
    await expect(previewSection).toBeHidden();
    await expect(fields).toBeVisible();
    await safeClick(page.getByTestId('expand-preview'));
    await expect(previewSection).toBeVisible();

    await safeClick(page.getByTestId('toggle-fields'));
    await expect(fields).toBeHidden();
    await expect(page.getByTestId('toggle-fields')).toHaveAttribute('aria-expanded', 'false');
    await safeClick(page.getByTestId('toggle-fields'));
    await expect(fields).toBeVisible();

    await safeClick(page.getByTestId('toggle-preview'));
    await expect(previewSection).toBeHidden();
    await expect(page.getByTestId('toggle-preview')).toHaveAttribute('aria-expanded', 'false');
  });

  test('a collapsed centre panel is still collapsed after a reload', async ({ page }) => {
    await openBuilder(page, 'employees');
    await safeClick(page.getByTestId('collapse-preview'));
    await expect(page.getByTestId('builder-preview-section')).toBeHidden();

    // A sibling page, not reload(): gotoDemo's init script clears every de_demo_ key on each
    // navigation of the page it was registered on. See builder-sidebar-collapse.spec.ts.
    const fresh = await page.context().newPage();
    await fresh.goto('/');
    await safeClick(fresh.getByRole('button', { name: 'Form Builder' }));
    await expect(fresh.getByTestId('expand-preview')).toBeVisible();
    await expect(fresh.getByTestId('builder-preview-section')).toBeHidden();
    await expect(fresh.getByTestId('builder-fields-section')).toBeVisible();
    await fresh.close();
  });
});

test.describe('rule graph', () => {
  test('clicking a node selects that field in the canvas and the inspector', async ({ page }) => {
    await openBuilder(page, 'employees');

    await safeClick(page.getByTestId('builder-rule-graph'));
    const dialog = page.getByTestId('rule-graph-dialog');
    await expect(dialog).toBeVisible();
    const card = dialog.locator('[data-testid^="edge-card-"]').filter({ hasText: 'terminationReason' }).first();
    await expect(card).toBeVisible();

    // The target chip: the field the rule shows.
    await safeClick(card.locator('.deb-node-chip--target'));
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('field-id')).toHaveValue('terminationReason');

    // And the source chip of the same edge selects the trigger.
    await safeClick(page.getByTestId('builder-rule-graph'));
    await safeClick(
      page.locator('[data-testid^="edge-card-"]').filter({ hasText: 'terminationReason' }).first().locator('.deb-node-chip--source'),
    );
    await expect(page.getByTestId('field-id')).toHaveValue('status');
  });
});

test.describe('rule list', () => {
  test('reordering renumbers priority, and the order is what Save persists', async ({ page }) => {
    await openBuilder(page, 'employees');
    await selectRow(page, 'email');
    await expect(page.getByTestId('rule-item')).toHaveCount(1);

    // The email rule is second in the entity's list; moving it up puts it first.
    await safeClick(page.getByTestId('rule-up-contact-email-required'));
    await saveBuilder(page);

    const rules = (await savedRules(page, 'employees'))!;
    expect(rules.map(r => [r['id'], r['priority']])).toEqual([
      ['contact-email-required', 1],
      ['show-termination-reason', 2],
    ]);
  });

  test('a disabled rule is saved disabled and stops firing in the record form', async ({ page }) => {
    await openBuilder(page, 'employees');
    await selectRow(page, 'status');
    await safeClick(page.getByTestId('rule-enabled-show-termination-reason'));
    await expect(page.getByTestId('rule-item')).toHaveClass(/deb-rule-item--off/);
    await saveBuilder(page);

    const rule = (await savedRules(page, 'employees'))!.find(r => r['id'] === 'show-termination-reason');
    expect(rule?.['enabled']).toBe(false);

    await safeClick(page.getByRole('button', { name: 'Clients Data' }));
    await safeSelect(page.locator('#entitySelect'), 'employees');
    await safeClick(recordButton(page, 'John'));
    await safeSelect(fieldPart(page, 'status', 'input'), 'Terminated');
    // Enabled, this rule shows the field; disabled, the config's visibility: false stands.
    await expect(fieldById(page, 'terminationReason')).toHaveCount(0);
  });

  test('a deleted rule leaves rulesChange, and the record form stops enforcing it', async ({ page }) => {
    await openBuilder(page, 'employees');
    await selectRow(page, 'email');
    await safeClick(page.getByTestId('rule-delete-contact-email-required'));
    await expect(page.getByTestId('rules-empty')).toBeVisible();
    await saveBuilder(page);

    const rules = (await savedRules(page, 'employees'))!;
    expect(rules.map(r => r['id'])).toEqual(['show-termination-reason']);

    // The section save the rule used to refuse now goes through.
    await safeClick(page.getByRole('button', { name: 'Clients Data' }));
    await safeSelect(page.locator('#entitySelect'), 'employees');
    await safeClick(recordButton(page, 'John'));
    await safeClick(page.getByTestId('toggle-record-view'));
    await safeClick(page.getByTestId('edit-section'));
    await fieldPart(page, 'email', 'input').fill('');
    await safeClick(page.getByTestId('save-section'));
    await expect(page.getByTestId('section-errors')).toHaveCount(0);
    await expect(page.getByTestId('edit-section')).toBeVisible();
  });
});

test.describe('permissions', () => {
  async function setEditRoles(page: Page, add: string[], remove: string[]): Promise<void> {
    const panel = page.locator('mat-expansion-panel.deb-rbac');
    if ((await panel.getAttribute('class'))?.includes('mat-expanded') !== true) {
      await safeClick(panel.locator('mat-expansion-panel-header'));
    }
    await safeClick(page.getByTestId('permission-roles-edit'));
    const listbox = page.getByRole('listbox');
    for (const role of [...add, ...remove]) {
      await safeClick(listbox.getByRole('option', { name: role, exact: true }));
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
  }

  async function viewerOpensJohn(page: Page): Promise<void> {
    await safeClick(page.getByRole('button', { name: 'Clients Data' }));
    await safeSelect(page.locator('#entitySelect'), 'employees');
    await safeClick(page.getByRole('button', { name: 'Viewer (Readonly)', exact: true }));
    await safeClick(recordButton(page, 'John'));
    await expect(page.getByTestId('form-panel')).toBeVisible();
  }

  test('a role added to edit can edit, and removed again is locked out', async ({ page }) => {
    await openBuilder(page, 'employees');
    await setEditRoles(page, ['admin', 'viewer'], []);
    await saveBuilder(page);
    expect((await savedConfig(page, 'employees'))['permissions']['edit']).toEqual(
      expect.arrayContaining(['admin', 'viewer']),
    );

    await viewerOpensJohn(page);
    await expect(fieldPart(page, 'firstName', 'input')).toBeVisible();
    await expect(page.getByTestId('form-submit')).toBeVisible();

    await safeClick(page.getByRole('button', { name: 'Admin', exact: true }));
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await safeSelect(page.getByTestId('builder-entity-select'), 'employees');
    await setEditRoles(page, [], ['viewer']);
    await saveBuilder(page);
    expect((await savedConfig(page, 'employees'))['permissions']['edit']).not.toContain('viewer');

    await viewerOpensJohn(page);
    await expect(fieldPart(page, 'firstName', 'input')).toHaveCount(0);
    await expect(fieldPart(page, 'firstName', 'value')).toBeVisible();
  });
});

test.describe('save', () => {
  test('is refused while the schema has an error, and nothing is persisted', async ({ page }) => {
    await openBuilder(page, 'employees');
    const before = JSON.stringify(await savedConfig(page, 'employees'));

    await page.getByTestId('builder-entity-name').fill('');
    await expect(page.getByTestId('builder-problems')).toContainText('1');
    await safeClick(page.getByTestId('builder-problems'));
    await expect(page.getByTestId('builder-problem').filter({ hasText: 'Entity name is required.' })).toBeVisible();
    await page.keyboard.press('Escape');

    const save = page.getByRole('button', { name: /^Save/ }).first();
    await expect(save).toBeDisabled();
    await save.click({ force: true });
    await expect(page.getByTestId('builder-toast')).toHaveCount(0);
    expect(JSON.stringify(await savedConfig(page, 'employees'))).toBe(before);
  });
});
