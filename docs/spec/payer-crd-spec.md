# Payer CRD Service — Design Specification

---

## 1. Overview

The Bun + Hono Payer CRD Service simulates an external payer's Coverage Requirements Discovery endpoint. It implements the server side of the CDS Hooks protocol: it advertises its services via a discovery endpoint, receives CDS Hooks `order-sign` requests from the Python EHR Simulator, evaluates payer-specific coverage rules against the submitted clinical context, and returns CDS Cards describing coverage guidance, documentation requirements, and prior authorization expectations.

**Payload contract reference:** `docs/spec/cds-hooks-api-contract.md`

---

## 2. Phase 1 Scope and Deliverables

| # | Deliverable |
|---|-------------|
| 1 | CDS Hooks discovery endpoint returning the `crd-order-sign` service metadata |
| 2 | CRD service endpoint accepting `order-sign` requests and returning CDS Cards |
| 3 | Colonoscopy rule engine evaluating high-risk vs. missing-documentation scenarios |
| 4 | Card factory producing well-formed CDS Cards from rule outcomes |
| 5 | Fixture JSON files for discovery metadata and card templates |
| 6 | `bun test` tests for the rule engine and both route handlers |

**Phase 1 acceptance criteria:**

- `GET /cds-services` returns HTTP 200 with a valid CDS Hooks discovery response listing the `crd-order-sign` service
- `POST /cds-services/crd-order-sign` with a valid payload returns HTTP 200 with at least one CDS Card
- High-risk path (Z80.0 present, prior procedure ≥ 5 years ago) returns an `info` card
- Missing-documentation path (Z80.0 absent) returns a `warning` card
- Unknown routes return HTTP 404
- All `bun test` tests pass
- End-to-end: clicking "Check Coverage Requirements" in the Python EHR renders CDS Cards in the browser

---

## 3. Technology Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| Language | TypeScript (strict mode) | Native to Bun; aligns well with FHIR schema complexity |
| Runtime | Bun | Built-in TypeScript execution, package manager, bundler, test runner |
| Framework | Hono | Lightweight, TypeScript-first, runtime-portable; no overhead |
| URL routing | Hono router | Built-in; no front controller pattern needed |
| Testing | `bun test` | Bun's built-in Jest-compatible test runner |
| Persistence | None (Phase 1) | Stateless rule evaluation |

---

## 4. Project Structure

```text
payer-crd/
├── src/
│   ├── index.ts                        # App entrypoint: Hono app definition + Bun.serve()
│   ├── routes/
│   │   ├── discovery.ts                # GET /cds-services
│   │   └── crd.ts                      # POST /cds-services/crd-order-sign
│   ├── rules/
│   │   └── colonoscopyRuleEngine.ts    # Payer rule evaluation logic
│   ├── cards/
│   │   └── cardFactory.ts             # Constructs CDS Card arrays from rule outcomes
│   └── types/
│       └── cdsHooks.ts                # TypeScript interfaces for CDS Hooks structures
├── fixtures/
│   ├── cds-discovery.json             # Discovery metadata returned by GET /cds-services
│   ├── cards-covered-high-risk.json   # Card template for the high-risk covered scenario
│   └── cards-missing-documentation.json # Card template for the missing documentation scenario
├── tests/
│   ├── rules/
│   │   └── colonoscopyRuleEngine.test.ts
│   └── routes/
│       ├── discovery.test.ts
│       └── crd.test.ts
├── .env                               # Local-only configuration, not committed
├── .env.example                       # Committed environment template
├── package.json                       # Bun package manifest
└── tsconfig.json                      # TypeScript compiler configuration
```

---

## 5. Environment Configuration

### 5.1 `.env.example`

| Key | Description |
|-----|-------------|
| `APP_ENV` | Runtime environment: `development` or `production` |
| `LOG_LEVEL` | Verbosity: `DEBUG`, `INFO`, `WARNING` |
| `PAYER_NAME` | Display name of the payer used in card source labels |
| `PAYER_BASE_URL` | Base URL of this service, e.g. `http://localhost:8080` |
| `PORT` | Listening port; default `8080` |

Bun natively loads `.env` files at startup via `Bun.env` — no manual loader required.

---

## 6. Development Workflow

```bash
# Install dependencies (first time)
cd payer-crd
bun install

# Start in development mode (file watching)
bun run dev

# Run all tests
bun test

# Run a single test file
bun test tests/rules/colonoscopyRuleEngine.test.ts
```

`package.json` scripts:

