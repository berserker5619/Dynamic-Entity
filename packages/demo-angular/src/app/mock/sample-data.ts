import type { EntityFormConfig, LocalizedText } from 'ngx-dynamic-entity';
import testDataRaw from '../../../../../test_data.json';

export const TEST_DATA_CONFIGS: EntityFormConfig[] = testDataRaw as EntityFormConfig[];

/**
 * Sample `clients` entity config (rich EntityFormConfig model) used to seed localStorage
 * so the demo works fully offline.
 */
export const CLIENTS_CONFIG: EntityFormConfig = {
  entity: 'clients',
  version: 1,
  maskData: false,
  // Everyone may view; the viewer role may not edit. This is what makes the role switcher
  // mean something — `DynamicFormComponent.canSubmit` reads it through `RbacService`.
  permissions: { edit: ['admin', 'manager', 'IT_SUPPORT'] },
  tabs: [
    {
      id: 'general',
      flatData: true,
      label: { en: 'General' },
      fields: [
        { id: 'name', type: 'text', label: { en: 'Name' }, validators: { required: true }, visibility: true },
        { id: 'email', type: 'email', label: { en: 'Email' }, validators: { pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$' }, visibility: true },
        { id: 'company', type: 'text', label: { en: 'Company' }, visibility: true },
        {
          id: 'status',
          type: 'dropdown',
          label: { en: 'Status' },
          options: [
            { en: 'Active' },
            { en: 'Inactive' },
          ],
          visibility: true,
        },
        {
          // Options come from a named master list, resolved through LOOKUP_REGISTRY at runtime.
          // Nothing about the tier values lives in this config.
          id: 'tier',
          type: 'dropdown',
          label: { en: 'Tier' },
          listName: 'clientTier',
          visibility: true,
        },
        { id: 'salary', type: 'number', label: { en: 'Salary' }, visibility: true, maskData: true },
        { id: 'notes', type: 'textarea', label: { en: 'Notes' }, visibility: true },
      ],
    },
    {
      id: 'documentsTab',
      label: { en: 'Documents' },
      moduleName: 'documents-view',
    },
  ],
};

/**
 * A named master list, as a consuming app would hold it: values out of authoring order with an
 * explicit `sortOrder`, several languages, and metadata (`code`, `isSystemDefined`) that the
 * option shape drops but `LookupRegistryService.valuesFor` still exposes.
 */
export const CLIENT_TIER_LIST = [
  { _id: 'tier_silver', code: 'SLV', name: { en: 'Silver', de: 'Silber' }, sortOrder: 2 },
  { _id: 'tier_gold', code: 'GLD', name: { en: 'Gold', de: 'Gold' }, sortOrder: 1, isSystemDefined: true },
  { _id: 'tier_bronze', code: 'BRZ', name: { en: 'Bronze', de: 'Bronze' }, sortOrder: 3 },
];

let seq = 1;
// `status` holds the option object itself — for dropdowns the displayed text IS the value.
const rec = (
  name: string,
  email: string,
  company: string,
  status: LocalizedText,
  salary: number,
  notes = '',
  tier?: unknown,
) => ({
  _id: `client_${String(seq++).padStart(3, '0')}`,
  _configVersion: 1,
  name,
  email,
  company,
  status,
  tier,
  salary,
  notes,
});

export const CLIENTS_RECORDS: Record<string, unknown>[] = [
  rec('Acme Corp', 'ops@acme.com', 'Acme', { en: 'Active' }, 120000, 'Key account', {
    en: 'Gold',
    de: 'Gold',
  }),
  // Saved by a German-speaking user against an older single-language list. The registry's
  // label layer still resolves it to "Silver" in English (parity plan §6.2).
  rec('Globex', 'hello@globex.com', 'Globex', { en: 'Active' }, 98000, '', 'Silber'),
  rec('Initech', 'tps@initech.com', 'Initech', { en: 'Inactive' }, 76000, 'Churned Q2'),
  rec('Umbrella', 'contact@umbrella.com', 'Umbrella', { en: 'Active' }, 143000),
  rec('Soylent', 'green@soylent.com', 'Soylent', { en: 'Inactive' }, 54000),
  rec('Stark Industries', 'tony@stark.com', 'Stark', { en: 'Active' }, 210000, 'Enterprise'),
  rec('Wayne Enterprises', 'bruce@wayne.com', 'Wayne', { en: 'Active' }, 195000),
  rec('Wonka', 'golden@wonka.com', 'Wonka', { en: 'Inactive' }, 61000),
  rec('Cyberdyne', 'sky@cyberdyne.com', 'Cyberdyne', { en: 'Active' }, 132000, 'AI division'),
  rec('Hooli', 'nucleus@hooli.com', 'Hooli', { en: 'Active' }, 88000),
  rec('Pied Piper', 'richard@piedpiper.com', 'Pied Piper', { en: 'Active' }, 72000),
  rec('Vehement', 'info@vehement.com', 'Vehement', { en: 'Inactive' }, 47000),
];

export const MASKED_ROLES = ['IT_SUPPORT'];

export const EMPLOYEES_CONFIG: EntityFormConfig = {
  entity: 'employees',
  name: { en: 'Employees' },
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal' },
      fields: [
        { id: 'firstName', type: 'text', label: { en: 'First Name' }, table: { visible: true, isName: true } },
        { id: 'lastName', type: 'text', label: { en: 'Last Name' }, table: { visible: true } },
        {
          id: 'status',
          type: 'dropdown',
          label: { en: 'Status' },
          options: [
            { en: 'Active' },
            { en: 'Inactive' },
            { en: 'On Leave' },
          ],
          table: { visible: true },
        },
        {
          id: 'contact',
          type: 'group',
          label: { en: 'Contact' },
          children: [
            { id: 'email', type: 'email', label: { en: 'Email' }, table: { visible: true } },
            { id: 'phone', type: 'text', label: { en: 'Phone' }, table: { visible: true } },
          ],
        },
      ],
    },
    {
      id: 'employment',
      label: { en: 'Employment' },
      flatData: true,
      fields: [
        {
          id: 'department',
          type: 'dropdown',
          label: { en: 'Department' },
          options: [
            { en: 'Engineering' },
            { en: 'Sales' },
            { en: 'HR' },
          ],
          table: { visible: true },
        },
        { id: 'salary', type: 'number', label: { en: 'Salary' }, table: { visible: true } },
        { id: 'joined', type: 'date', label: { en: 'Joined' }, table: { visible: true } },
      ],
    },
    {
      id: 'addressesTab',
      label: { en: 'Addresses' },
      fields: [
        {
          id: 'addresses',
          type: 'array',
          label: { en: 'Addresses' },
          table: { visible: true },
          children: [
            { id: 'street', type: 'text', label: { en: 'Street' }, table: { visible: true } },
            { id: 'city', type: 'text', label: { en: 'City' }, table: { visible: true } },
            { id: 'zip', type: 'text', label: { en: 'ZIP' }, table: { visible: true } },
          ],
        },
      ],
    },
  ],
};

