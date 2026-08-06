import type { EntityFormConfig } from 'ngx-dynamic-entity';

/**
 * Sample `clients` entity config (rich EntityFormConfig model) used to seed localStorage
 * so the demo works fully offline.
 */
export const CLIENTS_CONFIG: EntityFormConfig = {
  entity: 'clients',
  version: 1,
  maskData: false,
  permissions: {},
  tabs: [
    {
      id: 'general',
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
            { value: 'active', label: { en: 'Active' } },
            { value: 'inactive', label: { en: 'Inactive' } },
          ],
          visibility: true,
        },
        { id: 'salary', type: 'number', label: { en: 'Salary' }, visibility: true, maskData: true },
        { id: 'notes', type: 'textarea', label: { en: 'Notes' }, visibility: true },
      ],
    },
  ],
};

let seq = 1;
const rec = (name: string, email: string, company: string, status: string, salary: number, notes = '') => ({
  _id: `client_${String(seq++).padStart(3, '0')}`,
  _configVersion: 1,
  name,
  email,
  company,
  status,
  salary,
  notes,
});

export const CLIENTS_RECORDS: Record<string, unknown>[] = [
  rec('Acme Corp', 'ops@acme.com', 'Acme', 'active', 120000, 'Key account'),
  rec('Globex', 'hello@globex.com', 'Globex', 'active', 98000),
  rec('Initech', 'tps@initech.com', 'Initech', 'inactive', 76000, 'Churned Q2'),
  rec('Umbrella', 'contact@umbrella.com', 'Umbrella', 'active', 143000),
  rec('Soylent', 'green@soylent.com', 'Soylent', 'inactive', 54000),
  rec('Stark Industries', 'tony@stark.com', 'Stark', 'active', 210000, 'Enterprise'),
  rec('Wayne Enterprises', 'bruce@wayne.com', 'Wayne', 'active', 195000),
  rec('Wonka', 'golden@wonka.com', 'Wonka', 'inactive', 61000),
  rec('Cyberdyne', 'sky@cyberdyne.com', 'Cyberdyne', 'active', 132000, 'AI division'),
  rec('Hooli', 'nucleus@hooli.com', 'Hooli', 'active', 88000),
  rec('Pied Piper', 'richard@piedpiper.com', 'Pied Piper', 'active', 72000),
  rec('Vehement', 'info@vehement.com', 'Vehement', 'inactive', 47000),
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
            { value: 'active', label: { en: 'Active' } },
            { value: 'inactive', label: { en: 'Inactive' } },
            { value: 'on-leave', label: { en: 'On Leave' } },
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
            { value: 'eng', label: { en: 'Engineering' } },
            { value: 'sales', label: { en: 'Sales' } },
            { value: 'hr', label: { en: 'HR' } },
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
  { _id: 'emp_001', personal: { firstName: 'John', lastName: 'Doe', status: 'active', contact: { email: 'john@x.com', phone: '111-222' } }, department: 'eng', salary: 82000, joined: '2020-01-15', addressesTab: { addresses: [{ street: '1 Main St', city: 'Berlin', zip: '10115' }, { street: '2 Oak Ave', city: 'Munich', zip: '80331' }] } },
  { _id: 'emp_002', personal: { firstName: 'Jane', lastName: 'Smith', status: 'inactive', contact: { email: 'jane@x.com', phone: '333-444' } }, department: 'sales', salary: 91000, joined: '2019-06-01', addressesTab: { addresses: [{ street: '9 Elm Rd', city: 'Hamburg', zip: '20095' }] } },
  { _id: 'emp_003', personal: { firstName: 'Ravi', lastName: 'Kumar', status: 'on-leave', contact: { email: 'ravi@x.com', phone: '555-666' } }, department: 'eng', salary: 78000, joined: '2021-03-22', addressesTab: { addresses: [] } },
  { _id: 'emp_004', personal: { firstName: 'Mei', lastName: 'Chen', status: 'active', contact: { email: 'mei@x.com', phone: '777-888' } }, department: 'hr', salary: 69000, joined: '2022-11-08', addressesTab: { addresses: [{ street: '5 Pine St', city: 'Cologne', zip: '50667' }] } },
  { _id: 'emp_005', personal: { firstName: 'Omar', lastName: 'Farid', status: 'active', contact: { email: 'omar@x.com', phone: '999-000' } }, department: 'sales', salary: 88000, joined: '2018-09-30', addressesTab: { addresses: [{ street: '7 Birch Ln', city: 'Berlin', zip: '10437' }] } },
  { _id: 'emp_006', personal: { firstName: 'Sara', lastName: 'Lopez', status: 'inactive', contact: { email: 'sara@x.com', phone: '121-212' } }, department: 'eng', salary: 95000, joined: '2017-02-14', addressesTab: { addresses: [{ street: '3 Cedar Ct', city: 'Munich', zip: '80333' }] } },
];
