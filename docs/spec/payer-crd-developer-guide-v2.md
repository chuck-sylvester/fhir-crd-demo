# Payer CRD Service v2 — Developer Guide

This guide walks through a clean-room implementation of the Bun + Hono Payer CRD Service for the `fhir-crd-demo2` repository. The v2 application keeps the same technology stack as the first version, but uses a new clinical scenario: **Lumbar Spine MRI Coverage Discovery**.

Every section is self-contained. The guide is written for a brand-new empty repository, so every file and directory is labelled **[CREATE]**.

The companion provider guide is `docs/spec/provider-ehr-developer-guide-v2.md`.

---

## Table of Contents

1. Background and Architecture
2. Project Configuration
3. TypeScript Types
4. Application Entry Point
5. CDS Hooks Discovery Endpoint
6. Lumbar MRI Rule Engine
7. Card Response Fixtures
8. Card Factory
9. CRD Route Handler
10. Placeholder Questionnaire Endpoint
11. Testing
12. End-to-End Verification

---

## Section 1 — Background and Architecture [CREATE]

### 1.1 What This Service Does

The Payer CRD Service simulates an external payer's Coverage Requirements Discovery endpoint. It implements the server side of the CDS Hooks protocol:

1. Advertise supported CDS Hooks services at `GET /cds-services`.
2. Receive an `order-sign` CDS Hooks request from the Python Provider EHR.
3. Extract relevant FHIR resources from the request.
4. Evaluate payer-specific rules for lumbar spine MRI coverage.
5. Return CDS Cards describing documentation status, likely coverage path, or prior authorization expectations.

This is a demonstration service. It does not perform real medical necessity review, eligibility verification, prior authorization submission, terminology validation, or SMART authorization.

### 1.2 Clinical Scenario: Lumbar Spine MRI Coverage Discovery

The clinician is ordering **MRI lumbar spine without contrast** for a patient with persistent low back pain and lumbar radiculopathy symptoms.

The simulated payer policy is intentionally simple:

- Lumbar spine MRI is commonly not first-line imaging for uncomplicated low back pain.
- The payer wants evidence of at least 6 weeks of conservative therapy before routine imaging approval.
- Red-flag findings can support expedited imaging review.
- Missing conservative therapy documentation should return a card with a placeholder DTR-style questionnaire link.

### 1.3 CDS Hooks Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/cds-services` | Discovery metadata |
| `POST` | `/cds-services/crd-order-sign` | Evaluate the draft MRI order |
| `GET` | `/questionnaires/lumbar-mri-documentation` | Placeholder DTR-style documentation link |

### 1.4 FHIR Resources Consumed

| Resource | Prefetch key | Use |
|----------|--------------|-----|
| `Patient` | `patient` | Patient context |
| `Coverage` | `coverage` | Payer/plan context |
| `Condition` Bundle | `conditions` | Low back pain and radiculopathy evidence |
| `Observation` Bundle | `observations` | Conservative therapy duration and red-flag status |
| `Procedure` Bundle | `procedures` | Completed physical therapy or conservative management |
| `ServiceRequest` Bundle | `context.draftOrders` | Draft MRI order |

### 1.5 Rule Outcomes

| Outcome | Indicator | Meaning |
|---------|-----------|---------|
| `documentation-sufficient` | `info` | The request includes conservative therapy evidence meeting the simulated payer threshold |
| `red-flags-present` | `warning` | The request includes red-flag evidence; expedited review may be appropriate |
| `documentation-needed` | `warning` | Conservative therapy evidence is missing or below threshold |
| `prior-auth-likely` | `warning` | The order is relevant to payer policy and likely requires prior authorization |

The card factory may return more than one card. For example, a missing documentation card can be accompanied by a prior authorization expectation card.

### 1.6 Technology Stack

