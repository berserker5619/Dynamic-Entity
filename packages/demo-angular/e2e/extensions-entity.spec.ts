import { expect, test, type Page } from '@playwright/test';
import { builderPaletteButton, fieldById, fieldPart, gotoDemo, safeClick, safeSelect } from './test-helpers';

/**
 * The `extensions` entity — the extension points that need schema support.
 *
 * Named validators, an async validator, a `beforeSave` hook that vetoes, a record migration,
 * an upload handler and a field type the library does not ship. Every one of these existed
 * only in unit tests and prose until this entity gave them somewhere to be used.
 *
 * A new entity rather than a change to an existing one: all six need fields of their own,
 * and adding them to `clients` or `insuranceClaims` would have put the specs that assert on
 * those at risk for nothing.
 */

const SAVE = 'form-submit';

async function openExtensions(page: Page): Promise<void> {
  await gotoDemo(page);
  await safeSelect(page.locator('#entitySelect'), 'extensions');
}

async function openRecord(page: Page, label: string): Promise<void> {
  await openExtensions(page);
  await safeClick(page.getByRole('button', { name: label }));
}

async function newRecord(page: Page): Promise<void> {
  await openExtensions(page);
  await safeClick(page.getByRole('button', { name: '+ Add Record' }));
}

test.describe('migrations — a record one config version behind', () => {
  /**
   * `ext_001` is stamped `_configVersion: 1` and still carries the v1 field name, `name`.
   * The config declares version 2, so opening the record runs the registered 1 → 2 step
   * before the form is patched. Without the migration the Title box opens empty: the field
   * is `title` and the record has never held one.
   */
  test('opens with the renamed field populated from the old one', async ({ page }) => {
    await openRecord(page, 'Legacy Sample');
    await expect(fieldPart(page, 'title', 'input')).toHaveValue('Legacy Sample');
  });

  test('leaves a record already at the current version alone', async ({ page }) => {
    await openRecord(page, 'Current Sample');
    await expect(fieldPart(page, 'title', 'input')).toHaveValue('Current Sample');
  });
});

test.describe('validators — a synchronous rule named from the schema', () => {
  /**
   * `validators: { custom: ['noShouting'] }` in the config; the function itself is registered
   * through `provideNgxDynamicEntity`. Removing the registration leaves the name unresolved,
   * the field valid, and Save enabled — which is what this asserts against.
   */
  test('blocks the save and reports it when the rule fails', async ({ page }) => {
    await openRecord(page, 'Current Sample');

    const title = fieldPart(page, 'title', 'input');
    await title.fill('SHOUTING at everyone');
    await title.blur();

    // A custom error key is not on any built-in field type's list of known keys, so the
    // message comes from the `invalid` fallback — which the demo overrides and localizes.
    await expect(fieldPart(page, 'title', 'error')).toHaveText('That value is not allowed.');
    await expect(page.getByTestId(SAVE)).toBeDisabled();

    await title.fill('Quiet again');
    await title.blur();
    await expect(page.getByTestId(SAVE)).toBeEnabled();
  });

  test('the built-in minlength message is translated too', async ({ page }) => {
    await openRecord(page, 'Current Sample');

    const title = fieldPart(page, 'title', 'input');
    await title.fill('ab');
    await title.blur();
    await expect(fieldPart(page, 'title', 'error')).toHaveText('Minimum 4 characters required.');

    await safeClick(page.getByTestId('ui-lang-de'));
    await expect(fieldPart(page, 'title', 'error')).toHaveText('Mindestens 4 Zeichen.');
  });
});

test.describe('asyncValidators — the gate that holds while a check is pending', () => {
  /**
   * The point is not that a duplicate is rejected — a synchronous rule could do that. It is
   * that Save is unavailable *while the answer is outstanding*: Angular marks the control
   * `pending`, `submitBlocked` reads `form.pending`, and a record cannot be written in the
   * gap before the check comes back.
   *
   * The mock check takes a fixed 800 ms precisely so that window is observable. Every
   * assertion here retries — `expect(locator).toBeDisabled()`, never
   * `expect(await locator.isDisabled())`, which would sample once and race.
   */
  test('Save is held while the check runs, then released', async ({ page }) => {
    await newRecord(page);

    const title = fieldPart(page, 'title', 'input');
    await title.fill('Async Sample');
    await title.blur();
    await expect(page.getByTestId(SAVE)).toBeEnabled();

    await fieldPart(page, 'email', 'input').fill('fresh@example.com');
    await expect(page.getByTestId(SAVE)).toBeDisabled();
    await expect(page.getByTestId(SAVE)).toBeEnabled();
  });

  test('an address the check rejects keeps Save unavailable', async ({ page }) => {
    await newRecord(page);

    await fieldPart(page, 'title', 'input').fill('Async Sample');
    const email = fieldPart(page, 'email', 'input');
    await email.fill('taken@example.com');
    await email.blur();

    await expect(fieldPart(page, 'email', 'error')).toHaveText('That value is not allowed.');
    await expect(page.getByTestId(SAVE)).toBeDisabled();
  });
});

