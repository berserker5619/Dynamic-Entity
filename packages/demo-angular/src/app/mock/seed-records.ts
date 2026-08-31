/**
 * Seed records for the entities that come from `test_data.json`.
 *
 * `test_data.json` ships configurations only — no records. `ensureSeed` seeded records for
 * `clients`, `employees` and `orders` alone, so the other five entities loaded a config,
 * rendered "Showing 0 of 0 records", and gave a visitor nothing to open. `insuranceClaims`
 * was the worst case: the richest configuration in the repository, and the one most likely
 * to be clicked first.
 *
 * The shape is not free-form. `getTabPath` nests a tab's values under its id unless the tab
 * sets `flatData`, and it recurses — so a sub-tab lands two levels deep at `parent.child`.
 * Each set below is written against the path its own config resolves to, which is why
 * `insuranceClaims` keeps `claimRef` at the root but `incidentDate` under
 * `incident.incidentDetails`.
 */

/** `organizations` — `orgInfo` is a plain nested tab. */
export const ORGANIZATIONS_RECORDS: Record<string, unknown>[] = [
  { _id: 'org_001', orgInfo: { orgName: 'Northwind Health', website: 'https://northwind.example' } },
  { _id: 'org_002', orgInfo: { orgName: 'Contoso Logistics', website: 'https://contoso.example' } },
  { _id: 'org_003', orgInfo: { orgName: 'Fabrikam Manufacturing', website: 'https://fabrikam.example' } },
];

/** `visitNotes` — one clinical note per record. */
export const VISIT_NOTES_RECORDS: Record<string, unknown>[] = [
  {
    _id: 'visit_001',
    visitSummaryTab: {
      patientName: 'Alice Brenner',
      visitDate: '2026-07-14',
      diagnosisNotes: 'Seasonal rhinitis. Advised antihistamine; review in six weeks if symptoms persist.',
    },
  },
  {
    _id: 'visit_002',
    visitSummaryTab: {
      patientName: 'Daniel Okoro',
      visitDate: '2026-08-02',
      diagnosisNotes: 'Follow-up after ankle sprain. Full weight-bearing restored, no further imaging required.',
    },
  },
  {
    _id: 'visit_003',
    visitSummaryTab: {
      patientName: 'Priya Raman',
      visitDate: '2026-08-19',
      diagnosisNotes: 'Routine review. Blood pressure within range; continue current medication.',
    },
  },
];

/**
 * `people` — the entity that exists to demonstrate ids being unique per *scope* rather than
 * per config. `address` appears in both tabs and means something different in each, so the
 * record nests them separately. A bare `address` would name neither one.
 */
export const PEOPLE_RECORDS: Record<string, unknown>[] = [
  {
    _id: 'person_001',
    personal: { fullName: 'Marta Kovacs', address: '14 Rakoczi ut, Budapest' },
    work: { address: 'Floor 3, Andrassy Office Park', deskNumber: 'B-114' },
  },
  {
    _id: 'person_002',
    personal: { fullName: 'Tom Whitfield', address: '8 Cranbourne Terrace, Leeds' },
    work: { address: 'Unit 2, Wellington Place', deskNumber: 'A-007' },
  },
  {
    _id: 'person_003',
    personal: { fullName: 'Yuki Tanaka', address: '3-12-4 Kita, Nagoya' },
    work: { address: 'Sakae Tower, 18F', deskNumber: 'C-233' },
  },
];

/**
 * `complexFullTest` — exercises every tab, including the nested group and the array.
 *
 * The option-bearing fields here carry an explicit `value` in the config (`ENG`, `ROLE_LEAD`,
 * `EMAIL`), so that is what is stored — unlike `insuranceClaims`, whose options are bare
 * localized objects and are stored whole.
 */