| Component | Choice | Purpose |
|-----------|--------|---------|
| Runtime | Bun | TypeScript execution, package management, test runner |
| Language | TypeScript strict mode | Strong typing for CDS Hooks and FHIR-shaped data |
| Web framework | Hono | Lightweight HTTP routing |
| Testing | `bun test` | Built-in test runner |
| Persistence | None | Stateless request evaluation |

---

## Section 2 — Project Configuration [CREATE]

### 2.1 Directory Structure

Create this structure inside the new `fhir-crd-demo2` repository:

```text
payer-crd/
|-- src/
|   |-- index.ts
|   |-- routes/
|   |   |-- discovery.ts
|   |   |-- crd.ts
|   |   |-- questionnaires.ts
|   |-- rules/
|   |   |-- lumbarMriRuleEngine.ts
|   |-- cards/
|   |   |-- cardFactory.ts
|   |-- types/
|       |-- cdsHooks.ts
|-- fixtures/
|   |-- cds-discovery.json
|   |-- cards-documentation-sufficient.json
|   |-- cards-documentation-needed.json
|   |-- cards-red-flags-present.json
|   |-- cards-prior-auth-likely.json
|-- tests/
|   |-- rules/
|   |   |-- lumbarMriRuleEngine.test.ts
|   |-- routes/
|       |-- discovery.test.ts
|       |-- crd.test.ts
|-- .env
|-- .env.example
|-- package.json
|-- tsconfig.json
```

### 2.2 `package.json`

Create `payer-crd/package.json`:

```json
{
  "name": "payer-crd-v2",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.12.23"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^6.0.3"
  }
}
```

### 2.3 `tsconfig.json`

Create `payer-crd/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "types": ["bun-types"],
    "lib": ["ESNext"],
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

### 2.4 `.env`

Create `payer-crd/.env`:

```text
APP_ENV=development
LOG_LEVEL=DEBUG
PAYER_NAME=Demo Payer CRD Service v2
PAYER_BASE_URL=http://localhost:8080
PORT=8080
```

### 2.5 `.env.example`

Create `payer-crd/.env.example`:

```text
# payer-crd environment configuration
# Copy this file to .env and fill in local values.

APP_ENV=development
LOG_LEVEL=DEBUG
PAYER_NAME=Demo Payer CRD Service v2
PAYER_BASE_URL=http://localhost:8080
PORT=8080
```

### 2.6 Install Dependencies

Run from `payer-crd/`:

```bash
bun install
bun run dev
```

Expected startup output:

```text
Payer CRD v2 listening on port 8080
```

---

## Section 3 — TypeScript Types [CREATE]

Create `payer-crd/src/types/cdsHooks.ts`:

```typescript
export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirQuantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface FhirPeriod {
  start?: string;
  end?: string;
}

export interface FhirBundleEntry {
  resource: Record<string, unknown>;
}

export interface FhirBundle {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry?: FhirBundleEntry[];
}

export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  birthDate?: string;
  gender?: string;
  name?: Array<{ family?: string; given?: string[] }>;
}

export interface FhirCoverage {
  resourceType: 'Coverage';
  id: string;
  status: string;
}

export interface FhirCondition {
  resourceType: 'Condition';
  id: string;
  code?: FhirCodeableConcept;
  clinicalStatus?: FhirCodeableConcept;
}

export interface FhirObservation {
  resourceType: 'Observation';
  id: string;
  status: string;
  code?: FhirCodeableConcept;
  valueBoolean?: boolean;
  valueQuantity?: FhirQuantity;
}

export interface FhirProcedure {
  resourceType: 'Procedure';
  id: string;
  status: string;
  code?: FhirCodeableConcept;
  performedDateTime?: string;
  performedPeriod?: FhirPeriod;
}

export interface FhirServiceRequest {
  resourceType: 'ServiceRequest';
  id: string;
  status: string;
  intent: string;
  code?: FhirCodeableConcept;
  authoredOn?: string;
}

export interface CdsHooksContext {
  userId: string;
  patientId: string;
  encounterId?: string;
  draftOrders: FhirBundle;
}

