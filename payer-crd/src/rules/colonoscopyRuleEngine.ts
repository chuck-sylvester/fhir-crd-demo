// --------------------------------------------------------------------------
// payer-crd/src/rules/colonoscopyRuleEngine.ts
// --------------------------------------------------------------------------
// Evaluates payer coverage rules against a patient's clinical context and
// returns a structured RuleResult describing the coverage decision.
// --------------------------------------------------------------------------

import type {
    FhirPatient,
    FhirCondition,
    FhirProcedure,
    FhirCoverage,
    RuleResult,
    RuleOutcome,
} from '../types/cdsHooks';

// Rule configuration - all payer policy threshholds and clinical codes in one place.
// 'as const' makes every value a read-only literal type, preventing mutation.
const RULE_CONFIG = {
    highRiskIntervalYears: 5,
    averageRiskIntervalYears: 10,
    colonoscopyCode: '45378',
    highRiskIcd10Codes: ['Z80.0'],
} as const;

// ICD-10-CM system URI - the standard identifier for this coding system.
const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';

// CPT system URI - the standard identifier for CPT procedure codes.
const CPT_SYSTEM = 'http://www.ama-assn.org/go/cpt';

// --------------------------------------------------------------------------
// Helper: hasHighRiskCondition
// --------------------------------------------------------------------------
// Returns true if any condition in the array carries an ICD-10-CM code that
// qualifies the patient as high-risk for colorectal cancer screening.
//
// Optional chaining (?.) safely handles the case where condition.code is
// absent; the nullish coalescing operator (?? false) converts the resulting
// undefined to false.
export function hasHighRiskCondition(conditions: FhirCondition[]): boolean {
  return conditions.some(
    (condition) =>
      condition.code?.coding.some(
        (coding) =>
          coding.system === ICD10_SYSTEM &&
          (RULE_CONFIG.highRiskIcd10Codes as readonly string[]).includes(coding.code)
      ) ?? false
  );
}

// --------------------------------------------------------------------------
// Helper: calculateAge
// --------------------------------------------------------------------------
// Returns the patient's age in full completed years as of today.
// birthDate must be an ISO 8601 date string: 'YYYY-MM-DD'.
export function calculateAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);

  // Start with the raw year difference.
  let age = today.getFullYear() - birth.getFullYear();

  // Subtract one year if the birthday has not yet occurred this year.
  // getMonth() returns 0–11; getDate() returns 1–31.
  const monthDiff = today.getMonth() - birth.getMonth();
  const dayDiff = today.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age--;
  }

  return age;
}

// --------------------------------------------------------------------------
// Helper: findMostRecentProcedure
// --------------------------------------------------------------------------
// Finds the most recently performed procedure matching the given CPT code.
// Returns null if no matching procedure exists.
//
// .filter() keeps only procedures whose code includes the target CPT code.
// .reduce() walks the filtered array keeping the procedure with the latest
// performedDateTime. ISO 8601 date strings are lexicographically sortable,
// so string comparison correctly identifies the most recent date.
export function findMostRecentProcedure(
  procedures: FhirProcedure[],
  cptCode: string
): FhirProcedure | null {
  // Filter to procedures that match the CPT code.
  const matching = procedures.filter((p) =>
    p.code?.coding.some(
      (c) => c.system === CPT_SYSTEM && c.code === cptCode
    )
  );

  // No matching procedures — return null to signal "not found".
  if (matching.length === 0) return null;

  // Find the procedure with the latest performedDateTime using reduce.
  // reduce() accumulates a result by comparing elements pairwise. Here
  // it keeps whichever procedure has the later date string.
  // The non-null assertion (!) is safe: we checked matching.length > 0 above,
  // and reduce() without an initial value requires a non-empty array.
  return matching.reduce((latest, current) => {
    const latestDate = latest.performedDateTime ?? '';
    const currentDate = current.performedDateTime ?? '';
    return currentDate > latestDate ? current : latest;
  });
}

// --------------------------------------------------------------------------
// Helper: yearsSince
// --------------------------------------------------------------------------
// Returns the number of years (as a decimal) elapsed since the given ISO 8601
// date string. Uses 365.25 days/year to account for leap years.
//
// JavaScript Date arithmetic works in milliseconds. Subtracting two Date
// values implicitly calls .getTime() on each, yielding a millisecond
// difference. Dividing by ms-per-year converts to fractional years.
export function yearsSince(dateString: string): number {
  const past = new Date(dateString);
  const now = new Date();
  const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
  return (now.getTime() - past.getTime()) / msPerYear;
}

// --------------------------------------------------------------------------
// Main export: evaluate
// --------------------------------------------------------------------------
// Orchestrates the helper functions and applies the payer's decision logic.
// Accepts the four FHIR resource inputs extracted by the CRD route handler.
// Returns a RuleResult describing the full decision.
//
// The FhirCoverage parameter is included for API completeness and future
// plan-specific rules. It is not used in Phase 1 logic.
export function evaluate(
  patient: FhirPatient | undefined,
  conditions: FhirCondition[],
  procedures: FhirProcedure[],
  _coverage: FhirCoverage | undefined   // prefixed _ signals intentionally unused
): RuleResult {
  // Step 1: Is the patient high-risk?
  const highRiskIndicator = hasHighRiskCondition(conditions);

  // Step 2: Patient age (null if birthDate not provided in prefetch).
  const patientAge =
    patient?.birthDate != null ? calculateAge(patient.birthDate) : null;

  // Step 3: Find the most recent prior colonoscopy.
  const priorProcedure = findMostRecentProcedure(
    procedures,
    RULE_CONFIG.colonoscopyCptCode
  );

  // Step 4: Years since the prior procedure (null if none found).
  const yearsSincePriorProcedure =
    priorProcedure?.performedDateTime != null
      ? yearsSince(priorProcedure.performedDateTime)
      : null;

  // Step 5: Does the new order meet the interval requirement?
  let meetsIntervalRequirement: boolean;
  if (yearsSincePriorProcedure === null) {
    // No prior procedure on record — first-time screening is always covered.
    meetsIntervalRequirement = true;
  } else if (highRiskIndicator) {
    meetsIntervalRequirement =
      yearsSincePriorProcedure >= RULE_CONFIG.highRiskIntervalYears;
  } else {
    meetsIntervalRequirement =
      yearsSincePriorProcedure >= RULE_CONFIG.averageRiskIntervalYears;
  }

  // Step 6: Determine the overall outcome.
  let outcome: RuleOutcome;
  if (highRiskIndicator && meetsIntervalRequirement) {
    outcome = 'covered-high-risk';
  } else if (!highRiskIndicator) {
    // Missing high-risk documentation is flagged regardless of interval.
    outcome = 'missing-documentation';
  } else {
    // highRiskIndicator is true but interval requirement not met.
    outcome = 'interval-not-met';
  }

  return {
    highRiskIndicator,
    patientAge,
    yearsSincePriorProcedure,
    meetsIntervalRequirement,
    outcome,
  };
}