export const EMPLOYEES_RECORDS: Record<string, unknown>[] = [
  { _id: 'emp_001', personal: { firstName: 'John', lastName: 'Doe', status: { en: 'Active' }, contact: { email: 'john@x.com', phone: '111-222' } }, department: { en: 'Engineering' }, salary: 82000, joined: '2020-01-15', addressesTab: { addresses: [{ street: '1 Main St', city: 'Berlin', zip: '10115' }, { street: '2 Oak Ave', city: 'Munich', zip: '80331' }] } },
  { _id: 'emp_002', personal: { firstName: 'Jane', lastName: 'Smith', status: { en: 'Inactive' }, contact: { email: 'jane@x.com', phone: '333-444' } }, department: { en: 'Sales' }, salary: 91000, joined: '2019-06-01', addressesTab: { addresses: [{ street: '9 Elm Rd', city: 'Hamburg', zip: '20095' }] } },
  { _id: 'emp_003', personal: { firstName: 'Ravi', lastName: 'Kumar', status: { en: 'On Leave' }, contact: { email: 'ravi@x.com', phone: '555-666' } }, department: { en: 'Engineering' }, salary: 78000, joined: '2021-03-22', addressesTab: { addresses: [] } },
  { _id: 'emp_004', personal: { firstName: 'Mei', lastName: 'Chen', status: { en: 'Active' }, contact: { email: 'mei@x.com', phone: '777-888' } }, department: { en: 'HR' }, salary: 69000, joined: '2022-11-08', addressesTab: { addresses: [{ street: '5 Pine St', city: 'Cologne', zip: '50667' }] } },
  { _id: 'emp_005', personal: { firstName: 'Omar', lastName: 'Farid', status: { en: 'Active' }, contact: { email: 'omar@x.com', phone: '999-000' } }, department: { en: 'Sales' }, salary: 88000, joined: '2018-09-30', addressesTab: { addresses: [{ street: '7 Birch Ln', city: 'Berlin', zip: '10437' }] } },
  { _id: 'emp_006', personal: { firstName: 'Sara', lastName: 'Lopez', status: { en: 'Inactive' }, contact: { email: 'sara@x.com', phone: '121-212' } }, department: { en: 'Engineering' }, salary: 95000, joined: '2017-02-14', addressesTab: { addresses: [{ street: '3 Cedar Ct', city: 'Munich', zip: '80333' }] } },
];

