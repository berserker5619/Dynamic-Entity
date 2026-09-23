import type { EntityFormConfig } from 'ngx-dynamic-entity';
import patientIntakeJson from './configs/patient-intake.json';
import itAssetsJson from './configs/it-assets.json';

export const PATIENT_INTAKE_CONFIG = patientIntakeJson as EntityFormConfig;
export const IT_ASSETS_CONFIG = itAssetsJson as EntityFormConfig;

export const PATIENT_INTAKE_RECORDS: Record<string, unknown>[] = [
  {
    _id: 'patient_001',
    demographics: {
      fullName: 'Eleanor Vance',
      dateOfBirth: '1984-06-12',
      gender: { en: 'Female', de: 'Weiblich' },
      bloodType: { en: 'O+' },
      ssn: '123-45-6789',
      triageLevel: { en: '3 - Urgent', de: '3 - Dringend' },
      systolicBP: 132,
      heartRate: 84,
      emergencyContact: 'Thomas Vance (Spouse) - +1 555-019-2831',
    },
    clinicalHistory: {
      hasAllergies: true,
      allergySeverity: { en: 'Severe / Anaphylaxis Risk', de: 'Schwer / Anaphylaxie-Risiko' },
      allergyDetails: 'Penicillin (Anaphylactic shock in 2018); EpiPen carried.',
      chiefComplaint: 'Acute right lower quadrant abdominal pain with low-grade fever.',
      currentMedications: 'Lisinopril 10mg daily, Multivitamins',
    },
    billingInsurance: {
      insuranceType: { en: 'Commercial / Private', de: 'Privatversicherung' },
      insuranceProvider: 'Blue Cross Blue Shield Horizon',
      policyNumber: 'BCBS-9842104',
      copayAmount: 35,
    },
    consentSignoff: {
      hipaaConsent: true,
      treatmentConsent: true,
      admittingClinician: 'Nurse Practitioner Sarah Miller, RN',
      intakeStatus: { en: 'Assigned to Treatment Bay', de: 'Behandlungszimmer' },
    },
  },
  {
    _id: 'patient_002',
    demographics: {
      fullName: 'Marcus Sterling',
      dateOfBirth: '1972-11-28',
      gender: { en: 'Male', de: 'Männlich' },
      bloodType: { en: 'A+' },
      ssn: '456-78-9012',
      triageLevel: { en: '2 - Emergent', de: '2 - Sehr dringend' },
      systolicBP: 178,
      heartRate: 110,
      emergencyContact: 'Claire Sterling (Daughter) - +1 555-014-9921',
    },
    clinicalHistory: {
      hasAllergies: false,
      chiefComplaint: 'Sudden onset chest tightness radiating to left shoulder, diaphoresis.',
      currentMedications: 'Atorvastatin 20mg, Aspirin 81mg',
    },
    billingInsurance: {
      insuranceType: { en: 'Statutory / Public (GKV)', de: 'Gesetzlich (GKV)' },
      insuranceProvider: 'Techniker Krankenkasse (TK)',
      policyNumber: 'TK-84729103',
      copayAmount: 10,
    },
    consentSignoff: {
      hipaaConsent: true,
      treatmentConsent: true,
      admittingClinician: 'Dr. Gregory House, MD',
      intakeStatus: { en: 'Assigned to Treatment Bay', de: 'Behandlungszimmer' },
    },
  },
  {
    _id: 'patient_003',
    demographics: {
      fullName: 'Amara Chen',
      dateOfBirth: '1998-03-15',
      gender: { en: 'Non-Binary', de: 'Divers' },
      bloodType: { en: 'B-' },
      ssn: '789-01-2345',
      triageLevel: { en: '4 - Less Urgent', de: '4 - Normal' },
      systolicBP: 118,
      heartRate: 72,
      emergencyContact: 'David Chen (Parent) - +1 555-018-4410',
    },
    clinicalHistory: {
      hasAllergies: true,
      allergySeverity: { en: 'Mild (Rash / Sneezing)', de: 'Leicht (Ausschlag)' },
      allergyDetails: 'Latex hypersensitivity (mild contact dermatitis).',
      chiefComplaint: 'Sprained left ankle following trail run, mild edema, bearing weight with difficulty.',
      currentMedications: 'None',
    },
    billingInsurance: {
      insuranceType: { en: 'Self-Pay / Uninsured', de: 'Selbstzahler' },
      copayAmount: 0,
    },
    consentSignoff: {
      hipaaConsent: true,
      treatmentConsent: true,
      admittingClinician: 'Triage Specialist James O\'Connor',
      intakeStatus: { en: 'Waiting in Triage', de: 'Wartebereich' },
    },
  },
];

export const IT_ASSETS_RECORDS: Record<string, unknown>[] = [
  {
    _id: 'asset_001',
    assetSpecs: {
      assetTag: 'AST-10492',
      deviceType: { en: 'Workstation / Laptop', de: 'Notebook / Arbeitsplatz' },
      manufacturer: { en: 'Apple Inc.' },
      modelName: 'MacBook Pro 16" M3 Max (64GB / 2TB)',
      serialNumber: 'C02G40ALMD6T',
      purchasePrice: 4299,
      purchaseDate: '2025-01-15',
    },
    assignmentLifecycle: {
      operationalStatus: { en: 'In Service / Deployed', de: 'Im Einsatz' },
      assignedEmployee: 'Liam Gallagher (Staff Platform Architect)',
      department: { en: 'Engineering & Product', de: 'Entwicklung & Produkt' },
      officeLocation: 'Building A, Floor 4, Desk 412 (HQ)',
    },
  },
  {
    _id: 'asset_002',
    assetSpecs: {
      assetTag: 'AST-10884',
      deviceType: { en: 'Rack Server / Host', de: 'Server / Host' },
      manufacturer: { en: 'Dell Technologies' },
      modelName: 'PowerEdge R760 2U Dual Xeon Platinum',
      serialNumber: 'DL-R760-99214A',
      purchasePrice: 18500,
      purchaseDate: '2024-08-20',
    },
    assignmentLifecycle: {
      operationalStatus: { en: 'In Service / Deployed', de: 'Im Einsatz' },
      assignedEmployee: 'SRE Infrastructure Cluster (Prod-US-East)',
      department: { en: 'Infrastructure & SecOps', de: 'IT & Sicherheit' },
      officeLocation: 'Equinix DC11, Ashburn VA, Rack 14B',
    },
  },
  {
    _id: 'asset_003',
    assetSpecs: {
      assetTag: 'AST-09142',
      deviceType: { en: 'Workstation / Laptop', de: 'Notebook / Arbeitsplatz' },
      manufacturer: { en: 'Lenovo' },
      modelName: 'ThinkPad X1 Carbon Gen 10',
      serialNumber: 'PF-2849102X',
      purchasePrice: 2150,
      purchaseDate: '2022-04-10',
    },
    assignmentLifecycle: {
      operationalStatus: { en: 'Decommissioned / Retired', de: 'Ausgemustert' },
      department: { en: 'Finance & Legal', de: 'Finanzen & Recht' },
      officeLocation: 'IT Secure Storage Cage 2',
    },
    decommissionTab: {
      sanitizationStandard: { en: 'NIST SP 800-88 Clear (Cryptographic Erase)' },
      sanitizationCertified: true,
      retirementNotes: 'End of 3-year enterprise lease cycle. NVMe SSD cryptographically erased and audit log signed (NIST SP 800-88).',
    },
  },
];
