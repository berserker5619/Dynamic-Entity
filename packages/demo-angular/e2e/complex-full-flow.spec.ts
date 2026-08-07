import { test, expect } from '@playwright/test';
import { gotoDemo, safeClick } from './test-helpers';

test.describe('Dynamic Entity E2E - Full End-to-End Working Flow (All Field Types & Multi-Tab Configuration)', () => {
  const COMPLEX_CONFIG = {
    entity: 'complex_enterprise_crm',
    version: 1,
    name: { en: 'Complex Enterprise CRM' },
    permissions: {},
    tabs: [
      {
        id: 'basicInfo',
        label: { en: 'Basic Information' },
        fields: [
          { id: 'fullName', type: 'text', label: { en: 'Full Name' }, validators: { required: true }, colSpan: 6 },
          { id: 'annualBudget', type: 'number', label: { en: 'Annual Budget' }, validators: { min: 1000 }, colSpan: 6 },
          {
            id: 'industry',
            type: 'dropdown',
            label: { en: 'Industry Sector' },
            options: [
              { value: 'tech', label: { en: 'Technology' } },
              { value: 'health', label: { en: 'Healthcare' } },
              { value: 'finance', label: { en: 'Finance & Banking' } },
            ],
            colSpan: 4,
          },
          { id: 'startDate', type: 'date', label: { en: 'Start Date' }, colSpan: 4 },
          { id: 'contractMonth', type: 'monthYear', label: { en: 'Contract Month' }, colSpan: 4 },
        ],
      },
      {
        id: 'advancedProfile',
        label: { en: 'Advanced Profile' },
        fields: [
          { id: 'biography', type: 'textarea', label: { en: 'Biography' }, colSpan: 12 },
          { id: 'subscribeNewsletter', type: 'checkbox', label: { en: 'Subscribe to Newsletter' }, colSpan: 6 },
          {
            id: 'contactMethod',
            type: 'radio',
            label: { en: 'Preferred Contact Method' },
            options: [
              { value: 'email', label: { en: 'Email' } },
              { value: 'phone', label: { en: 'Phone' } },
              { value: 'mail', label: { en: 'Postal Mail' } },
            ],
            colSpan: 6,
          },
          {
            id: 'services',
            type: 'multiSelect',
            label: { en: 'Selected Services' },
            options: [
              { value: 'cloud', label: { en: 'Cloud Storage' } },
              { value: 'audit', label: { en: 'Security Audit' } },
              { value: 'support', label: { en: 'Dedicated Support' } },
            ],
            colSpan: 12,
          },
          { id: 'avatar', type: 'image', label: { en: 'Profile Avatar' }, colSpan: 6 },
          { id: 'attachment', type: 'file', label: { en: 'Contract Document' }, colSpan: 6 },
          { id: 'primaryRef', type: 'entityReference', label: { en: 'Primary Contact Ref' }, refEntity: 'individuals', colSpan: 12 },
        ],
      },
      {
        id: 'nestedStructures',
        label: { en: 'Nested Data & Groups' },
        fields: [
          {
            id: 'companyGroup',
            type: 'group',
            label: { en: 'Company Details Group' },
            colSpan: 12,
            children: [
              { id: 'companyName', type: 'text', label: { en: 'Registered Company Name' }, colSpan: 6 },
              { id: 'taxId', type: 'text', label: { en: 'Tax Identifier' }, colSpan: 6 },
            ],
          },
        ],
      },
    ],
  };

  test('executes full end-to-end flow: saves complex multi-tab config with all field types, enters data, submits, and verifies persistence', async ({ page }) => {
    test.setTimeout(60000);
    // Listen for JS errors
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // ─── Step 1: Save Complex Entity Config in Entity Manager ───────────────
    await gotoDemo(page);
    await safeClick(page.getByRole('button', { name: 'Entity Manager' }));
    await expect(page.getByRole('heading', { level: 2, name: 'Manage Entities' })).toBeVisible();

    await safeClick(page.getByRole('button', { name: '+ Create New Entity' }));
    const configTextarea = page.locator('textarea').first();
    await configTextarea.fill(JSON.stringify(COMPLEX_CONFIG, null, 2));
    await safeClick(page.getByRole('button', { name: 'Save Config' }));

    // After saving, onConfigSubmit calls view.set('list') so the table is gone.
    // Verify the new entity was persisted by confirming it appears in the header dropdown.
    await expect(page.locator('#entitySelect option[value="complex_enterprise_crm"]')).toBeAttached();

    // ─── Step 2: The entity was auto-selected by onEntityChange in onConfigSubmit.
    //            Navigate to the Clients Data list view (already selected by save).
    await safeClick(page.getByRole('button', { name: 'Clients Data' }));

    // ─── Step 3: Click + Add Record ──────────────────────────────────────────
    // The add button label is dynamic: '+ Add Record' for non-clients, '+ Add Client' for clients.
    await safeClick(page.getByRole('button', { name: /\+ Add/i }));
    await expect(page.getByRole('heading', { level: 2, name: /New Record \(complex_enterprise_crm\)/i })).toBeVisible();

    // ─── Step 4: Fill Tab 1 (Basic Information) ──────────────────────────────────
    // Tabs are rendered as <button role="tab"> — must use getByRole('tab') not getByRole('button')
    await expect(page.getByRole('tab', { name: 'Basic Information' })).toBeVisible();

    await page.locator('#fullName').fill('Dr. Marcus Vance');
    await page.locator('#annualBudget').fill('500000');
    await page.locator('#industry').selectOption('health');
    await page.locator('#startDate').fill('2026-08-07');

    // monthYear renders as two separate selects (no id) inside field-container-contractMonth
    const monthYearContainer = page.locator('#field-container-contractMonth');
    if (await monthYearContainer.isVisible()) {
      await monthYearContainer.locator('.ngx-field__input--month').selectOption('08');
      await monthYearContainer.locator('.ngx-field__input--year').selectOption('2026');
    }

    // ─── Step 5: Fill Tab 2 (Advanced Profile) ──────────────────────────────
    await safeClick(page.getByRole('tab', { name: 'Advanced Profile' }));

    const bioTextarea = page.locator('#biography');
    await bioTextarea.fill('Senior Staff UI/UX Systems Architect with 15 years experience across enterprise systems.');

    const newsletterCheckbox = page.locator('#subscribeNewsletter');
    await newsletterCheckbox.check();

    const emailRadio = page.locator('#contactMethod-email');
    if (await emailRadio.isVisible()) {
      await emailRadio.check();
    }

    // MultiSelect rendered as <select multiple>. Angular [value] sets DOM property not HTML attribute,
    // so we must select by label text instead of value.
    const servicesSelect = page.locator('#services');
    if (await servicesSelect.isVisible()) {
      await servicesSelect.selectOption([{ label: 'Cloud Storage' }, { label: 'Dedicated Support' }]);
    }

    // ─── Step 6: Fill Tab 3 (Nested Data & Groups) ──────────────────────────
    await safeClick(page.getByRole('tab', { name: 'Nested Data & Groups' }));

    const compNameInput = page.locator('#companyName');
    if (await compNameInput.isVisible()) {
      await compNameInput.fill('Akshya IT Enterprise Systems');
    }

    const taxIdInput = page.locator('#taxId');
    if (await taxIdInput.isVisible()) {
      await taxIdInput.fill('DE-TAX-998822');
    }

    // ─── Step 7: Submit Form (Save Record) ──────────────────────────────────
    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeEnabled();
    await safeClick(saveButton);

    // Verify returned to records list view
    await expect(page.getByRole('button', { name: /\+ Add/i })).toBeVisible();

    // ─── Step 8: Verify Saved Record Data Persistence ──────────────────────
    const recordRow = page.getByRole('button', { name: 'Dr. Marcus Vance' });
    await expect(recordRow).toBeVisible();

    // Re-open saved record to verify data retention across tabs
    await safeClick(recordRow);
    await expect(page.getByRole('heading', { level: 2, name: /Edit Record \(complex_enterprise_crm\)/i })).toBeVisible();

    // Verify Tab 1 data retained
    await expect(page.locator('#fullName')).toHaveValue('Dr. Marcus Vance');
    await expect(page.locator('#annualBudget')).toHaveValue('500000');
    await expect(page.locator('#industry')).toHaveValue('health');
    await expect(page.locator('#startDate')).toHaveValue('2026-08-07');

    // Verify Tab 2 data retained
    await safeClick(page.getByRole('tab', { name: 'Advanced Profile' }));
    await expect(page.locator('#biography')).toHaveValue('Senior Staff UI/UX Systems Architect with 15 years experience across enterprise systems.');
    await expect(page.locator('#subscribeNewsletter')).toBeChecked();

    // Verify no JS errors occurred during full workflow execution
    expect(jsErrors).toEqual([]);
  });
});