| Script | Command |
|--------|---------|
| `dev` | `bun run --watch src/index.ts` |
| `start` | `bun run src/index.ts` |
| `test` | `bun test` |

---

## 7. TypeScript Types (`src/types/cdsHooks.ts`)

Define all interfaces in a single file and export them. Import from this file in all other modules.

### 7.1 FHIR Supporting Types

```typescript
export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding: FhirCoding[];
  text?: string;
}

export interface FhirBundleEntry {
  resource: Record<string, unknown>;
}

export interface FhirBundle {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry: FhirBundleEntry[];
}
```

### 7.2 FHIR Resource Types

Only fields consumed by the rule engine need to be typed precisely; remaining fields can be `unknown`.

```typescript
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
```

### 7.3 CDS Hooks Request Types

```typescript
export interface CdsHooksContext {
  userId: string;
  patientId: string;
  encounterId?: string;
  draftOrders: FhirBundle;
}

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
```

### 7.4 CDS Hooks Response Types

```typescript
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
```

### 7.5 Rule Engine Types

```typescript
export type RuleOutcome =
  | 'covered-high-risk'
  | 'missing-documentation'
  | 'interval-not-met';

export interface RuleResult {
  highRiskIndicator: boolean;
  patientAge: number | null;
  yearsSincePriorProcedure: number | null;
  meetsIntervalRequirement: boolean;
  outcome: RuleOutcome;
}
```

---

## 8. Application Entry Point (`src/index.ts`)

Creates the Hono application, registers routes, and calls `Bun.serve()`.

Responsibilities:

- Instantiate a `Hono` app
- Register the discovery route from `src/routes/discovery.ts`
- Register the CRD route from `src/routes/crd.ts`
- Read `PORT` from `Bun.env` (default `8080`)
- Call `Bun.serve({ port, fetch: app.fetch })` to start the server
- Hono returns a 404 response automatically for unregistered routes — no manual 404 handler needed

The entry point should contain no business logic; all logic belongs in the route and rule modules it imports.

---

## 9. Route Handlers

### 9.1 `src/routes/discovery.ts` — `GET /cds-services`

Loads `fixtures/cds-discovery.json` and returns its contents as a JSON response with HTTP 200.

Implementation notes:

- Use `Bun.file()` to read the fixture: `const file = Bun.file('fixtures/cds-discovery.json')` then `await file.json()`
- Return via Hono's `c.json(data, 200)`
- The route does not inspect the request body or query parameters
- Export a Hono route handler that can be registered in `src/index.ts`

### 9.2 `src/routes/crd.ts` — `POST /cds-services/crd-order-sign`

Performs the end-to-end CRD request processing.

**Processing steps:**

1. Parse the JSON request body as `CdsHooksRequest`
2. Validate: return HTTP 400 if `hook` is absent, if `hook !== 'order-sign'`, or if `context` is absent
3. Extract FHIR resources from the prefetch:
   - `patient` from `body.prefetch?.patient`
   - `conditions` — unwrap entries: `body.prefetch?.conditions?.entry?.map(e => e.resource as FhirCondition) ?? []`
   - `procedures` — unwrap entries: `body.prefetch?.priorProcedures?.entry?.map(e => e.resource as FhirProcedure) ?? []`
   - `coverage` from `body.prefetch?.coverage`
4. Instantiate `ColonoscopyRuleEngine` with the rule config and call `evaluate()`
5. Call `buildCardsForOutcome()` with the `RuleResult`
6. Return HTTP 200 with `{ cards: [...] }`

Each extraction step returns an empty array or `undefined` rather than throwing when the prefetch key is absent, allowing the rule engine to handle missing data gracefully.

---

## 10. Rule Engine (`src/rules/colonoscopyRuleEngine.ts`)

### 10.1 Rule Configuration

Define a configuration object (inline constant or imported from a config module):

| Key | Type | Value | Description |
|-----|------|-------|-------------|
| `highRiskIntervalYears` | number | `5` | Minimum years between colonoscopies for high-risk patients |
| `averageRiskIntervalYears` | number | `10` | Minimum years between colonoscopies for average-risk patients |
| `colonoscopyCptCode` | string | `'45378'` | CPT code identifying a colonoscopy procedure |
| `highRiskIcd10Codes` | string[] | `['Z80.0']` | ICD-10-CM codes that qualify a patient as high-risk |

### 10.2 Exported Function

Export a single `evaluate` function (no class required, though a class is also acceptable):