export interface CdsHooksPrefetch {
  patient?: FhirPatient;
  coverage?: FhirCoverage;
  conditions?: FhirBundle;
  observations?: FhirBundle;
  procedures?: FhirBundle;
}

export interface CdsHooksRequest {
  hook: string;
  hookInstance: string;
  fhirServer?: string;
  context: CdsHooksContext;
  prefetch?: CdsHooksPrefetch;
}

export interface CdsSource {
  label: string;
  url?: string;
}

export interface CdsLink {
  label: string;
  url: string;
  type: 'absolute' | 'smart';
}

export interface CdsCard {
  summary: string;
  indicator: 'info' | 'warning' | 'critical';
  source: CdsSource;
  detail?: string;
  links?: CdsLink[];
}

export interface CdsHooksResponse {
  cards: CdsCard[];
}

export type RuleOutcome =
  | 'documentation-sufficient'
  | 'documentation-needed'
  | 'red-flags-present'
  | 'prior-auth-likely';

export interface RuleResult {
  mriOrderPresent: boolean;
  lowBackPainDiagnosisPresent: boolean;
  radiculopathyDiagnosisPresent: boolean;
  conservativeTherapyWeeks: number | null;
  redFlagsPresent: boolean;
  meetsConservativeTherapyRequirement: boolean;
  outcome: RuleOutcome;
}
```

The TypeScript interfaces intentionally type only the fields consumed by this demo. FHIR resources may contain many more fields; structural typing allows those extra fields to be present without expanding every interface.

---

## Section 4 — Application Entry Point [CREATE]

Create `payer-crd/src/index.ts`:

```typescript
import { Hono } from 'hono';
import { crdHandler } from './routes/crd.js';
import { discoveryHandler } from './routes/discovery.js';
import { questionnaireHandler } from './routes/questionnaires.js';

const app = new Hono();

app.get('/cds-services', discoveryHandler);
app.post('/cds-services/crd-order-sign', crdHandler);
app.get('/questionnaires/lumbar-mri-documentation', questionnaireHandler);

const port = Number(Bun.env.PORT) || 8080;

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Payer CRD v2 listening on port ${port}`);
```

---

## Section 5 — CDS Hooks Discovery Endpoint [CREATE]

### 5.1 Discovery Fixture

Create `payer-crd/fixtures/cds-discovery.json`:

```json
{
  "services": [
    {
      "hook": "order-sign",
      "id": "crd-order-sign",
      "title": "Lumbar Spine MRI Coverage Requirements Discovery",
      "description": "Evaluates coverage and documentation expectations for lumbar spine MRI orders",
      "prefetch": {
        "patient": "Patient/{{context.patientId}}",
        "coverage": "Coverage?patient={{context.patientId}}&status=active",
        "conditions": "Condition?patient={{context.patientId}}&clinical-status=active",
        "observations": "Observation?patient={{context.patientId}}",
        "procedures": "Procedure?patient={{context.patientId}}&status=completed"
      }
    }
  ]
}
```

### 5.2 Discovery Route

Create `payer-crd/src/routes/discovery.ts`:

```typescript
import type { Context } from 'hono';


export async function discoveryHandler(c: Context): Promise<Response> {
  const data = await Bun.file('fixtures/cds-discovery.json').json();
  return c.json(data, 200);
}
```

---

## Section 6 — Lumbar MRI Rule Engine [CREATE]

Create `payer-crd/src/rules/lumbarMriRuleEngine.ts`:

```typescript
import type {
  FhirCondition,
  FhirObservation,
  FhirProcedure,
  FhirServiceRequest,
  RuleResult,
} from '../types/cdsHooks.js';


const RULE_CONFIG = {
  lumbarMriCptCode: '72148',
  lowBackPainCodes: ['M54.50'],
  radiculopathyCodes: ['M54.16'],
  conservativeTherapyLoincCode: '89261-2',
  redFlagSnomedCode: '707445000',
  requiredTherapyWeeks: 6,
} as const;

const CPT_SYSTEM = 'http://www.ama-assn.org/go/cpt';
const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';
const LOINC_SYSTEM = 'http://loinc.org';
const SNOMED_SYSTEM = 'http://snomed.info/sct';


function hasCode(
  resource: { code?: { coding?: Array<{ system: string; code: string }> } },
  system: string,
  codes: readonly string[]
): boolean {
  return resource.code?.coding?.some(
    (coding) => coding.system === system && codes.includes(coding.code)
  ) ?? false;
}


export function hasLumbarMriOrder(orders: FhirServiceRequest[]): boolean {
  return orders.some((order) =>
    hasCode(order, CPT_SYSTEM, [RULE_CONFIG.lumbarMriCptCode])
  );
}


export function hasLowBackPainDiagnosis(conditions: FhirCondition[]): boolean {
  return conditions.some((condition) =>
    hasCode(condition, ICD10_SYSTEM, RULE_CONFIG.lowBackPainCodes)
  );
}


export function hasRadiculopathyDiagnosis(conditions: FhirCondition[]): boolean {
  return conditions.some((condition) =>
    hasCode(condition, ICD10_SYSTEM, RULE_CONFIG.radiculopathyCodes)
  );
}


export function conservativeTherapyWeeks(
  observations: FhirObservation[],
  procedures: FhirProcedure[]
): number | null {
  const durationObservation = observations.find((observation) =>
    hasCode(observation, LOINC_SYSTEM, [RULE_CONFIG.conservativeTherapyLoincCode])
  );

  if (durationObservation?.valueQuantity?.value != null) {
    return durationObservation.valueQuantity.value;
  }

  const therapyProcedure = procedures.find((procedure) =>
    procedure.status === 'completed' && procedure.performedPeriod?.start && procedure.performedPeriod?.end
  );

  if (!therapyProcedure?.performedPeriod?.start || !therapyProcedure.performedPeriod.end) {
    return null;
  }

  const start = new Date(therapyProcedure.performedPeriod.start);
  const end = new Date(therapyProcedure.performedPeriod.end);
  const msPerWeek = 1000 * 60 * 60 * 24 * 7;
  return (end.getTime() - start.getTime()) / msPerWeek;
}


export function redFlagsPresent(observations: FhirObservation[]): boolean {
  const redFlagObservation = observations.find((observation) =>
    hasCode(observation, SNOMED_SYSTEM, [RULE_CONFIG.redFlagSnomedCode])
  );

  return redFlagObservation?.valueBoolean === true;
}


export function evaluate(
  orders: FhirServiceRequest[],
  conditions: FhirCondition[],
  observations: FhirObservation[],
  procedures: FhirProcedure[]
): RuleResult {
  const mriOrderPresent = hasLumbarMriOrder(orders);
  const lowBackPainDiagnosisPresent = hasLowBackPainDiagnosis(conditions);
  const radiculopathyDiagnosisPresent = hasRadiculopathyDiagnosis(conditions);
  const therapyWeeks = conservativeTherapyWeeks(observations, procedures);
  const hasRedFlags = redFlagsPresent(observations);
  const meetsConservativeTherapyRequirement =
    therapyWeeks !== null && therapyWeeks >= RULE_CONFIG.requiredTherapyWeeks;

  let outcome: RuleResult['outcome'];

  if (hasRedFlags) {
    outcome = 'red-flags-present';
  } else if (mriOrderPresent && meetsConservativeTherapyRequirement) {
    outcome = 'documentation-sufficient';
  } else if (mriOrderPresent && !meetsConservativeTherapyRequirement) {
    outcome = 'documentation-needed';
  } else {
    outcome = 'prior-auth-likely';
  }

  return {
    mriOrderPresent,
    lowBackPainDiagnosisPresent,
    radiculopathyDiagnosisPresent,
    conservativeTherapyWeeks: therapyWeeks,
    redFlagsPresent: hasRedFlags,
    meetsConservativeTherapyRequirement,
    outcome,
  };
}
```

