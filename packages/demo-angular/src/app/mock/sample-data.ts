import type { EntityFormConfig, LocalizedText } from 'ngx-dynamic-entity';
import testDataRaw from '../../../../../test_data.json';
import clientTierRaw from './client-tier-list.json';
import clientsConfig from './configs/clients.json';
import employeesConfig from './configs/employees.json';
import ordersConfig from './configs/orders.json';

export const TEST_DATA_CONFIGS: EntityFormConfig[] = testDataRaw as EntityFormConfig[];

/**
 * The demo's own entity configs, as JSON.
 *
 * They live in `configs/` rather than as TypeScript literals for one reason: the demo's
 * import server reads the same files, so the browser and the server cannot be handed
 * different schemas for the same entity. That divergence used to be real — the server simply
 * refused these four entities rather than risk mapping a sheet against a config the user
 * never saw — and one source removes the risk instead of routing around it.
 *
 * Cast rather than validated: `resolveJsonModule` types them structurally, and these are
 * authored fixtures rather than user input. `validateConfig` is what checks a config that
 * arrived from somewhere untrusted.
 *
 * Two things in `clients.json` are worth knowing about, and neither survives in JSON:
 *
 * - `email` carries a `hint`, not a `placeholder`. A placeholder disappears the moment
 *   somebody types, so anything they need *while* filling the field in cannot live there. A
 *   hint stays on screen, and `aria-describedby` reads it out with the field.
 * - `tier` sets `listName: 'clientTier'` and carries no options of its own. They resolve
 *   through `LOOKUP_REGISTRY` at runtime, so nothing about the tier values lives in the
 *   config at all.
 */
export const CLIENTS_CONFIG = clientsConfig as EntityFormConfig;

/**
 * A named master list, as a consuming app would hold it: values out of authoring order with an
 * explicit `sortOrder`, several languages, and metadata (`code`, `isSystemDefined`) that the
 * option shape drops but `LookupRegistryService.valuesFor` still exposes.
 */
/**
 * Read from JSON so the demo app and import-server.mjs share one source.
 *
 * The import server resolves this list to the same options the browser does — insuranceClaims
 * has a clientTier field, and createImportRouter refuses to start without it. A second copy of
 * the array would be a second thing to keep right, and the symptom of getting it wrong is a
 * record that renders correctly and matches nothing.
 */
export const CLIENT_TIER_LIST = clientTierRaw;

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

/**
 * `employees` — the config carrying a `group` (Contact) and an `array` (Addresses), which is
 * what makes it the one that exercises nesting and repeating rows in an import. The array
 * becomes numbered columns: Street 1, Street 2, Street 3.
 */
export const EMPLOYEES_CONFIG = employeesConfig as EntityFormConfig;

export const EMPLOYEES_RECORDS: Record<string, unknown>[] = [
  {
    _id: 'emp_001',
    personal: {
      firstName: 'John',
      lastName: 'Doe',
      status: { en: 'Active' },
      contact: { email: 'john@x.com', phone: '111-222' },
    },
    department: { en: 'Engineering' },
    salary: 82000,
    joined: '2020-01-15',
    addressesTab: {
      addresses: [
        { street: '1 Main St', city: 'Berlin', zip: '10115' },
        { street: '2 Oak Ave', city: 'Munich', zip: '80331' },
      ],
    },
  },
  {
    _id: 'emp_002',
    personal: {
      firstName: 'Jane',
      lastName: 'Smith',
      status: { en: 'Inactive' },
      contact: { email: 'jane@x.com', phone: '333-444' },
    },
    department: { en: 'Sales' },
    salary: 91000,
    joined: '2019-06-01',
    addressesTab: { addresses: [{ street: '9 Elm Rd', city: 'Hamburg', zip: '20095' }] },
  },
  {
    _id: 'emp_003',
    personal: {
      firstName: 'Ravi',
      lastName: 'Kumar',
      status: { en: 'On Leave' },
      contact: { email: 'ravi@x.com', phone: '555-666' },
    },
    department: { en: 'Engineering' },
    salary: 78000,
    joined: '2021-03-22',
    addressesTab: { addresses: [] },
  },
  {
    _id: 'emp_004',
    personal: {
      firstName: 'Mei',
      lastName: 'Chen',
      status: { en: 'Active' },
      contact: { email: 'mei@x.com', phone: '777-888' },
    },
    department: { en: 'HR' },
    salary: 69000,
    joined: '2022-11-08',
    addressesTab: { addresses: [{ street: '5 Pine St', city: 'Cologne', zip: '50667' }] },
  },
  {
    _id: 'emp_005',
    personal: {
      firstName: 'Omar',
      lastName: 'Farid',
      status: { en: 'Active' },
      contact: { email: 'omar@x.com', phone: '999-000' },
    },
    department: { en: 'Sales' },
    salary: 88000,
    joined: '2018-09-30',
    addressesTab: { addresses: [{ street: '7 Birch Ln', city: 'Berlin', zip: '10437' }] },
  },
  {
    _id: 'emp_006',
    personal: {
      firstName: 'Sara',
      lastName: 'Lopez',
      status: { en: 'Inactive' },
      contact: { email: 'sara@x.com', phone: '121-212' },
    },
    department: { en: 'Engineering' },
    salary: 95000,
    joined: '2017-02-14',
    addressesTab: { addresses: [{ street: '3 Cedar Ct', city: 'Munich', zip: '80333' }] },
  },
];

/**
 * `orders` — the demo entity that exercises the runtime features the other configs don't:
 * an entity-ref cascade (country → city), `autoPatch` from a selected company record,
 * `patchOnTrue`, and a `criticalField` lock. Loaders are registered in `app.config.ts`.
 */
/**
 * `orders` — three `entity-ref` fields, an `autoPatch` that copies fields off the referenced
 * record, a `patchOnTrue`, and a `criticalField`. Nothing else in the demo reaches those, and
 * their loaders are registered in `app.config.ts`.
 */
export const ORDERS_CONFIG = ordersConfig as EntityFormConfig;

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