```typescript
export function evaluate(
  patient: FhirPatient | undefined,
  conditions: FhirCondition[],
  procedures: FhirProcedure[],
  coverage: FhirCoverage | undefined
): RuleResult
```

### 10.3 Helper Functions

These may be exported for direct unit testing:

| Function | Signature | Description |
|----------|-----------|-------------|
| `hasHighRiskCondition` | `(conditions: FhirCondition[]) => boolean` | Returns `true` if any condition has a coding with system `http://hl7.org/fhir/sid/icd-10-cm` and code `Z80.0` |
| `calculateAge` | `(birthDate: string) => number` | Returns full years between the birth date and today |
| `findMostRecentProcedure` | `(procedures: FhirProcedure[], cptCode: string) => FhirProcedure \| null` | Filters by CPT code; returns the procedure with the most recent `performedDateTime`; returns `null` if none found |
| `yearsSince` | `(dateString: string) => number` | Returns the fractional years elapsed since the given ISO 8601 date |

### 10.4 Rule Logic

The `evaluate` function applies rules in this order:

1. `highRiskIndicator` ← `hasHighRiskCondition(conditions)`
2. `patientAge` ← `patient?.birthDate ? calculateAge(patient.birthDate) : null`
3. Find most recent prior procedure using `findMostRecentProcedure(procedures, colonoscopyCptCode)`
4. `yearsSincePriorProcedure` ← procedure found ? `yearsSince(procedure.performedDateTime!)` : `null`
5. `meetsIntervalRequirement`:
   - No prior procedure → `true`
   - `highRiskIndicator` true → `yearsSincePriorProcedure >= highRiskIntervalYears`
   - `highRiskIndicator` false → `yearsSincePriorProcedure >= averageRiskIntervalYears`
6. `outcome`:
   - `highRiskIndicator && meetsIntervalRequirement` → `'covered-high-risk'`
   - `!highRiskIndicator` → `'missing-documentation'`
   - `highRiskIndicator && !meetsIntervalRequirement` → `'interval-not-met'`

---

## 11. Card Factory (`src/cards/cardFactory.ts`)

### 11.1 Exported Function

```typescript
export async function buildCardsForOutcome(result: RuleResult): Promise<CdsCard[]>
```

Dispatches to the appropriate fixture based on `result.outcome`:

| Outcome | Fixture file | Card `indicator` |
|---------|-------------|-----------------|
| `'covered-high-risk'` | `fixtures/cards-covered-high-risk.json` | `info` |
| `'missing-documentation'` | `fixtures/cards-missing-documentation.json` | `warning` |
| `'interval-not-met'` | *(built inline; no fixture)* | `warning` |

For `covered-high-risk` and `missing-documentation`, read the fixture with `Bun.file(...).json()` and return its `cards` array.

For `interval-not-met`, build the card inline using `result.yearsSincePriorProcedure` to populate the summary text. This card is not pre-templatized because it contains a dynamic value.

The card factory returns only the inner array of card objects. The `{ "cards": [...] }` envelope is assembled by the CRD route handler.

---

## 12. Fixtures

Fixture files live in `payer-crd/fixtures/`. All three files must conform to the structures defined in `docs/spec/cds-hooks-api-contract.md`.

### 12.1 `fixtures/cds-discovery.json`

Contains the complete CDS Hooks discovery response. Top-level structure: `{ "services": [ { ... } ] }`.

The single service entry must include all fields from API contract Section 3.3. The `prefetch` object must declare all four keys (`patient`, `conditions`, `coverage`, `priorProcedures`) that the Python EHR populates.

### 12.2 `fixtures/cards-covered-high-risk.json`

Top-level structure: `{ "cards": [ { ... } ] }`. Card content must match API contract Section 6.1.

### 12.3 `fixtures/cards-missing-documentation.json`

Top-level structure: `{ "cards": [ { ... } ] }`. Card content must match API contract Section 6.2.

---

## 13. Testing

### 13.1 `tests/rules/colonoscopyRuleEngine.test.ts`

Pure unit tests — no HTTP, no file I/O. Pass FHIR resources as inline objects constructed within the test.