The rule engine is deliberately pure: it receives arrays of already-extracted FHIR resources and returns a plain `RuleResult`.

---

## Section 7 — Card Response Fixtures [CREATE]

Create card fixtures in `payer-crd/fixtures/`.

### 7.1 `cards-documentation-sufficient.json`

```json
{
  "cards": [
    {
      "summary": "Lumbar MRI documentation appears sufficient",
      "indicator": "info",
      "source": {
        "label": "Demo Payer CRD Service v2",
        "url": "http://localhost:8080"
      },
      "detail": "The request includes documentation of conservative therapy meeting the simulated 6-week threshold for lumbar spine MRI coverage review.",
      "links": [
        {
          "label": "Lumbar MRI Documentation Checklist",
          "url": "http://localhost:8080/questionnaires/lumbar-mri-documentation",
          "type": "absolute"
        }
      ]
    }
  ]
}
```

### 7.2 `cards-documentation-needed.json`

```json
{
  "cards": [
    {
      "summary": "Conservative therapy documentation is needed",
      "indicator": "warning",
      "source": {
        "label": "Demo Payer CRD Service v2",
        "url": "http://localhost:8080"
      },
      "detail": "The payer could not confirm at least 6 weeks of conservative therapy for this lumbar spine MRI request. Complete the documentation checklist before signing when clinically appropriate.",
      "links": [
        {
          "label": "Complete Lumbar MRI Documentation",
          "url": "http://localhost:8080/questionnaires/lumbar-mri-documentation",
          "type": "absolute"
        }
      ]
    }
  ]
}
```

### 7.3 `cards-red-flags-present.json`

```json
{
  "cards": [
    {
      "summary": "Red-flag findings support expedited imaging review",
      "indicator": "warning",
      "source": {
        "label": "Demo Payer CRD Service v2",
        "url": "http://localhost:8080"
      },
      "detail": "The request includes red-flag findings. Expedited imaging review may be appropriate under the simulated payer policy.",
      "links": [
        {
          "label": "Lumbar MRI Red-Flag Documentation",
          "url": "http://localhost:8080/questionnaires/lumbar-mri-documentation",
          "type": "absolute"
        }
      ]
    }
  ]
}
```

### 7.4 `cards-prior-auth-likely.json`

```json
{
  "cards": [
    {
      "summary": "Prior authorization is likely for this MRI order",
      "indicator": "warning",
      "source": {
        "label": "Demo Payer CRD Service v2",
        "url": "http://localhost:8080"
      },
      "detail": "The simulated payer policy indicates that lumbar spine MRI commonly requires prior authorization. This demo does not implement PAS submission.",
      "links": [
        {
          "label": "Prior Authorization Documentation Placeholder",
          "url": "http://localhost:8080/questionnaires/lumbar-mri-documentation",
          "type": "absolute"
        }
      ]
    }
  ]
}
```

---

## Section 8 — Card Factory [CREATE]

Create `payer-crd/src/cards/cardFactory.ts`:

```typescript
import type { CdsCard, RuleResult } from '../types/cdsHooks.js';


interface CardFixture {
  cards: CdsCard[];
}


const FIXTURE_BY_OUTCOME: Record<RuleResult['outcome'], string> = {
  'documentation-sufficient': 'fixtures/cards-documentation-sufficient.json',
  'documentation-needed': 'fixtures/cards-documentation-needed.json',
  'red-flags-present': 'fixtures/cards-red-flags-present.json',
  'prior-auth-likely': 'fixtures/cards-prior-auth-likely.json',
};


export async function buildCardsForOutcome(result: RuleResult): Promise<CdsCard[]> {
  const fixturePath = FIXTURE_BY_OUTCOME[result.outcome];
  const fixture = await Bun.file(fixturePath).json() as CardFixture;

  if (result.outcome === 'documentation-needed') {
    const priorAuthFixture = await Bun.file('fixtures/cards-prior-auth-likely.json').json() as CardFixture;
    return [...fixture.cards, ...priorAuthFixture.cards];
  }

  return fixture.cards;
}
```

