// --------------------------------------------------------------------------
// payer-crd/src/rules/colonoscopyRuleEngine.ts
// --------------------------------------------------------------------------
// Module that takes clinical data as input, evaluates it against a set of
// payer-defined coverage policies, and produces a structured decision as
// output.
// --------------------------------------------------------------------------

import type {
    FhirPatient,
    FhirCondition,
    FhirProcedure,
    FhirCoverage,
    RuleResult,
    RuleOutcome,
} from '../types/cdsHooks';

console.log("hello!");