| Test | What it verifies |
|------|-----------------|
| Z80.0 code is detected as high-risk | `hasHighRiskCondition` returns `true` when Z80.0 is present |
| Non-matching code is not detected | `hasHighRiskCondition` returns `false` for other codes |
| Patient age is calculated correctly | `calculateAge` returns the correct integer for a known birth date |
| Most recent prior procedure is selected | `findMostRecentProcedure` returns the newest when multiple are present |
| No qualifying procedure returns null | `findMostRecentProcedure` returns `null` when none match the CPT code |
| `evaluate` returns `covered-high-risk` for the demo scenario | High-risk patient, Z80.0 present, prior procedure 5+ years ago |
| `evaluate` returns `missing-documentation` when Z80.0 is absent | No high-risk condition code in conditions array |
| `evaluate` returns `interval-not-met` when interval not satisfied | High-risk patient, prior procedure less than 5 years ago |

### 13.2 `tests/routes/discovery.test.ts`

| Test | What it verifies |
|------|-----------------|
| `GET /cds-services` returns HTTP 200 | Status code |
| Response `Content-Type` is `application/json` | Content type header |
| Response body contains `services` array | Discovery envelope structure |
| `services[0].hook` is `order-sign` | Correct hook declared |
| `services[0].id` is `crd-order-sign` | Correct service id |
| `services[0].prefetch` contains `patient`, `conditions`, `coverage`, `priorProcedures` | Prefetch template declared |

### 13.3 `tests/routes/crd.test.ts`

Use Hono's built-in test helper (`app.request()`) to call the route without starting a real HTTP server. Construct minimal FHIR payloads inline.

| Test | What it verifies |
|------|-----------------|
| Valid request with Z80.0 returns HTTP 200 with `info` card | High-risk covered path |
| Valid request without Z80.0 returns HTTP 200 with `warning` card | Missing-documentation path |
| Request missing `hook` field returns HTTP 400 | Validation rejects malformed request |
| Request with `hook !== 'order-sign'` returns HTTP 400 | Validation rejects wrong hook type |
| Request missing `context` returns HTTP 400 | Validation rejects missing context |
| Response body has `cards` key | Response envelope is correct |

---

## 14. Build Sequence

Follow this order when implementing Phase 1. Each step has a verifiable outcome before proceeding.

| Step | Task | Verify | Status |
|------|------|--------|--------|
| 1 | Create directory structure as shown in Section 4; initialize `package.json` and `tsconfig.json` | `bun install` succeeds | Not started |
| 2 | Update `.env` and create `.env.example` with keys from Section 5.1 | `.env` has `PORT=8080` and `APP_ENV=development` | Partial — `.env` exists; keys need review |
| 3 | Define TypeScript interfaces in `src/types/cdsHooks.ts` per Section 7 | File compiles without error when imported in a minimal `src/index.ts` | Not started |
| 4 | Scaffold `src/index.ts` with a minimal Hono app and `Bun.serve()` | `bun run dev` starts; `curl http://localhost:8080` returns any response | Not started |
| 5 | Create `fixtures/cds-discovery.json` matching API contract Section 3.3 | File is valid JSON; all required fields are present | Not started |
| 6 | Implement `src/routes/discovery.ts` and register it in `src/index.ts` | `curl http://localhost:8080/cds-services` returns the discovery JSON | Not started |
| 7 | Verify unknown routes return HTTP 404 | `curl -i http://localhost:8080/unknown` returns `404` | Not started |
| 8 | Write and run `tests/routes/discovery.test.ts` | `bun test` passes | Not started |
| 9 | Implement `src/rules/colonoscopyRuleEngine.ts` per Section 10 | TypeScript compiles; `evaluate()` can be called from a test file | Not started |
| 10 | Write and run `tests/rules/colonoscopyRuleEngine.test.ts` | `bun test` passes all rule engine tests | Not started |
| 11 | Create `fixtures/cards-covered-high-risk.json` and `fixtures/cards-missing-documentation.json` per API contract Sections 6.1 and 6.2 | Files are valid JSON; card fields are present and correct | Not started |
| 12 | Implement `src/cards/cardFactory.ts` per Section 11 | `buildCardsForOutcome()` returns the correct card array for each outcome | Not started |
| 13 | Implement `src/routes/crd.ts` and register it in `src/index.ts` per Section 9.2 | `curl -X POST -H 'Content-Type: application/json' -d '{...}' http://localhost:8080/cds-services/crd-order-sign` returns CDS Cards | Not started |
| 14 | Write and run `tests/routes/crd.test.ts` | `bun test` passes all CRD route tests | Not started |
| 15 | Run full `bun test` suite | All tests pass | Not started |
| 16 | Perform end-to-end test with the Python EHR | Clicking "Check Coverage Requirements" in the browser produces CDS Cards | Not started |