The card factory keeps text-heavy CDS Card content out of the rule engine. The rule engine decides what happened; the card factory decides how to explain it.

---

## Section 9 — CRD Route Handler [CREATE]

Create `payer-crd/src/routes/crd.ts`:

```typescript
import type { Context } from 'hono';
import type {
  CdsHooksRequest,
  FhirCondition,
  FhirObservation,
  FhirProcedure,
  FhirServiceRequest,
} from '../types/cdsHooks.js';
import { buildCardsForOutcome } from '../cards/cardFactory.js';
import { evaluate } from '../rules/lumbarMriRuleEngine.js';


function resourcesFromBundle<T>(bundle: { entry?: Array<{ resource: Record<string, unknown> }> } | undefined): T[] {
  return bundle?.entry?.map((entry) => entry.resource as T) ?? [];
}


export async function crdHandler(c: Context): Promise<Response> {
  let body: CdsHooksRequest;

  try {
    body = await c.req.json<CdsHooksRequest>();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  if (body.hook !== 'order-sign') {
    return c.json({ error: "Unsupported hook. Expected 'order-sign'." }, 400);
  }

  if (!body.context?.draftOrders) {
    return c.json({ error: "Missing required field: 'context.draftOrders'" }, 400);
  }

  const orders = resourcesFromBundle<FhirServiceRequest>(body.context.draftOrders);
  const conditions = resourcesFromBundle<FhirCondition>(body.prefetch?.conditions);
  const observations = resourcesFromBundle<FhirObservation>(body.prefetch?.observations);
  const procedures = resourcesFromBundle<FhirProcedure>(body.prefetch?.procedures);

  const ruleResult = evaluate(orders, conditions, observations, procedures);
  const cards = await buildCardsForOutcome(ruleResult);

  return c.json({ cards }, 200);
}
```

This route performs only minimal validation. Stronger conformance validation is intentionally out of scope for v2.

---

## Section 10 — Placeholder Questionnaire Endpoint [CREATE]

Create `payer-crd/src/routes/questionnaires.ts`:

```typescript
import type { Context } from 'hono';


export function questionnaireHandler(c: Context): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Lumbar MRI Documentation Placeholder</title>
    <style>
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7f9;
        color: #1f2937;
      }
      main {
        max-width: 760px;
        margin: 48px auto;
        padding: 24px;
        background: #fff;
        border: 1px solid #d9dee7;
        border-radius: 8px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Lumbar MRI Documentation Placeholder</h1>
      <p>This page represents a future DTR-style questionnaire or documentation app launch.</p>
      <p>The v2 CRD demo links here, but does not implement DTR questionnaire rendering or SMART launch.</p>
    </main>
  </body>
</html>`;

  return c.html(html, 200);
}
```

This endpoint is intentionally simple. It gives CDS Cards a real absolute URL while keeping DTR out of scope.

---

## Section 11 — Testing [CREATE]

### 11.1 Rule Engine Tests

Create `payer-crd/tests/rules/lumbarMriRuleEngine.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { evaluate } from '../../src/rules/lumbarMriRuleEngine.js';
import type { FhirCondition, FhirObservation, FhirProcedure, FhirServiceRequest } from '../../src/types/cdsHooks.js';


const mriOrder: FhirServiceRequest = {
  resourceType: 'ServiceRequest',
  id: 'order-1',
  status: 'draft',
  intent: 'order',
  code: {
    coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '72148' }],
  },
};

const lowBackPain: FhirCondition = {
  resourceType: 'Condition',
  id: 'condition-1',
  code: {
    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'M54.50' }],
  },
};