export const COMPLEX_FULL_TEST_RECORDS: Record<string, unknown>[] = [
  {
    _id: 'cft_001',
    generalTab: {
      fullName: 'Helena Vasquez',
      emailAddress: 'helena.vasquez@example.com',
      bioNotes: 'Joined from the platform team. Owns the migration workstream.',
      // Markdown source, not HTML — this is exactly what the record stores.
      releaseNotes: '# Q3 rollout\n\nMigration completed in **three** phases.\n\n- Schema\n- Traffic\n- Cutover',
      annualBudget: 480000,
      teamCount: 12,
      department: 'ENG',
      roles: ['ROLE_LEAD', 'ROLE_DEVOPS'],
      accountActive: true,
      contactMethod: 'EMAIL',
      optInNewsletter: true,
    },
    datesAndFilesTab: {
      joinDate: '2023-04-03',
      billingCycle: '2026-08',
      dailyShiftStart: '09:30',
      orgRef: 'acme',
      syncedClientName: 'Acme',
    },
    nestedStructuresTab: {
      addressGroup: { street: '22 Quayside', city: 'Rotterdam', postalCode: '3011 XW' },
      emergencyContacts: [
        { contactName: 'Luis Vasquez', relationship: 'Spouse', phoneNumber: '+31 6 1234 5678' },
        { contactName: 'Ana Duarte', relationship: 'Sister', phoneNumber: '+351 91 234 5678' },
      ],
    },
    securityAndRulesTab: { executiveSalary: 143000, taxIdNumber: 'NL-8842-19' },
  },
  {
    _id: 'cft_002',
    generalTab: {
      fullName: 'Ibrahim Haddad',
      emailAddress: 'ibrahim.haddad@example.com',
      bioNotes: 'Finance partner for the EMEA region.',
      releaseNotes: '## Budget notes\n\nSee the *EMEA* breakdown before sign-off.',
      annualBudget: 265000,
      teamCount: 4,
      department: 'FIN',
      roles: ['ROLE_AUDITOR'],
      accountActive: false,
      contactMethod: 'PHONE',
      optInNewsletter: false,
    },
    datesAndFilesTab: {
      joinDate: '2021-11-16',
      billingCycle: '2026-01',
      dailyShiftStart: '08:00',
      orgRef: 'globex',
      syncedClientName: 'Globex',
    },
    nestedStructuresTab: {
      addressGroup: { street: '5 Rue Lafayette', city: 'Paris', postalCode: '75009' },
      emergencyContacts: [
        { contactName: 'Nour Haddad', relationship: 'Brother', phoneNumber: '+33 6 98 76 54 32' },
      ],
    },
    securityAndRulesTab: { executiveSalary: 118500, taxIdNumber: 'FR-2277-04' },
  },
];

/**
 * `insuranceClaims` — the flagship configuration, and the one whose record shape is least
 * guessable: `claimant` sets `flatData` so its fields sit at the record root, while the
 * `incident` sub-tabs nest two levels deep.
 *
 * Entity-ref fields store the option's `value` (`acme`, `de`, `ber`), matching the loaders
 * registered in `app.config.ts`. `tier` is a `listName` lookup, and a lookup stores the list
 * item's localized `name` object — the same shape `clients` already uses for its own tier.
 * `claimDocuments` is a module tab with no fields, so it holds no record data.
 */
