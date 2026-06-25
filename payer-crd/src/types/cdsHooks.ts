// --------------------------------------------------------------------------
// payer-crd/src/types/cdsHooks.ts
// --------------------------------------------------------------------------
// TypeScript interfaces for the CDS Hooks protocol and FHIR R4 resources.
// All types are named exports; import with:
//   import type { CdsHooksRequest, CdsCard, RuleResult } from '../types/cdsHooks.js';
//
// Consumers:
//   src/routes/crd.ts          — parses incoming requests, builds responses
//   src/rules/colonoscopyRuleEngine.ts  — receives unwrapped FHIR resources
//   src/cards/cardFactory.ts   — produces CdsCard arrays from RuleResult
// --------------------------------------------------------------------------

// -- FHIR Supporting Types -------------------------------------------------
// Coding and CodeableConcept are the two-level structure FHIR uses for
// clinical codes (ICD-10-CM, CPT, SNOMED, etc.). Most coded fields on
// resource interfaces below are typed as FhirCodeableConcept.

export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding: FhirCoding[];
  text?: string;
}

// resource is typed loosely because FhirBundleEntry wraps any FHIR
// resource type. The route handler narrows with a type assertion
// (e.g. `e.resource as FhirCondition`) after unwrapping bundle entries.
export interface FhirBundleEntry {
  resource: Record<string, unknown>;
}

// resourceType is a string literal, not string, so TypeScript catches
// any attempt to substitute a non-Bundle resource where a Bundle is expected.
export interface FhirBundle {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry: FhirBundleEntry[];
}

// -- FHIR Resource Types ---------------------------------------------------
// Only fields consumed by the rule engine are typed precisely; all
// other FHIR fields on these resources are intentionally omitted.

export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  birthDate?: string;
  gender?: string;
  name?: Array<{ family?: string; given?: string[] }>;
}

export interface FhirCondition {
  resourceType: 'Condition';
  id: string;
  code?: FhirCodeableConcept;
  clinicalStatus?: FhirCodeableConcept;
}

export interface FhirProcedure {
  resourceType: 'Procedure';
  id: string;
  status: string;
  code?: FhirCodeableConcept;
  performedDateTime?: string;
}

export interface FhirCoverage {
  resourceType: 'Coverage';
  id: string;
  status: string;
}

// -- CDS Hooks Request Types ------------------------------------------
// Model the order-sign request body sent by the Python EHR Simulator.
// Property names are camelCase to match the CDS Hooks JSON wire format
// directly — no alias mapping is needed in TypeScript.

export interface CdsHooksContext {
  userId: string;
  patientId: string;
  encounterId?: string;
  draftOrders: FhirBundle;
}

// All prefetch keys are optional: the CDS Hooks spec does not guarantee
// prefetch delivery, and the rule engine handles absent keys by falling
// back to empty arrays or undefined in the route handler.
export interface CdsHooksPrefetch {
  patient?: FhirPatient;
  conditions?: FhirBundle;
  coverage?: FhirCoverage;
  priorProcedures?: FhirBundle;
}

export interface CdsHooksRequest {
  hook: string;
  hookInstance: string;
  fhirServer?: string;
  context: CdsHooksContext;
  prefetch?: CdsHooksPrefetch;
}

// -- CDS Hooks Response Types -----------------------------------------
// Model the card array returned to the EHR. The Python EHR parses this
// structure using its matching CdsHooksResponse Pydantic model.

export interface CdsSource {
  label: string;
  url?: string;
}

export interface CdsLink {
  label: string;
  url: string;
  // CDS Hooks defines exactly two link types; 'smart' initiates an OAuth
  // SMART app launch. Phase 1 uses 'absolute' links only.
  type: 'absolute' | 'smart';
}

export interface CdsCard {
  summary: string;
  indicator: 'info' | 'warning' | 'critical';
  source: CdsSource;
  detail?: string;
  // Optional rather than defaulting to []: cards with no links should
  // omit the key in the response JSON, not send an empty array.
  links?: CdsLink[];
}

export interface CdsHooksResponse {
  cards: CdsCard[];
}

// -- Rule Engine Types ------------------------------------------------

export type RuleOutcome =
  | 'covered-high-risk'
  | 'missing-documentation'
  | 'interval-not-met';

export interface RuleResult {
  highRiskIndicator: boolean;
  // null (not undefined) signals an intentional absence — the calculation
  // was attempted but the required input data was missing from the prefetch.
  patientAge: number | null;
  yearsSincePriorProcedure: number | null;
  meetsIntervalRequirement: boolean;
  outcome: RuleOutcome;
}