const therapySixWeeks: FhirObservation = {
  resourceType: 'Observation',
  id: 'observation-1',
  status: 'final',
  code: {
    coding: [{ system: 'http://loinc.org', code: '89261-2' }],
  },
  valueQuantity: { value: 6, unit: 'weeks' },
};

const noRedFlags: FhirObservation = {
  resourceType: 'Observation',
  id: 'observation-2',
  status: 'final',
  code: {
    coding: [{ system: 'http://snomed.info/sct', code: '707445000' }],
  },
  valueBoolean: false,
};

const noProcedures: FhirProcedure[] = [];


describe('lumbar MRI rule engine', () => {
  test('returns documentation-sufficient when conservative therapy meets threshold', () => {
    const result = evaluate([mriOrder], [lowBackPain], [therapySixWeeks, noRedFlags], noProcedures);

    expect(result.mriOrderPresent).toBe(true);
    expect(result.meetsConservativeTherapyRequirement).toBe(true);
    expect(result.outcome).toBe('documentation-sufficient');
  });

  test('returns documentation-needed when therapy evidence is absent', () => {
    const result = evaluate([mriOrder], [lowBackPain], [noRedFlags], noProcedures);

    expect(result.meetsConservativeTherapyRequirement).toBe(false);
    expect(result.outcome).toBe('documentation-needed');
  });
});
```

### 11.2 Discovery Route Test

Create `payer-crd/tests/routes/discovery.test.ts`:

```typescript
import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { discoveryHandler } from '../../src/routes/discovery.js';


test('GET /cds-services returns discovery metadata', async () => {
  const app = new Hono();
  app.get('/cds-services', discoveryHandler);

  const response = await app.request('/cds-services');
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.services[0].id).toBe('crd-order-sign');
});
```

### 11.3 CRD Route Test

Create `payer-crd/tests/routes/crd.test.ts`:

```typescript
import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { crdHandler } from '../../src/routes/crd.js';


test('POST /cds-services/crd-order-sign returns CDS Cards', async () => {
  const app = new Hono();
  app.post('/cds-services/crd-order-sign', crdHandler);

  const payload = {
    hook: 'order-sign',
    hookInstance: 'test-hook-instance',
    context: {
      userId: 'PractitionerRole/demo-clinician',
      patientId: 'demo-patient-001',
      draftOrders: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'ServiceRequest',
              id: 'order-1',
              status: 'draft',
              intent: 'order',
              code: {
                coding: [
                  {
                    system: 'http://www.ama-assn.org/go/cpt',
                    code: '72148'
                  }
                ]
              }
            }
          }
        ]
      }
    },
    prefetch: {
      observations: {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'obs-1',
              status: 'final',
              code: {
                coding: [{ system: 'http://loinc.org', code: '89261-2' }]
              },
              valueQuantity: { value: 6, unit: 'weeks' }
            }
          }
        ]
      }
    }
  };

  const response = await app.request('/cds-services/crd-order-sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.cards.length).toBeGreaterThan(0);
});
```

Run all tests:

```bash
bun test
```

---

## Section 12 — End-to-End Verification [CREATE]

Start the payer:

```bash
cd payer-crd
bun install
bun run dev
```

Confirm discovery:

```bash
curl http://localhost:8080/cds-services
```

Start the EHR in another terminal:

```bash
cd provider-ehr
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Open:

```text
http://localhost:8000
```

Expected behavior:

1. The Provider EHR displays the demo patient chart.
2. The clinician triggers CRD for the lumbar spine MRI order.
3. The EHR POSTs a CDS Hooks `order-sign` request to the payer.
4. The payer evaluates the request and returns CDS Cards.
5. The EHR renders those cards inline.
6. Card links open the placeholder DTR-style documentation page.

The implementation is complete when `bun test` passes and the Provider EHR can render payer guidance from the Bun + Hono CRD service.