/**
 * `orders` — the demo entity that exercises the runtime features the other configs don't:
 * an entity-ref cascade (country → city), `autoPatch` from a selected company record,
 * `patchOnTrue`, and a `criticalField` lock. Loaders are registered in `app.config.ts`.
 */
export const ORDERS_CONFIG: EntityFormConfig = {
  entity: 'orders',
  version: 1,
  name: { en: 'Orders' },
  tabs: [
    {
      id: 'order',
      label: { en: 'Order' },
      fields: [
        { id: 'reference', type: 'text', label: { en: 'Reference' }, validators: { required: true }, colSpan: 6 },
        {
          id: 'company',
          type: 'entity-ref',
          label: { en: 'Company' },
          colSpan: 6,
          entityReference: { enabled: true, linkedEntityKey: 'companies', displayFields: ['name'] },
          autoPatch: {
            targetTab: 'order',
            mappings: [
              { source: 'vat', target: 'taxId' },
              { source: 'city', target: 'billingCity' },
            ],
          },
        },
        { id: 'taxId', type: 'text', label: { en: 'Tax ID' }, colSpan: 6 },
        { id: 'billingCity', type: 'text', label: { en: 'Billing city' }, colSpan: 6 },
        {
          id: 'sameAsBilling',
          type: 'boolean',
          label: { en: 'Ship to billing city' },
          colSpan: 12,
          patchOnTrue: [{ from: 'billingCity', to: 'shippingCity' }],
        },
        { id: 'shippingCity', type: 'text', label: { en: 'Shipping city' }, colSpan: 6 },
        {
          id: 'iban',
          type: 'text',
          label: { en: 'IBAN' },
          colSpan: 6,
          criticalField: true,
        },
      ],
    },
    {
      id: 'delivery',
      label: { en: 'Delivery' },
      fields: [
        {
          id: 'country',
          type: 'entity-ref',
          label: { en: 'Country' },
          colSpan: 6,
          entityReference: { enabled: true, linkedEntityKey: 'countries' },
        },
        {
          id: 'city',
          type: 'entity-ref',
          label: { en: 'City' },
          colSpan: 6,
          entityReference: {
            enabled: true,
            linkedEntityKey: 'cities',
            parentField: 'country',
            lookupFilter: 'country',
          },
        },
      ],
    },
  ],
};

/** Loader data for the `orders` entity-ref fields. */
export const ORDER_REFERENCE_DATA = {
  companies: [
    { value: 'acme', label: 'Acme', record: { name: 'Acme', vat: 'DE111111', city: 'Berlin' } },
    { value: 'globex', label: 'Globex', record: { name: 'Globex', vat: 'FR222222', city: 'Paris' } },
  ],
  countries: [
    { value: 'de', label: 'Germany' },
    { value: 'fr', label: 'France' },
  ],
  cities: [
    { value: 'ber', label: 'Berlin', record: { country: 'de' } },
    { value: 'muc', label: 'Munich', record: { country: 'de' } },
    { value: 'par', label: 'Paris', record: { country: 'fr' } },
    { value: 'lyo', label: 'Lyon', record: { country: 'fr' } },
  ],
};

export const ORDERS_RECORDS: Record<string, unknown>[] = [
  { _id: 'order_001', reference: 'ORD-1001', iban: 'DE89370400440532013000', billingCity: 'Berlin' },
];
