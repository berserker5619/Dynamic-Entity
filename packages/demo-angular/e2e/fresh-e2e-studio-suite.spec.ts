import { test, expect } from '@playwright/test';
import {
  gotoDemo,
  recordButton,
  safeClick,
  safeSelect,
} from './test-helpers';

/**
 * Fresh Studio E2E Suite for Dynamic Entity Studio.
 *
 * Covers five primary end-to-end integration workflows:
 * 1. Multi-Entity Switching: Seamlessly switches between schema configurations (clients -> employees -> insuranceClaims)
 *    and verifies dynamic table rendering and record counts.
 * 2. Full Record CRUD Lifecycle: Adds a fresh client record, validates required attributes, verifies persistence,
 *    and confirms values are reloadable in the edit form.
 * 3. Synchronized Live JSON Inspector: Verifies real-time schema and record synchronization inside the slide-over drawer.
 * 4. Form Builder & Live Regex Validation Playground: Interactively creates new fields, applies regex presets,
 *    and validates live pattern status feedback (match, no-match, empty prompt).
 * 5. Theme Switching & View Persistence: Confirms light/dark mode changes propagate to DOM attributes and persist
 *    across navigation switches and localStorage.
 */
test.describe('Fresh Studio E2E Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDemo(page);
  });

  test('Workflow 1: Multi-entity configuration switching and record rendering', async ({ page }) => {
    const entitySelector = page.locator('#entitySelect');
    await expect(entitySelector).toBeVisible();

    // 1. Switch to clients entity
    await safeSelect(entitySelector, 'clients');
    await expect(entitySelector).toHaveValue('clients');
    await expect(recordButton(page, 'Acme Corp')).toBeVisible();
    await expect(recordButton(page, 'Globex')).toBeVisible();

    // 2. Switch to employees entity
    await safeSelect(entitySelector, 'employees');
    await expect(entitySelector).toHaveValue('employees');
    await expect(page.locator('.list-toolbar__count')).toContainText('records');
    await expect(page.locator('.record-card').first()).toBeVisible();

    // 3. Switch to insuranceClaims entity
    await safeSelect(entitySelector, 'insuranceClaims');
    await expect(entitySelector).toHaveValue('insuranceClaims');
    await expect(page.locator('.record-card').first()).toBeVisible();

    // 4. Switch back to clients and confirm clean restoration
    await safeSelect(entitySelector, 'clients');
    await expect(recordButton(page, 'Acme Corp')).toBeVisible();
  });

  test('Workflow 2: Full Record Creation, Persistence, and Reload in Dynamic Form', async ({ page }) => {
    // Select clients entity
    await safeSelect(page.locator('#entitySelect'), 'clients');

    // Navigate to Add Client form
    const addBtn = page.getByRole('button', { name: '+ Add Client' });
    await safeClick(addBtn);

    await expect(page.getByRole('heading', { level: 2, name: 'New Client' })).toBeVisible();
    await expect(page.locator('ngx-dynamic-form')).toBeVisible();

    // Populate required & optional fields
    const nameInput = page.locator('[data-field-type]').filter({ hasText: 'Name' }).locator('input').first();
    const emailInput = page.locator('[data-field-type]').filter({ hasText: 'Email' }).locator('input').first();
    const companyInput = page.locator('[data-field-type]').filter({ hasText: 'Company' }).locator('input').first();
    const statusSelect = page.locator('[data-field-type]').filter({ hasText: 'Status' }).locator('select').first();
    const salaryInput = page.locator('[data-field-type]').filter({ hasText: 'Salary' }).locator('input').first();
    const notesInput = page.locator('[data-field-type]').filter({ hasText: 'Notes' }).locator('textarea').first();

    const testClientName = 'Fresh Horizon Corp';
    const testClientEmail = 'info@freshhorizon.dev';
    const testSalary = '245000';

    await nameInput.fill(testClientName);
    await emailInput.fill(testClientEmail);
    await companyInput.fill('Horizon Tech');
    await safeSelect(statusSelect, 'Active');
    await salaryInput.fill(testSalary);
    await notesInput.fill('Verified via fresh end-to-end studio test.');

    // Save record
    await safeClick(page.getByTestId('form-submit'));

    // Assert record appears in list view
    await expect(page.locator('.list-toolbar')).toBeVisible();
    const newRecordBtn = recordButton(page, testClientName);
    await expect(newRecordBtn).toBeVisible();

    // Re-open record to verify persistence and round-trip data binding
    await safeClick(newRecordBtn);
    await expect(page.getByRole('heading', { level: 2, name: 'Edit Client' })).toBeVisible();
    await expect(nameInput).toHaveValue(testClientName);
    await expect(emailInput).toHaveValue(testClientEmail);
    await expect(salaryInput).toHaveValue(testSalary);

    // Return to list
    await safeClick(page.getByRole('button', { name: /Back to List/i }));
    await expect(page.locator('.list-toolbar')).toBeVisible();
  });

  test('Workflow 3: Live JSON Inspector Schema & Active Record Synchronization', async ({ page }) => {
    // Select clients entity
    await safeSelect(page.locator('#entitySelect'), 'clients');

    // Open an existing client record
    await safeClick(recordButton(page, 'Acme Corp'));
    await expect(page.getByRole('heading', { level: 2, name: 'Edit Client' })).toBeVisible();

    // Open live JSON inspector drawer
    const inspectorBtn = page.getByTestId('json-inspector-btn');
    await safeClick(inspectorBtn);

    const drawer = page.getByTestId('json-inspector-drawer');
    await expect(drawer).toBeVisible();

    // Tab 1: Entity Schema
    const schemaTab = page.getByTestId('json-tab-schema');
    await safeClick(schemaTab);
    const content = page.getByTestId('json-inspector-content');
    await expect(content).toBeVisible();
    await expect(content).toContainText('"entity": "clients"');

    // Tab 2: Record Data
    const recordTab = page.getByTestId('json-tab-record');
    await safeClick(recordTab);
    await expect(content).toContainText('"name": "Acme Corp"');
    await expect(content).toContainText('"company": "Acme"');

    // Close JSON inspector drawer
    const closeBtn = page.getByTestId('json-close-btn');
    await safeClick(closeBtn);
    await expect(drawer).not.toBeVisible();
  });

  test('Workflow 4: Form Builder Field Insertion and Interactive Regex Playground', async ({ page }) => {
    test.setTimeout(60000);

    // Switch view to Form Builder
    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await expect(page.locator('ngx-entity-builder')).toBeVisible();

    // Add a Text Field from Palette
    const textPaletteBtn = page.locator('[data-testid^="palette-"]').filter({ hasText: 'Text' }).first();
    await expect(textPaletteBtn).toBeVisible();
    await textPaletteBtn.click();

    // Configure Label
    const labelInput = page.locator('[data-testid="field-label"]');
    await expect(labelInput).toBeVisible();
    await labelInput.fill('Security Badge ID');

    // Open/verify pattern playground in inspector
    const playground = page.locator('[data-testid="pattern-playground"]');
    await expect(playground).toBeVisible();

    // Apply Alphanumeric preset
    const alphaPreset = page.locator('[data-testid="preset-alphanumeric"]');
    await expect(alphaPreset).toBeVisible();
    await alphaPreset.click();

    const patternInput = page.locator('[data-testid="field-pattern-input"]');
    await expect(patternInput).toHaveValue('^[a-zA-Z0-9]+$');

    const testInput = page.locator('[data-testid="regex-test-input"]');
    const testStatus = page.locator('[data-testid="regex-test-status"]');

    // Test matching sample
    await testInput.fill('BADGE99');
    await expect(testStatus).toContainText('Pattern matches');

    // Test non-matching sample with forbidden special characters
    await testInput.fill('BADGE-99 #!');
    await expect(testStatus).toContainText('Pattern does not match');

    // Test empty sample restores prompt/placeholder
    await testInput.fill('');
    await expect(testStatus).toContainText('Type sample input to test');
  });

  test('Workflow 5: Theme Switching and Navigation State Persistence', async ({ page }) => {
    const html = page.locator('html');

    // Switch to Dark theme
    const darkBtn = page.getByTestId('theme-dark');
    await safeClick(darkBtn);
    await expect(html).toHaveAttribute('data-theme', 'dark');

    let savedTheme = await page.evaluate(() => localStorage.getItem('demo-theme'));
    expect(savedTheme).toBe('dark');

    // Switch across views to verify theme persistence
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));
    await expect(page.locator('.config-manager')).toBeVisible();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await safeClick(page.getByRole('button', { name: 'Form Builder' }));
    await expect(page.locator('ngx-entity-builder')).toBeVisible();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Switch back to Light theme
    const lightBtn = page.getByTestId('theme-light');
    await safeClick(lightBtn);
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Verify localStorage persistence
    savedTheme = await page.evaluate(() => localStorage.getItem('demo-theme'));
    expect(savedTheme).toBe('light');
  });
});
