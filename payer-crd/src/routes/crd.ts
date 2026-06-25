// --------------------------------------------------------------------------
// payer-crd/src/routes/crd.ts
// --------------------------------------------------------------------------
// Handler for POST /cds-services/crd-order-sign — the CRD service endpoint.
// Parses the incoming CDS Hooks request, evaluates payer coverage rules,
// and returns a CDS Hooks response containing one or more CDS Cards.
//
// Processing pipeline:
//   1. Parse JSON request body
//   2. Validate required fields
//   3. Unwrap FHIR resources from prefetch bundles
//   4. Evaluate rule engine
//   5. Build CDS Cards
//   6. Return { cards: [...] }
// --------------------------------------------------------------------------

import type { Context } from 'hono';
import type {
  CdsHooksRequest,
  FhirCondition,
  FhirProcedure,
} from '../types/cdsHooks.js';
import { evaluate } from '../rules/colonoscopyRuleEngine.js';
import { buildCardsForOutcome } from '../cards/cardFactory.js';

export async function crdHandler(c: Context): Promise<Response> {

  // -- Step 1: Parse the JSON request body --------------------------------
  // c.req.json<T>() parses the request body as JSON and types the result as T.
  // We wrap it in try/catch because malformed JSON (a syntax error) throws
  // rather than returning a value.
  let body: CdsHooksRequest;
  try {
    body = await c.req.json<CdsHooksRequest>();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  // -- Step 2: Validate required fields ------------------------------------
  // The CDS Hooks spec requires 'hook' and 'context'. We also verify that
  // the hook value is 'order-sign' — this service only handles that hook type.
  if (!body.hook) {
    return c.json({ error: "Missing required field: 'hook'" }, 400);
  }
  if (body.hook !== 'order-sign') {
    return c.json(
      { error: `Unsupported hook type: '${body.hook}'. Expected 'order-sign'` },
      400
    );
  }
  if (!body.context) {
    return c.json({ error: "Missing required field: 'context'" }, 400);
  }

  // -- Step 3: Unwrap FHIR resources from prefetch bundles -----------------
  // patient and coverage are single resources (not wrapped in a Bundle).
  // conditions and priorProcedures are Bundles; .map() extracts the resource
  // from each entry's envelope: { resource: { ... } } → { ... }
  // The 'as FhirCondition' type assertion narrows Record<string,unknown> to
  // the specific interface. Safe here because we control the EHR fixture data.
  // '?? []' provides an empty array fallback when the prefetch key is absent.
  const patient = body.prefetch?.patient;

  const conditions =
    body.prefetch?.conditions?.entry?.map(
      (e) => e.resource as FhirCondition
    ) ?? [];

  const procedures =
    body.prefetch?.priorProcedures?.entry?.map(
      (e) => e.resource as FhirProcedure
    ) ?? [];

  const coverage = body.prefetch?.coverage;

  // -- Step 4: Evaluate payer coverage rules --------------------------------
  // evaluate() is a pure function — same inputs always produce same outputs.
  // It returns a RuleResult describing the coverage decision.
  const ruleResult = evaluate(patient, conditions, procedures, coverage);

  // -- Step 5: Build CDS Cards from the rule result -------------------------
  // buildCardsForOutcome() is async because it reads fixture files from disk.
  const cards = await buildCardsForOutcome(ruleResult);

  // -- Step 6: Return the CDS Hooks response --------------------------------
  // The CDS Hooks spec requires the top-level response to be { "cards": [...] }.
  return c.json({ cards }, 200);
}