// --------------------------------------------------------------------------
// payer-crd/src/cards/cardFactory.ts
// --------------------------------------------------------------------------
// Builds a CDS Card array from a RuleResult produced by the rule engine.
// Static scenarios load their cards from fixture files. The interval-not-met
// scenario is built inline because its summary contains the dynamic year count.
// --------------------------------------------------------------------------

import type { RuleResult, CdsCard } from '../types/cdsHooks.js';

// The fixture files wrap the cards array in a top-level object.
// This interface describes that wrapper so TypeScript knows what .json() returns.
interface CardFixture {
  cards: CdsCard[];
}

// buildCardsForOutcome reads the appropriate fixture (or builds inline) and
// returns the CdsCard[] array. The route handler adds the { cards: [...] }
// envelope before sending the HTTP response.
export async function buildCardsForOutcome(result: RuleResult): Promise<CdsCard[]> {

  if (result.outcome === 'covered-high-risk') {
    // Load the pre-authored info card from the fixture file.
    const fixture = await Bun.file('fixtures/cards-covered-high-risk.json').json() as CardFixture;
    return fixture.cards;
  }

  if (result.outcome === 'missing-documentation') {
    // Load the pre-authored warning card from the fixture file.
    const fixture = await Bun.file('fixtures/cards-missing-documentation.json').json() as CardFixture;
    return fixture.cards;
  }

  // outcome === 'interval-not-met'
  // Built inline because the summary contains the dynamic year count.
  // toFixed(1) formats the decimal to one place, e.g. '3.2'.
  const years =
    result.yearsSincePriorProcedure !== null
      ? result.yearsSincePriorProcedure.toFixed(1)
      : 'unknown';

  // Read env vars with fallbacks in case .env is not loaded.
  const payerName = Bun.env.PAYER_NAME ?? 'Demo Payer CRD Service';
  const payerBaseUrl = Bun.env.PAYER_BASE_URL ?? 'http://localhost:8080';

  const card: CdsCard = {
    summary: `Prior colonoscopy interval not met (${years} years since last procedure; 5 required)`,
    indicator: 'warning',
    source: {
      label: payerName,
      url: payerBaseUrl,
    },
    detail: [
      '## Screening Interval Requirement Not Met',
      '',
      `The patient's prior colonoscopy was performed approximately **${years} years ago**.`,
      'The high-risk screening protocol requires a minimum **5-year interval** between procedures.',
      '',
      '### What this means',
      '',
      '- This order as submitted does not meet the interval requirement',
      '- The order **may not be covered** without additional justification',
      '- Review the prior procedure history and clinical necessity before signing',
    ].join('\n'),
    links: [
      {
        label: 'Colonoscopy Risk Documentation Checklist',
        url: `${payerBaseUrl}/questionnaires/colonoscopy-risk`,
        type: 'absolute',
      },
    ],
  };

  return [card];
}