export const INSURANCE_CLAIMS_RECORDS: Record<string, unknown>[] = [
  {
    _id: 'claim_001',
    // `claimant` is flatData, so these seven live at the record root.
    claimRef: 'CLM-2026-0431',
    claimantEmail: 'r.delgado@example.com',
    nationalId: 'ES-4471-9920',
    tier: { en: 'Gold', de: 'Gold' },
    isEmployee: false,
    staffId: '',
    copyRefToPolicy: false,
    policy: {
      insurer: 'acme',
      insurerVat: 'DE111111',
      country: 'de',
      city: 'ber',
      sumInsured: 250000,
      excess: 1500,
      coverStart: '2026-01',
      policyNote: 'Commercial property cover, renewed without change to the schedule.',
      syncedClientTier: 'Gold',
    },
    incident: {
      incidentDetails: {
        incidentDate: '2026-06-11',
        incidentTime: '02:40',
        reportedAt: '2026-06-11T07:15',
        severity: { en: 'High' },
        damageTypes: [{ en: 'Fire' }, { en: 'Impact' }],
        narrative: 'Overnight electrical fire in the packing area. Sprinklers contained it to one bay.',
        location: { street: 'Gewerbestrasse 40', postcode: '10557', locality: 'Moabit' },
      },
      incidentAttachments: {},
    },
    settlement: {
      lineItems: [
        { itemDescription: 'Structural repair, packing bay', itemAmount: 48200, itemApproved: true },
        { itemDescription: 'Stock write-off', itemAmount: 17650, itemApproved: true },
        { itemDescription: 'Business interruption, 11 days', itemAmount: 23400, itemApproved: false },
      ],
      settlementTotal: 89250,
      auditorPin: '',
    },
  },
  {
    _id: 'claim_002',
    claimRef: 'CLM-2026-0522',
    claimantEmail: 'j.mercier@example.com',
    nationalId: 'FR-8830-1174',
    tier: { en: 'Silver', de: 'Silber' },
    isEmployee: true,
    staffId: 'EMP-2291',
    copyRefToPolicy: true,
    policy: {
      insurer: 'globex',
      insurerVat: 'FR222222',
      country: 'fr',
      city: 'par',
      sumInsured: 90000,
      excess: 500,
      coverStart: '2025-09',
      policyNote: 'Fleet policy. Two vehicles added mid-term.',
      syncedClientTier: 'Silver',
    },
    incident: {
      incidentDetails: {
        incidentDate: '2026-07-28',
        incidentTime: '17:05',
        reportedAt: '2026-07-28T18:20',
        severity: { en: 'Medium' },
        damageTypes: [{ en: 'Impact' }],
        narrative: 'Rear-ended at a junction. No injuries; third party accepted liability at the scene.',
        location: { street: 'Boulevard Voltaire 210', postcode: '75011', locality: 'Paris 11e' },
      },
      incidentAttachments: {},
    },
    settlement: {
      lineItems: [
        { itemDescription: 'Panel and bumper replacement', itemAmount: 4300, itemApproved: true },
        { itemDescription: 'Courtesy vehicle, 9 days', itemAmount: 810, itemApproved: true },
      ],
      settlementTotal: 5110,
      auditorPin: '',
    },
  },
  {
    _id: 'claim_003',
    claimRef: 'CLM-2026-0607',
    claimantEmail: 'sana.ali@example.com',
    nationalId: 'DE-1902-5567',
    tier: { en: 'Bronze', de: 'Bronze' },
    isEmployee: false,
    staffId: '',
    copyRefToPolicy: false,
    policy: {
      insurer: 'acme',
      insurerVat: 'DE111111',
      country: 'de',
      city: 'muc',
      sumInsured: 35000,
      excess: 250,
      coverStart: '2026-04',
      policyNote: 'Contents-only cover for a leased office suite.',
      syncedClientTier: 'Bronze',
    },
    incident: {
      incidentDetails: {
        incidentDate: '2026-08-05',
        incidentTime: '23:15',
        reportedAt: '2026-08-06T09:00',
        severity: { en: 'Low' },
        damageTypes: [{ en: 'Theft' }],
        narrative: 'Forced entry through a rear window. Two laptops and a monitor taken.',
        location: { street: 'Leopoldstrasse 12', postcode: '80802', locality: 'Schwabing' },
      },
      incidentAttachments: {},
    },
    settlement: {
      lineItems: [{ itemDescription: 'IT equipment replacement', itemAmount: 3950, itemApproved: false }],
      settlementTotal: 3950,
      auditorPin: '',
    },
  },
];