test.describe('hooks — a beforeSave that vetoes the save', () => {
  /**
   * The hook returns `false`, `DynamicFormComponent` aborts and emits `(saveRejected)`, and
   * the demo binds it. Without that binding an aborted save is indistinguishable from a
   * button that does nothing — which is the failure the abort support was added to fix,
   * reintroduced one layer up.
   */
  test('a vetoed save reports why and leaves the form open', async ({ page }) => {
    await newRecord(page);

    await fieldPart(page, 'title', 'input').fill('reject');
    await expect(page.getByTestId(SAVE)).toBeEnabled();
    await safeClick(page.getByTestId(SAVE));

    await expect(page.getByTestId('save-rejected')).toContainText('beforeSave returned false');
    // Still on the form, and nothing was written.
    await expect(fieldPart(page, 'title', 'input')).toBeVisible();

    await safeClick(page.getByRole('button', { name: /Back to List/i }));
    await expect(page.getByRole('button', { name: 'reject' })).toHaveCount(0);
  });

  /**
   * The record editor saves one tab at a time, and that is a *different* button from the
   * whole-record Save. It emitted `sectionSave` without ever consulting the hook, so the
   * same payload — `sectionSave` carries the whole record, not the tab's slice — reached
   * persistence through two routes, only one of which could be vetoed.
   */
  test('the record view section save is vetoed too, and says so', async ({ page }) => {
    await openRecord(page, 'Current Sample');
    await safeClick(page.getByTestId('toggle-record-view'));
    await safeClick(page.getByTestId('edit-section'));

    await fieldPart(page, 'title', 'input').fill('reject');
    await safeClick(page.getByTestId('save-section'));

    await expect(page.getByTestId('save-rejected')).toContainText('beforeSave returned false');
    // The section stays open, so the refused values are still in front of the user.
    await expect(page.getByTestId('save-section')).toBeVisible();
  });

  test('a section save the hook accepts is persisted', async ({ page }) => {
    await openRecord(page, 'Current Sample');
    await safeClick(page.getByTestId('toggle-record-view'));
    await safeClick(page.getByTestId('edit-section'));

    await fieldPart(page, 'title', 'input').fill('Section Edited');
    await safeClick(page.getByTestId('save-section'));

    await expect(page.getByTestId('save-rejected')).toHaveCount(0);
    // Back to the list, and the new title is what labels the row.
    await safeClick(page.getByRole('button', { name: /Back to List/i }));
    await expect(page.getByRole('button', { name: 'Section Edited' })).toBeVisible();
  });

  test('a title the hook accepts saves normally', async ({ page }) => {
    await newRecord(page);

    await fieldPart(page, 'title', 'input').fill('Accepted Entry');
    await safeClick(page.getByTestId(SAVE));

    await expect(page.getByTestId('save-rejected')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Accepted Entry' })).toBeVisible();
  });
});

test.describe('a field type the library does not ship', () => {
  /**
   * `provideFieldTypes({ rating: RatingFieldComponent })` on the renderer's side,
   * `registerFieldType` on the authoring side. Both are needed and they are deliberately
   * independent — core holds no component reference, which is what keeps it free of Angular.
   */
  test('renders, edits, and round-trips through a save', async ({ page }) => {
    await openRecord(page, 'Current Sample');

    const rating = fieldById(page, 'rating');
    await expect(rating).toHaveAttribute('data-field-type', 'rating');
    await expect(fieldPart(page, 'rating', 'input')).toHaveText('2');

    await safeClick(page.getByTestId('field-rating-star-5'));
    await expect(fieldPart(page, 'rating', 'input')).toHaveText('5');

    await safeClick(page.getByTestId(SAVE));
    await safeClick(page.getByRole('button', { name: 'Current Sample' }));
    await expect(fieldPart(page, 'rating', 'input')).toHaveText('5');
  });

  test('the builder knows the type as well as the renderer', async ({ page }) => {
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));

    // In the palette, because `registerFieldType` added it to core's catalog.
    await expect(builderPaletteButton(page, 'Rating')).toBeVisible();

    // And an authored config using it opens as a known field rather than an unknown one.
    await safeSelect(page.getByTestId('builder-entity-select'), 'extensions');
    await expect(page.getByTestId('row-id-rating')).toBeVisible();
    await expect(page.getByTestId('builder-preview').locator('[data-field-type="rating"]')).toBeVisible();
  });
});

test.describe('UPLOAD_HANDLER — a file persisted at selection time', () => {
  /**
   * With no handler the field stores the raw `File` for the host to upload on submit, and a
   * `File` does not survive `JSON.stringify` into localStorage — so the attachment is simply
   * gone after a save. With one, the field stores the URL the handler returned and the
   * attachment is still there when the record is reopened.
   */
  test('the stored value is a URL, and it survives the round trip', async ({ page }) => {
    await openRecord(page, 'Current Sample');

    await fieldById(page, 'attachment')
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('an uploaded attachment'),
      });
    await expect(fieldById(page, 'attachment')).toContainText('notes.txt');

    await safeClick(page.getByTestId(SAVE));
    await safeClick(page.getByRole('button', { name: 'Current Sample' }));

    // Read-only, so the field renders the link it holds rather than a file picker.
    await safeClick(page.getByTestId('mode-data'));
    const link = fieldById(page, 'attachment').locator('a');
    await expect(link).toContainText('notes.txt');
    await expect(link).toHaveAttribute('href', /^data:/);
  });
});
