# Payer CRD Service — Developer Guide

This guide walks through the complete implementation of the Bun + Hono Payer CRD Service from start to finish. Every section is self-contained: background is provided inline, and all code is copy-paste ready with full comments. Work through the sections in order without needing to consult any other document.

Each section is labelled with a status:

- **[COMPLETE]** — the file already exists; read it and understand it before moving on
- **[CREATE]** — you will create this file by following the steps in the section
- **[UPDATE]** — the file exists but needs additional code added to it

---

## Table of Contents

1. Background and Architecture
2. Project Configuration
3. TypeScript Types
4. Application Entry Point
5. CDS Hooks Discovery Endpoint
6. Colonoscopy Rule Engine
7. Card Response Fixtures
8. Card Factory
9. CRD Route Handler
10. Testing
11. End-to-End Verification

---

## Section 1 — Background and Architecture

### 1.1 What This Service Does

The Payer CRD Service simulates a health insurance payer's server in a Coverage Requirements Discovery (CRD) workflow. "CRD" is an industry standard that lets a clinician's EHR software ask a payer — in real time, while the clinician is writing an order — whether the order is covered, whether prior authorization is required, and what documentation needs to be attached.

In this demo, a clinician writes a colonoscopy order for a patient who has a documented family history of colorectal cancer. Before the order is signed, the EHR sends a request to the payer asking: "Does this order meet your coverage requirements?" The payer evaluates its rules and sends back a structured response — a CDS Card — that the EHR displays inline.

### 1.2 The CDS Hooks Protocol

CDS Hooks is a lightweight HTTP-based protocol for clinical decision support. It defines a small set of standard events ("hooks") that an EHR fires at specific workflow moments. A server listening for those hooks evaluates the incoming clinical context and returns Cards — structured messages the EHR can display to the clinician.

The hook used in this demo is `order-sign`, which fires when a clinician is about to sign a draft order. The EHR sends the clinical context as a JSON POST request; the payer evaluates it and responds with an array of Cards.

**The two CDS Hooks endpoints this service implements:**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/cds-services` | Discovery — advertises what hooks this payer supports |
| `POST` | `/cds-services/crd-order-sign` | CRD — receives an order-sign request and returns Cards |

**Discovery** is how an EHR learns what a payer offers. The EHR calls `GET /cds-services` and receives a JSON document listing each available service, the hook it responds to, and a `prefetch` template declaring which FHIR resources the payer wants pre-loaded in the request.

**The CRD service call** is the main event. The EHR assembles a JSON body containing the clinical context (who the patient is, what order is being drafted, what conditions the patient has, what prior procedures are on record, and what insurance coverage is active) and POSTs it to the payer. The payer evaluates its rules and returns one or more Cards.

### 1.3 CDS Cards

A Card is the unit of communication from payer to EHR. Each card has:

- `summary` — a short (≤ 140 character) plain-text title
- `indicator` — urgency level: `info`, `warning`, or `critical`
- `source` — identifies the payer
- `detail` — optional extended explanation (supports Markdown)
- `links` — optional external URLs (e.g., a documentation checklist)

This service produces two types of cards:

| Scenario | Indicator | Meaning |
|----------|-----------|---------|
| Z80.0 condition present, prior procedure ≥ 5 years ago | `info` | Order appears covered; high-risk interval confirmed |
| Z80.0 condition absent | `warning` | Missing documentation; high-risk classification not confirmed |
| Z80.0 present, prior procedure < 5 years ago | `warning` | Prior colonoscopy too recent for the 5-year high-risk interval |

### 1.4 FHIR Resources

FHIR (Fast Healthcare Interoperability Resources) is the data standard used to represent clinical information. Every FHIR resource is a JSON object with a `resourceType` field that identifies its type. The resources involved in this demo:

**Patient** — the person receiving care. Used by the rule engine to calculate patient age.

**Condition** — a clinical condition or diagnosis. The rule engine looks for ICD-10-CM code `Z80.0` (Family history of malignant neoplasm of digestive organs) to identify high-risk patients.

**ServiceRequest** — the draft colonoscopy order. Carried in the request `context.draftOrders` bundle. CPT code `45378` identifies it as a colonoscopy.

**Procedure** — a completed prior colonoscopy. The rule engine checks the `performedDateTime` to determine whether the required screening interval has elapsed.

**Coverage** — the patient's active insurance. Minimal in Phase 1; reserved for plan-specific rule extensions in later phases.

**Bundle** — a container for multiple FHIR resources. `conditions` and `priorProcedures` are sent as Bundles containing one or more entries. Each entry wraps a resource in a `{ "resource": { ... } }` envelope.

**Clinical codes used in this demo:**

| Standard | Code | Meaning |
|----------|------|---------|
| ICD-10-CM | `Z80.0` | Family history of malignant neoplasm of digestive organs |
| CPT | `45378` | Colonoscopy, flexible, proximal to splenic flexure; diagnostic |

<br><br>

### 1.5 The CDS Hooks Request Payload

The EHR sends a JSON body like the following when the clinician clicks "Check Coverage Requirements":

```json
{
  "hook": "order-sign",
  "hookInstance": "a-uuid-identifying-this-call",
  "fhirServer": "http://localhost:8000/fhir",
  "context": {
    "userId": "PractitionerRole/demo-clinician",
    "patientId": "demo-patient-001",
    "encounterId": "demo-encounter-001",
    "draftOrders": {
      "resourceType": "Bundle",
      "type": "collection",
      "entry": [
        { "resource": { "resourceType": "ServiceRequest", "code": { "coding": [{ "system": "http://www.ama-assn.org/go/cpt", "code": "45378" }] } } }
      ]
    }
  },
  "prefetch": {
    "patient": {
      "resourceType": "Patient",
      "id": "demo-patient-001",
      "birthDate": "1971-01-15",
      "gender": "male"
    },
    "conditions": {
      "resourceType": "Bundle",
      "type": "searchset",
      "entry": [
        { "resource": { "resourceType": "Condition", "code": { "coding": [{ "system": "http://hl7.org/fhir/sid/icd-10-cm", "code": "Z80.0" }] } } }
      ]
    },
    "priorProcedures": {
      "resourceType": "Bundle",
      "type": "searchset",
      "entry": [
        { "resource": { "resourceType": "Procedure", "status": "completed", "code": { "coding": [{ "system": "http://www.ama-assn.org/go/cpt", "code": "45378" }] }, "performedDateTime": "2021-01-15" } }
      ]
    },
    "coverage": {
      "resourceType": "Coverage",
      "id": "demo-coverage-001",
      "status": "active"
    }
  }
}
```

The `prefetch` keys (`patient`, `conditions`, `coverage`, `priorProcedures`) match the template declared in the discovery response. In a production system the EHR would query a live FHIR server to populate these. In this demo the EHR uses static fixture files.

### 1.6 Technology Stack

| Component | Choice | Python equivalent |
|-----------|--------|------------------|
| Runtime | Bun | CPython |
| Language | TypeScript (strict) | Python with mypy |
| Web framework | Hono | FastAPI |
| Package manager | `bun install` | `pip install` |
| Test runner | `bun test` | `pytest` |
| File I/O | `Bun.file()` | `open()` / `aiofiles` |
| Env vars | `Bun.env.*` | `os.environ` / `python-dotenv` |

**Hono** is a minimal TypeScript web framework similar in spirit to FastAPI. You create an app, register route handlers, and pass `app.fetch` to `Bun.serve()`. Each handler receives a `Context` object (`c`) that provides access to the incoming request and response-building helpers.

### 1.7 Two-Application Architecture

```
Python EHR (port 8000)             Bun Payer CRD (port 8080)
──────────────────────             ─────────────────────────
Clinician clicks button
FHIR context assembled
CDS Hooks request built ──POST /cds-services/crd-order-sign──►
                                   Validate request body
                                   Extract FHIR resources
                                   Evaluate payer rules
                                   Build CDS Cards
CDS Cards rendered      ◄────────── { "cards": [...] } ──────
```

The two services communicate only over HTTP. Neither calls internal functions of the other. Both can be started and stopped independently.

---

<br><br><br><br><br><br>
<br><br>

## Section 2 — Project Configuration

### 2.1 Directory Structure

```
payer-crd/
├── src/
│   ├── index.ts                          [COMPLETE] App entry point
│   ├── routes/
│   │   ├── discovery.ts                  [COMPLETE] GET /cds-services
│   │   └── crd.ts                        [CREATE]   POST /cds-services/crd-order-sign
│   ├── rules/
│   │   └── colonoscopyRuleEngine.ts      [UPDATE]   Rule evaluation logic
│   ├── cards/
│   │   └── cardFactory.ts                [CREATE]   Builds CDS Card arrays
│   └── types/
│       └── cdsHooks.ts                   [COMPLETE] TypeScript interfaces
├── fixtures/
│   ├── cds-discovery.json                [COMPLETE] Discovery endpoint response
│   ├── cards-covered-high-risk.json      [CREATE]   Info card template
│   └── cards-missing-documentation.json  [CREATE]   Warning card template
├── tests/
│   ├── rules/
│   │   └── colonoscopyRuleEngine.test.ts [CREATE]
│   └── routes/
│       ├── discovery.test.ts             [CREATE]
│       └── crd.test.ts                   [CREATE]
├── .env                                  [COMPLETE] Local config (not committed)
├── .env.example                          [CREATE]   Committed template
├── package.json                          [COMPLETE]
└── tsconfig.json                         [COMPLETE]
```

### 2.2 `package.json` [COMPLETE]

`package.json` is Bun's (and Node.js's) project manifest — roughly the equivalent of Python's `pyproject.toml` combined with `requirements.txt`. It identifies the project, lists its dependencies, and defines named scripts you run with `bun run <name>`. Before reading the file, focus on three areas: the `scripts` block (the commands available to you), `dependencies` (packages the app needs at runtime), and `devDependencies` (packages used during development and testing but not shipped with the app).

<br><br><br><br><br><br>


```json
{
  "name": "payer-crd",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^6.0.3"
  },
  "dependencies": {
    "hono": "^4.12.23"
  }
}
```

`"type": "module"` tells Bun (and Node) to treat all `.ts`/`.js` files as ES Modules. This means imports use `import`/`export` syntax rather than `require()`/`module.exports`. ES Modules are the modern standard.

The `dev` script uses `--watch` to automatically restart the server whenever a source file changes — the Bun equivalent of `uvicorn --reload`.

### 2.3 `tsconfig.json` [COMPLETE]

`tsconfig.json` is the TypeScript compiler configuration file. It controls how the TypeScript type checker and language server interpret your source code — analogous to a `mypy.ini` or `[tool.mypy]` section in `pyproject.toml` for Python projects. Bun reads this file at startup to understand the project's module resolution rules and strictness settings. Most settings here are about *how strictly* TypeScript enforces types. This project uses the strictest available settings, so TypeScript will catch more potential bugs — but the code has to be more explicit about handling `null`, `undefined`, and untyped values.

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

Key settings:

- `strict: true` — enables all strict type checks. Equivalent to running mypy with `--strict`. TypeScript will flag missing type annotations, possible nulls, and implicit `any` types.
- `noUncheckedIndexedAccess: true` — accessing an array by index (e.g., `arr[0]`) returns `T | undefined` instead of `T`. This forces you to handle the case where the array might be empty. Use optional chaining (`arr[0]?.property`) or null checks when accessing by index.
- `moduleResolution: "bundler"` — tells TypeScript how to resolve module paths, matching Bun's behavior. Imports may omit or include the `.js` extension; this project uses `.js` for consistency.
- `types: ["bun-types"]` — loads Bun's global type definitions, making `Bun.file()`, `Bun.env`, `Bun.serve()`, etc. available without separate imports.

### 2.4 `.env` [COMPLETE]

The `.env` file holds local configuration. Bun loads it automatically at startup — no `dotenv` package required. Access values via `Bun.env.KEY_NAME`.

```
APP_ENV=development
LOG_LEVEL=DEBUG
PAYER_NAME=Demo Payer CRD Service
PAYER_BASE_URL=http://localhost:8080
PORT=8080
```

### 2.5 `.env.example` [CREATE]

`.env.example` is a committed template that documents every required environment variable without real values. New developers copy it to `.env` and fill in their local values.

Create `payer-crd/.env.example` with:

```
# -----------------------------------------------------------
# payer-crd environment configuration
# Copy this file to .env and fill in values for your environment.
# .env is listed in .gitignore and must never be committed.
# -----------------------------------------------------------

# Runtime environment: development | production
APP_ENV=development

# Log verbosity: DEBUG | INFO | WARNING
LOG_LEVEL=DEBUG

# Display name of this payer service, used in CDS Card source labels
PAYER_NAME=Demo Payer CRD Service

# Base URL of this service — used to build absolute links in CDS Cards
PAYER_BASE_URL=http://localhost:8080

# HTTP port this server listens on
PORT=8080
```

### 2.6 Install Dependencies

From the `payer-crd/` directory:

```bash
bun install
```

This reads `package.json` and installs `hono` and dev dependencies into `node_modules/`. You only need to run this once (or again after changing `package.json`).

**Verify the setup:**

```bash
bun run dev
```

You should see: `Payer CRD listening on port 8080`

Press `Ctrl+C` to stop.

---

## Section 3 — TypeScript Types [COMPLETE]

### 3.1 Purpose of a Central Types File

`src/types/cdsHooks.ts` defines all TypeScript interfaces for this project in one place. Every other module imports from here. This approach:

- Prevents type definitions from scattering across files
- Makes the data contract visible in one readable document
- Lets TypeScript catch mismatches between what the route handler extracts and what the rule engine expects

A TypeScript `interface` is a compile-time contract that describes the shape of a JavaScript object. It does not exist at runtime — it is erased during compilation. Think of it as a Python dataclass that is only used by the type checker and never instantiated.

```typescript
// TypeScript interface
interface FhirCoding {
  system: string;
  code: string;
  display?: string;   // ? means optional — the field may be absent
}

// Python dataclass equivalent
@dataclass
class FhirCoding:
    system: str
    code: str
    display: Optional[str] = None
```

### 3.2 Full Annotated File: `src/types/cdsHooks.ts`

```typescript
// All interfaces are named exports. Import them with:
//   import type { CdsHooksRequest, CdsCard } from '../types/cdsHooks.js';
// "import type" tells TypeScript this import is only used for type-checking —
// it produces zero runtime code.

// -- FHIR Supporting Types ------------------------------------------------

// FhirCoding is the inner object in FHIR's two-level code structure.
// system identifies the coding standard (ICD-10-CM, CPT, SNOMED, etc.)
// code is the actual code value within that system.
export interface FhirCoding {
  system: string;
  code: string;
  display?: string;   // human-readable label; optional in the FHIR spec
}

// FhirCodeableConcept is the outer wrapper used on most coded fields.
// A single concept can carry codes from multiple systems simultaneously
// (e.g., both ICD-10-CM and SNOMED-CT). The rule engine reads coding[0]
// or iterates all entries with .some() to find a matching code.
export interface FhirCodeableConcept {
  coding: FhirCoding[];
  text?: string;      // free-text fallback when no standard code applies
}

// FhirBundleEntry wraps a single FHIR resource inside a Bundle.
// resource is typed as Record<string, unknown> — a generic key/value map —
// because a Bundle can contain any FHIR resource type. The route handler
// narrows the type with a cast (e.g., e.resource as FhirCondition) after
// unwrapping entries.
export interface FhirBundleEntry {
  resource: Record<string, unknown>;
}

// FhirBundle is the FHIR container for multiple resources.
// resourceType uses a string literal type: TypeScript will reject any value
// other than the exact string 'Bundle', catching accidental substitutions.
export interface FhirBundle {
  resourceType: 'Bundle';
  type: string;       // 'collection' for draftOrders; 'searchset' for prefetch
  total?: number;     // required for searchset bundles; count of matches
  entry: FhirBundleEntry[];
}

// -- FHIR Resource Types --------------------------------------------------
// Only fields consumed by the rule engine are typed precisely. All other
// fields on these resources are intentionally omitted — TypeScript's
// structural typing means an object with extra fields still satisfies
// the interface, so omitting unused fields keeps the types lean.

export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  birthDate?: string;   // ISO 8601: 'YYYY-MM-DD'; used to calculate age
  gender?: string;
  name?: Array<{ family?: string; given?: string[] }>;
}

export interface FhirCondition {
  resourceType: 'Condition';
  id: string;
  code?: FhirCodeableConcept;           // ICD-10-CM code lives here
  clinicalStatus?: FhirCodeableConcept; // e.g., 'active'
}

export interface FhirProcedure {
  resourceType: 'Procedure';
  id: string;
  status: string;                       // 'completed' for prior procedures
  code?: FhirCodeableConcept;           // CPT code lives here
  performedDateTime?: string;           // ISO 8601 date; used for interval math
}

export interface FhirCoverage {
  resourceType: 'Coverage';
  id: string;
  status: string;                       // 'active'
}

// -- CDS Hooks Request Types ----------------------------------------------

// CdsHooksContext carries the workflow-specific clinical context for
// the order-sign hook: who the patient is, who the clinician is, and
// what orders are being signed.
export interface CdsHooksContext {
  userId: string;           // FHIR reference, e.g. 'PractitionerRole/demo-clinician'
  patientId: string;        // FHIR Patient logical id
  encounterId?: string;     // optional FHIR Encounter id
  draftOrders: FhirBundle;  // collection Bundle containing the ServiceRequest(s)
}

// CdsHooksPrefetch carries pre-fetched FHIR resources the EHR provides
// so the payer does not need to query a FHIR server itself.
// All keys are optional — the CDS Hooks spec does not guarantee that
// every declared prefetch key will be populated in every request.
export interface CdsHooksPrefetch {
  patient?: FhirPatient;
  conditions?: FhirBundle;        // searchset Bundle of active Conditions
  coverage?: FhirCoverage;
  priorProcedures?: FhirBundle;   // searchset Bundle of completed Procedures
}

export interface CdsHooksRequest {
  hook: string;             // must be 'order-sign' for this service
  hookInstance: string;     // UUID identifying this specific invocation
  fhirServer?: string;      // base URL of the EHR FHIR server (not used in Phase 1)
  context: CdsHooksContext;
  prefetch?: CdsHooksPrefetch;
}

// -- CDS Hooks Response Types ---------------------------------------------

export interface CdsSource {
  label: string;    // display name of the payer
  url?: string;     // URL to the payer service or organization
}

export interface CdsLink {
  label: string;
  url: string;
  // 'smart' initiates an OAuth SMART app launch; 'absolute' is a plain URL.
  // Phase 1 uses 'absolute' only.
  type: 'absolute' | 'smart';
}

export interface CdsCard {
  summary: string;                          // ≤ 140 characters
  indicator: 'info' | 'warning' | 'critical';
  source: CdsSource;
  detail?: string;                          // extended Markdown explanation
  links?: CdsLink[];                        // external URLs
}

// CdsHooksResponse is the top-level response envelope.
export interface CdsHooksResponse {
  cards: CdsCard[];
}

// -- Rule Engine Types ----------------------------------------------------

// RuleOutcome is a union type — a variable of this type can only hold
// one of these three exact string values. TypeScript will reject any other
// string. This is analogous to Python's Literal type:
//   RuleOutcome = Literal['covered-high-risk', 'missing-documentation', 'interval-not-met']
export type RuleOutcome =
  | 'covered-high-risk'
  | 'missing-documentation'
  | 'interval-not-met';

// RuleResult is what the rule engine returns after evaluating the clinical
// context. The card factory reads this to decide which card(s) to build.
export interface RuleResult {
  highRiskIndicator: boolean;
  // null (not undefined) signals that the calculation was attempted but
  // the required input data was absent from the prefetch. null is an
  // intentional "unknown" value; undefined would mean the field was
  // never considered.
  patientAge: number | null;
  yearsSincePriorProcedure: number | null;
  meetsIntervalRequirement: boolean;
  outcome: RuleOutcome;
}
```

---

## Section 4 — Application Entry Point [COMPLETE]

### 4.1 How Hono Works

Hono follows the same request-routing model as FastAPI or Flask. You:

1. Create an app instance: `const app = new Hono()`
2. Register route handlers: `app.get('/path', handlerFn)`
3. Start the server: `Bun.serve({ port, fetch: app.fetch })`

When a request arrives, Hono matches its method and path against registered routes, calls the matching handler with a `Context` object, and sends the handler's returned `Response` back to the client. Routes that do not match any registration automatically receive a `404 Not Found` response.

The `app.fetch` property is a standard Web Fetch API handler with the signature `(Request) => Response | Promise<Response>`. `Bun.serve` accepts this interface directly, making Hono compatible with Bun's native HTTP server without any adapter layer.

### 4.2 Full Annotated File: `src/index.ts`

The current file registers only the discovery route. In Section 9 you will add the CRD route import and registration.

```typescript
// Application entrypoint: creates the Hono app, registers routes,
// and starts the server with Bun.serve().
//
// Run from the payer-crd/ directory:
//   bun run dev          — starts with file watching (auto-restart on change)
//   bun run start        — starts without file watching
//
// Routes:
//   GET  /cds-services                —> src/routes/discovery.ts
//   POST /cds-services/crd-order-sign —> src/routes/crd.ts  (added in Section 9)

import { Hono } from 'hono';
import { discoveryHandler } from './routes/discovery.js';
// import { crdHandler } from './routes/crd.js';   <-- added in Section 9

const app = new Hono();

// app.get registers a handler for HTTP GET requests at the given path.
// discoveryHandler is a function defined in routes/discovery.ts that
// Hono will call with a Context object when a matching request arrives.
app.get('/cds-services', discoveryHandler);
// app.post('/cds-services/crd-order-sign', crdHandler);  <-- added in Section 9

// Bun.env is the Bun equivalent of process.env (Node) or os.environ (Python).
// It reads from the .env file automatically. Number() converts the string
// value '8080' to the integer 8080. || 8080 is the fallback if PORT is unset.
const port = Number(Bun.env.PORT) || 8080;

// Bun.serve starts the HTTP server. fetch is a Web Fetch API handler;
// Hono's app.fetch property satisfies that interface.
Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Payer CRD listening on port ${port}`);
```

---

<br><br><br><br><br><br>
<br><br><br><br><br><br>
<br><br><br><br><br><br>
<br>

## Section 5 — CDS Hooks Discovery Endpoint [COMPLETE]

### 5.1 What Discovery Does

The discovery endpoint is how an EHR learns what services a payer offers. The EHR calls `GET /cds-services` once at startup (or on demand) and receives a JSON document listing every CDS service the payer provides. Each entry declares:

- The `hook` type it responds to (e.g., `order-sign`)
- A unique `id` identifying this specific service
- An optional `prefetch` template declaring which FHIR resources it wants the EHR to pre-load and include in every hook call

The `prefetch` templates use `{{context.patientId}}` as a placeholder. In a production system the EHR substitutes the real patient ID and queries a FHIR server. In this demo the EHR uses static fixture files instead.

### 5.2 `fixtures/cds-discovery.json` [COMPLETE]

```json
{
  "services": [
    {
      "hook": "order-sign",
      "id": "crd-order-sign",
      "title": "CRD Coverage Requirements Discovery",
      "description": "Evaluates coverage requirements and prior authorization expectations for draft orders",
      "prefetch": {
        "patient": "Patient/{{context.patientId}}",
        "conditions": "Condition?patient={{context.patientId}}&clinical-status=active",
        "coverage": "Coverage?patient={{context.patientId}}&status=active",
        "priorProcedures": "Procedure?patient={{context.patientId}}&status=completed"
      }
    }
  ]
}
```

The top-level `services` array can contain multiple entries for a payer that supports multiple hooks. This payer exposes exactly one service for Phase 1.

### 5.3 `src/routes/discovery.ts` [COMPLETE]

```typescript
// Handler for GET /cds-services — the CDS Hooks discovery endpoint.
// Reads the fixture file and returns its contents verbatim.
// No request body is parsed; no query parameters are read.

import type { Context } from 'hono';

// discoveryHandler is exported so src/index.ts can import and register it.
// The function signature matches Hono's route handler type:
//   (c: Context) => Response | Promise<Response>
export async function discoveryHandler(c: Context): Promise<Response> {
  // Bun.file() returns a lazy BunFile handle — no I/O happens yet.
  // .json() reads and parses the file asynchronously, returning Promise<unknown>.
  // await suspends this function until the read completes.
  // Path is relative to the process working directory (payer-crd/), not
  // to this source file's location.
  const data = await Bun.file('fixtures/cds-discovery.json').json();

  // c.json() serializes data to JSON, sets Content-Type: application/json,
  // and returns a Response with HTTP status 200.
  return c.json(data, 200);
}
```

### 5.4 Verify the Discovery Endpoint

Start the service:

```bash
bun run dev
```

In a separate terminal, call the endpoint:

```bash
curl http://localhost:8080/cds-services
```

Expected response:

```json
{
  "services": [
    {
      "hook": "order-sign",
      "id": "crd-order-sign",
      ...
    }
  ]
}
```

Verify a 404 for an unknown path:

```bash
curl -i http://localhost:8080/unknown-path
```

Expected: `HTTP/1.1 404 Not Found`

---

## Section 6 — Colonoscopy Rule Engine [UPDATE]

### 6.1 What a Rule Engine Is

A rule engine is a module that takes data as input, applies a set of conditional business rules, and returns a structured decision. In this service the "business rules" are the payer's coverage policies. The clinical data — patient, conditions, procedures, coverage — flows in; a `RuleResult` object flows out.

Separating the rule engine from the route handler is a design choice that mirrors the separation between a FastAPI route function and the business logic it calls. The route handler deals with HTTP concerns (parsing the request body, returning the response); the rule engine deals only with clinical logic (is the patient high-risk? has enough time elapsed?).

This separation also makes the rule engine easy to unit test in isolation: you pass in plain data objects and check the output, with no HTTP involved.

### 6.2 Rule Configuration

A configuration object at the top of the file holds all numeric thresholds and clinical codes. Centralizing these values means you can change a policy (e.g., update the high-risk interval from 5 years to 3 years) by editing one line rather than hunting through the code.

```typescript
const RULE_CONFIG = {
  highRiskIntervalYears: 5,          // minimum years between colonoscopies for high-risk patients
  averageRiskIntervalYears: 10,      // minimum years for average-risk patients
  colonoscopyCptCode: '45378',       // CPT code identifying a colonoscopy
  highRiskIcd10Codes: ['Z80.0'],     // ICD-10-CM codes that qualify a patient as high-risk
} as const;
```

`as const` is a TypeScript assertion that freezes the object. All values become read-only literal types: `highRiskIntervalYears` is typed as the literal `5`, not as the general `number`. This prevents accidental mutation and enables tighter type inference.

### 6.3 Helper Functions

Each helper function performs one focused calculation. They are exported so they can be tested independently without going through `evaluate()`.

**`hasHighRiskCondition`** — searches the conditions array for a Z80.0 code.

The function uses `.some()`, which is JavaScript's equivalent of Python's `any()`. It returns `true` as soon as one matching element is found, short-circuiting the loop.

```
conditions.some(condition =>
  condition.code?.coding.some(coding =>
    coding.system === ICD10_SYSTEM && codes.includes(coding.code)
  ) ?? false
)
```

The `?.` is optional chaining — if `condition.code` is `undefined`, the expression short-circuits to `undefined` rather than throwing. The `?? false` converts that `undefined` to `false` (the nullish coalescing operator).

**`calculateAge`** — computes full years elapsed since a birth date.

Date arithmetic in JavaScript works with the `Date` object. The standard approach subtracts years, then adjusts by one if the birthday has not yet occurred this calendar year.

**`findMostRecentProcedure`** — finds the most recent prior colonoscopy.

Filters the procedures array to those matching the CPT code, then uses `.reduce()` to find the one with the latest `performedDateTime`. Returns `null` (not `undefined`) when no match is found — `null` explicitly signals "not found", whereas `undefined` means "field was never set".

**`yearsSince`** — converts a date string to fractional years elapsed.

JavaScript's `Date` stores time as milliseconds since the Unix epoch (January 1, 1970). Subtracting two `Date` values gives milliseconds; dividing by milliseconds-per-year gives fractional years. Using 365.25 days/year accounts for leap years.

### 6.4 The `evaluate` Function

`evaluate` orchestrates the helpers and applies the payer's decision logic:

```
Step 1: Is the patient high-risk?
  → hasHighRiskCondition(conditions)

Step 2: What is the patient's age?
  → calculateAge(patient.birthDate)  [or null if birthDate absent]

Step 3: Find the most recent prior colonoscopy
  → findMostRecentProcedure(procedures, CPT_45378)

Step 4: How many years since the prior procedure?
  → yearsSince(procedure.performedDateTime)  [or null if no prior procedure]

Step 5: Does the new order meet the interval requirement?
  → no prior procedure:           true  (first-time screening always covered)
  → high-risk patient:            yearsSince >= 5
  → average-risk patient:         yearsSince >= 10

Step 6: Determine outcome
  → high-risk AND interval met:   'covered-high-risk'
  → NOT high-risk:                'missing-documentation'
  → high-risk AND interval NOT met: 'interval-not-met'
```

### 6.5 Full Implementation: `src/rules/colonoscopyRuleEngine.ts`

Replace the contents of this file entirely:

```typescript
// --------------------------------------------------------------------------
// payer-crd/src/rules/colonoscopyRuleEngine.ts
// --------------------------------------------------------------------------
// Evaluates payer coverage rules against a patient's clinical context and
// returns a structured RuleResult describing the coverage decision.
//
// All exported functions accept plain data objects and return plain values —
// no HTTP, no file I/O, no side effects. This makes the module straightforward
// to unit test in isolation.
// --------------------------------------------------------------------------

import type {
  FhirPatient,
  FhirCondition,
  FhirProcedure,
  FhirCoverage,
  RuleResult,
  RuleOutcome,
} from '../types/cdsHooks.js';

// Rule configuration — all payer policy thresholds and clinical codes in one place.
// 'as const' makes every value a read-only literal type, preventing mutation.
const RULE_CONFIG = {
  highRiskIntervalYears: 5,
  averageRiskIntervalYears: 10,
  colonoscopyCptCode: '45378',
  highRiskIcd10Codes: ['Z80.0'],
} as const;

// ICD-10-CM system URI — the standard identifier for this coding system.
const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';

// CPT system URI — the standard identifier for CPT procedure codes.
const CPT_SYSTEM = 'http://www.ama-assn.org/go/cpt';

// --------------------------------------------------------------------------
// Helper: hasHighRiskCondition
// --------------------------------------------------------------------------
// Returns true if any condition in the array carries an ICD-10-CM code that
// qualifies the patient as high-risk for colorectal cancer screening.
//
// .some() is JavaScript's equivalent of Python's any() — it short-circuits
// and returns true as soon as one matching element is found.
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
```

---

## Section 7 — Card Response Fixtures [CREATE]

### 7.1 CDS Card Structure Recap

Every CDS Card the payer returns must conform to this shape:

```
{
  "summary":   string  (≤ 140 chars, required)
  "indicator": "info" | "warning" | "critical"  (required)
  "source": {
    "label": string  (required)
    "url":   string  (optional)
  }
  "detail":  string  (optional, Markdown supported)
  "links": [         (optional)
    {
      "label": string  (required)
      "url":   string  (required)
      "type":  "absolute" | "smart"  (required)
    }
  ]
}
```

The fixtures store pre-authored cards for the two static scenarios. A third scenario (`interval-not-met`) is built inline in the card factory because it contains a dynamic value (the number of years since the prior procedure).

### 7.2 `fixtures/cards-covered-high-risk.json` [CREATE]

```json
{
  "cards": [
    {
      "summary": "High-risk family history supports 5-year colonoscopy screening interval",
      "indicator": "info",
      "source": {
        "label": "Demo Payer CRD Service",
        "url": "http://localhost:8080"
      },
      "detail": "## Coverage: High-Risk Screening Interval Confirmed\n\n**ICD-10-CM Z80.0** (Family history of malignant neoplasm of digestive organs) qualifies this patient for a **5-year surveillance interval** under this payer's coverage policy.\n\n### What this means\n\n- The prior procedure date satisfies the 5-year interval requirement\n- This order **appears covered** without prior authorization\n- No additional documentation is required at this time\n\n### Policy basis\n\nPatients with a documented family history of colorectal cancer (Z80.0) are classified as high-risk and qualify for colonoscopy every 5 years rather than the standard 10-year average-risk interval.",
      "links": [
        {
          "label": "Colonoscopy Risk Documentation Checklist",
          "url": "http://localhost:8080/questionnaires/colonoscopy-risk",
          "type": "absolute"
        }
      ]
    }
  ]
}
```

### 7.3 `fixtures/cards-missing-documentation.json` [CREATE]

```json
{
  "cards": [
    {
      "summary": "Documentation required: high-risk classification not confirmed",
      "indicator": "warning",
      "source": {
        "label": "Demo Payer CRD Service",
        "url": "http://localhost:8080"
      },
      "detail": "## Documentation Required\n\nA **5-year colonoscopy interval** requires documented high-risk criteria. No qualifying family history condition **(Z80.0 — Family history of malignant neoplasm of digestive organs)** was found in the submitted clinical context.\n\n### What this means\n\n- Without high-risk documentation, this order may be subject to the **standard 10-year average-risk interval** rules\n- If the patient has a qualifying family history, add the ICD-10-CM Z80.0 condition to the problem list before signing\n- Orders submitted without supporting documentation may require prior authorization\n\n### Action required\n\nAttach supporting documentation confirming high-risk classification before submitting this order.",
      "links": [
        {
          "label": "Colonoscopy Risk Documentation Checklist",
          "url": "http://localhost:8080/questionnaires/colonoscopy-risk",
          "type": "absolute"
        }
      ]
    }
  ]
}
```

---

## Section 8 — Card Factory [CREATE]

### 8.1 Purpose and Design

The card factory is the bridge between the rule engine and the HTTP response. It takes a `RuleResult` and returns the `CdsCard[]` array that the route handler will wrap in `{ "cards": [...] }` and send back to the EHR.

Keeping this logic in its own module keeps the route handler thin and makes card construction independently testable. The factory reads fixture files for the two static scenarios, and builds a card inline for the dynamic `interval-not-met` scenario.

The function is `async` because reading fixture files with `Bun.file().json()` is an asynchronous operation.

### 8.2 Create `src/cards/` directory

The `src/cards/` directory does not yet exist. Create it:

```bash
mkdir -p payer-crd/src/cards
```

### 8.3 Full Implementation: `src/cards/cardFactory.ts` [CREATE]

```typescript
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
```

---

## Section 9 — CRD Route Handler [CREATE]

### 9.1 Processing Pipeline

When the EHR POSTs to `/cds-services/crd-order-sign`, the route handler performs these steps in order:

```
1. Parse the JSON request body → CdsHooksRequest
2. Validate required fields (hook, context)
3. Extract FHIR resources from prefetch
      patient        ← body.prefetch?.patient
      conditions[]   ← unwrap bundle entries
      procedures[]   ← unwrap bundle entries
      coverage       ← body.prefetch?.coverage
4. Call evaluate() → RuleResult
5. Call buildCardsForOutcome() → CdsCard[]
6. Return HTTP 200: { "cards": [...] }
```

**Bundle entry unwrapping** (step 3) is the most important detail. Conditions and procedures arrive as FHIR Bundles — containers holding multiple resources. Each bundle has an `entry` array where each element looks like:

```json
{ "resource": { "resourceType": "Condition", ... } }
```

To get a flat array of `FhirCondition` objects the route handler maps over the entries and extracts `.resource`:

```typescript
const conditions = body.prefetch?.conditions?.entry?.map(
  (e) => e.resource as FhirCondition
) ?? [];
```

The `as FhirCondition` is a type assertion — it tells TypeScript "trust me, this `Record<string, unknown>` is actually a `FhirCondition`." This is necessary because `FhirBundleEntry.resource` is typed loosely on purpose (a Bundle can hold any resource type). The assertion is safe here because we know the EHR sends conditions in the `conditions` prefetch key.

The `?? []` at the end is the nullish coalescing operator: if the left side is `null` or `undefined` (e.g., the prefetch key was missing), use `[]` as the fallback. This ensures the rule engine always receives an array, never `undefined`.

### 9.2 Create `src/routes/crd.ts` [CREATE]

```typescript
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
```

### 9.3 Update `src/index.ts` [UPDATE]

Add the import and route registration for the CRD handler. Replace the contents of `src/index.ts` with:

```typescript
// Application entrypoint: creates the Hono app, registers routes,
// and starts the server with Bun.serve().
//
// Routes:
//   GET  /cds-services                —> src/routes/discovery.ts
//   POST /cds-services/crd-order-sign —> src/routes/crd.ts

import { Hono } from 'hono';
import { discoveryHandler } from './routes/discovery.js';
import { crdHandler } from './routes/crd.js';

const app = new Hono();

app.get('/cds-services', discoveryHandler);
app.post('/cds-services/crd-order-sign', crdHandler);

const port = Number(Bun.env.PORT) || 8080;

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Payer CRD listening on port ${port}`);
```

### 9.4 Verify the CRD Endpoint

Start the service:

```bash
bun run dev
```

Each test is shown in two forms. The **response body** form pretty-prints the JSON returned by the server. The **response metadata** form suppresses the body and prints only the HTTP status code and Content-Type header — useful for confirming the response code without scrolling through JSON.

**curl flags used:**
- `-s` — silent mode; suppresses curl's progress output
- `-o /dev/null` — discards the response body (metadata form only)
- `-w "..."` — prints a formatted string using curl variables after the request completes (metadata form only)

---

**Test 1 — High-risk scenario** (Z80.0 present, prior procedure 6 years ago):

Response body:
```bash
curl -s -X POST http://localhost:8080/cds-services/crd-order-sign \
  -H 'Content-Type: application/json' \
  -d '{
    "hook": "order-sign",
    "hookInstance": "test-001",
    "context": {
      "userId": "PractitionerRole/demo-clinician",
      "patientId": "demo-patient-001",
      "draftOrders": { "resourceType": "Bundle", "type": "collection", "entry": [] }
    },
    "prefetch": {
      "patient": { "resourceType": "Patient", "id": "demo-patient-001", "birthDate": "1971-01-15" },
      "conditions": {
        "resourceType": "Bundle", "type": "searchset", "entry": [
          { "resource": { "resourceType": "Condition", "id": "c1",
            "code": { "coding": [{ "system": "http://hl7.org/fhir/sid/icd-10-cm", "code": "Z80.0" }] }
          }}
        ]
      },
      "priorProcedures": {
        "resourceType": "Bundle", "type": "searchset", "entry": [
          { "resource": { "resourceType": "Procedure", "id": "p1", "status": "completed",
            "code": { "coding": [{ "system": "http://www.ama-assn.org/go/cpt", "code": "45378" }] },
            "performedDateTime": "2019-01-15"
          }}
        ]
      },
      "coverage": { "resourceType": "Coverage", "id": "cov1", "status": "active" }
    }
  }' | python3 -m json.tool
```

Response metadata:
```bash
curl -s -o /dev/null \
  -w "HTTP/%{http_version} %{response_code}\nContent-Type: %{content_type}\n" \
  -X POST http://localhost:8080/cds-services/crd-order-sign \
  -H 'Content-Type: application/json' \
  -d '{
    "hook": "order-sign",
    "hookInstance": "test-001",
    "context": {
      "userId": "PractitionerRole/demo-clinician",
      "patientId": "demo-patient-001",
      "draftOrders": { "resourceType": "Bundle", "type": "collection", "entry": [] }
    },
    "prefetch": {
      "patient": { "resourceType": "Patient", "id": "demo-patient-001", "birthDate": "1971-01-15" },
      "conditions": {
        "resourceType": "Bundle", "type": "searchset", "entry": [
          { "resource": { "resourceType": "Condition", "id": "c1",
            "code": { "coding": [{ "system": "http://hl7.org/fhir/sid/icd-10-cm", "code": "Z80.0" }] }
          }}
        ]
      },
      "priorProcedures": {
        "resourceType": "Bundle", "type": "searchset", "entry": [
          { "resource": { "resourceType": "Procedure", "id": "p1", "status": "completed",
            "code": { "coding": [{ "system": "http://www.ama-assn.org/go/cpt", "code": "45378" }] },
            "performedDateTime": "2019-01-15"
          }}
        ]
      },
      "coverage": { "resourceType": "Coverage", "id": "cov1", "status": "active" }
    }
  }'
```

Expected: `HTTP/1.1 200` with `cards[0].indicator === "info"`.

---

**Test 2 — Missing-documentation scenario** (no Z80.0 condition present):

Response body:
```bash
curl -s -X POST http://localhost:8080/cds-services/crd-order-sign \
  -H 'Content-Type: application/json' \
  -d '{
    "hook": "order-sign",
    "hookInstance": "test-002",
    "context": {
      "userId": "PractitionerRole/demo-clinician",
      "patientId": "demo-patient-001",
      "draftOrders": { "resourceType": "Bundle", "type": "collection", "entry": [] }
    },
    "prefetch": {
      "patient": { "resourceType": "Patient", "id": "demo-patient-001", "birthDate": "1971-01-15" },
      "conditions": { "resourceType": "Bundle", "type": "searchset", "entry": [] },
      "priorProcedures": { "resourceType": "Bundle", "type": "searchset", "entry": [] },
      "coverage": { "resourceType": "Coverage", "id": "cov1", "status": "active" }
    }
  }' | python3 -m json.tool
```

Response metadata:
```bash
curl -s -o /dev/null \
  -w "HTTP/%{http_version} %{response_code}\nContent-Type: %{content_type}\n" \
  -X POST http://localhost:8080/cds-services/crd-order-sign \
  -H 'Content-Type: application/json' \
  -d '{
    "hook": "order-sign",
    "hookInstance": "test-002",
    "context": {
      "userId": "PractitionerRole/demo-clinician",
      "patientId": "demo-patient-001",
      "draftOrders": { "resourceType": "Bundle", "type": "collection", "entry": [] }
    },
    "prefetch": {
      "patient": { "resourceType": "Patient", "id": "demo-patient-001", "birthDate": "1971-01-15" },
      "conditions": { "resourceType": "Bundle", "type": "searchset", "entry": [] },
      "priorProcedures": { "resourceType": "Bundle", "type": "searchset", "entry": [] },
      "coverage": { "resourceType": "Coverage", "id": "cov1", "status": "active" }
    }
  }'
```

Expected: `HTTP/1.1 200` with `cards[0].indicator === "warning"`.

---

**Test 3 — Validation scenario** (missing `hook` field):

Response body:
```bash
curl -s -X POST http://localhost:8080/cds-services/crd-order-sign \
  -H 'Content-Type: application/json' \
  -d '{ "context": { "userId": "x", "patientId": "y", "draftOrders": { "resourceType": "Bundle", "type": "collection", "entry": [] } } }' \
  | python3 -m json.tool
```

Response metadata:
```bash
curl -s -o /dev/null \
  -w "HTTP/%{http_version} %{response_code}\nContent-Type: %{content_type}\n" \
  -X POST http://localhost:8080/cds-services/crd-order-sign \
  -H 'Content-Type: application/json' \
  -d '{ "context": { "userId": "x", "patientId": "y", "draftOrders": { "resourceType": "Bundle", "type": "collection", "entry": [] } } }'
```

Expected: `HTTP/1.1 400`.

Expected: `HTTP/1.1 400 Bad Request`.

---

<br><br><br><br><br><br><br><br><br><br>
<br><br><br><br><br><br><br><br><br><br>
<br><br><br><br><br><br><br><br><br><br>
<br><br><br><br>

## Section 10 — Testing

### 10.1 How `bun test` Works

`bun test` is Bun's built-in test runner. It uses a Jest-compatible API, which means the same function names and assertion syntax as Jest — familiar if you have used any JavaScript testing library.

**Core functions:**

| Function | Purpose | pytest equivalent |
|----------|---------|-------------------|
| `describe('label', fn)` | Groups related tests | a test class |
| `test('label', fn)` | A single test case | a `test_` function |
| `expect(value)` | Creates an assertion | `assert` |
| `beforeEach(fn)` | Runs before every test in the describe block | a fixture with `autouse=True` |

**Common matchers** (chained after `expect(value)`):

| Matcher | Meaning |
|---------|---------|
| `.toBe(x)` | Strict equality (`===`) |
| `.toEqual(x)` | Deep equality (compares object contents) |
| `.toBeTruthy()` | Value is truthy |
| `.toBeNull()` | Value is `null` |
| `.toBeGreaterThanOrEqual(n)` | Numeric ≥ |
| `.toHaveProperty('key')` | Object has the property |
| `.toContain(x)` | Array includes x, or string contains x |
| `.toBeInstanceOf(Class)` | Value is an instance of Class |

**Imports:** Always import from `'bun:test'`:

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';
```

**Running tests:**

```bash
# All tests
bun test

# A single file
bun test tests/rules/colonoscopyRuleEngine.test.ts

# With verbose output (shows each test name)
bun test --verbose
```

`bun test` automatically discovers files matching `*.test.ts` anywhere in the
project.

### 10.2 Create `tests/` directory structure

```bash
mkdir -p payer-crd/tests/rules
mkdir -p payer-crd/tests/routes
```

### 10.3 `tests/rules/colonoscopyRuleEngine.test.ts` [CREATE]

These are pure unit tests. No HTTP server is started; no files are read. Each test passes plain TypeScript objects to the exported helper functions and checks their return values.

```typescript
// Unit tests for src/rules/colonoscopyRuleEngine.ts
// Run with: bun test tests/rules/colonoscopyRuleEngine.test.ts

import { describe, test, expect } from 'bun:test';
import {
  hasHighRiskCondition,
  calculateAge,
  findMostRecentProcedure,
  yearsSince,
  evaluate,
} from '../../src/rules/colonoscopyRuleEngine.js';
import type { FhirCondition, FhirProcedure, FhirPatient } from '../../src/types/cdsHooks.js';

// -- Test data factories --------------------------------------------------
// Small helper functions that build the minimal FHIR objects needed for each
// test. Keeping construction here avoids duplicating object literals across
// multiple tests.

function makeIcd10Condition(code: string): FhirCondition {
  return {
    resourceType: 'Condition',
    id: `condition-${code}`,
    code: {
      coding: [
        {
          system: 'http://hl7.org/fhir/sid/icd-10-cm',
          code,
          display: `Test condition ${code}`,
        },
      ],
    },
  };
}

function makeCptProcedure(cptCode: string, performedDateTime: string): FhirProcedure {
  return {
    resourceType: 'Procedure',
    id: `procedure-${cptCode}`,
    status: 'completed',
    code: {
      coding: [
        {
          system: 'http://www.ama-assn.org/go/cpt',
          code: cptCode,
        },
      ],
    },
    performedDateTime,
  };
}

// Builds an ISO 8601 date string for N years ago from today.
function yearsAgoDate(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split('T')[0]!;
}

// -- hasHighRiskCondition -------------------------------------------------

describe('hasHighRiskCondition', () => {
  test('returns true when Z80.0 is present', () => {
    expect(hasHighRiskCondition([makeIcd10Condition('Z80.0')])).toBe(true);
  });

  test('returns false when only non-matching codes are present', () => {
    expect(hasHighRiskCondition([makeIcd10Condition('Z12.11')])).toBe(false);
  });

  test('returns true when Z80.0 is among multiple conditions', () => {
    const conditions = [
      makeIcd10Condition('E11.9'),  // type 2 diabetes
      makeIcd10Condition('Z80.0'),  // family history CRC
    ];
    expect(hasHighRiskCondition(conditions)).toBe(true);
  });

  test('returns false for an empty conditions array', () => {
    expect(hasHighRiskCondition([])).toBe(false);
  });
});

// -- calculateAge ---------------------------------------------------------

describe('calculateAge', () => {
  test('returns correct age for a birthday that has passed this year', () => {
    // Build a birthdate 30 years ago minus 1 day — birthday has passed.
    const past = new Date();
    past.setFullYear(past.getFullYear() - 30);
    past.setDate(past.getDate() - 1);
    const birthDate = past.toISOString().split('T')[0]!;
    expect(calculateAge(birthDate)).toBe(30);
  });

  test('returns age - 1 for a birthday that has not yet occurred this year', () => {
    // Build a birthdate 30 years ago plus 1 day — birthday has not passed yet.
    const future = new Date();
    future.setFullYear(future.getFullYear() - 30);
    future.setDate(future.getDate() + 1);
    const birthDate = future.toISOString().split('T')[0]!;
    expect(calculateAge(birthDate)).toBe(29);
  });
});

// -- findMostRecentProcedure ----------------------------------------------

describe('findMostRecentProcedure', () => {
  test('returns the most recent procedure when multiple exist', () => {
    const procedures = [
      makeCptProcedure('45378', '2015-03-01'),
      makeCptProcedure('45378', '2020-11-15'),
      makeCptProcedure('45378', '2018-06-01'),
    ];
    const result = findMostRecentProcedure(procedures, '45378');
    expect(result?.performedDateTime).toBe('2020-11-15');
  });

  test('returns null when no procedures match the CPT code', () => {
    const procedures = [makeCptProcedure('99213', '2020-01-01')];
    expect(findMostRecentProcedure(procedures, '45378')).toBeNull();
  });

  test('returns null for an empty procedures array', () => {
    expect(findMostRecentProcedure([], '45378')).toBeNull();
  });

  test('returns the single procedure when only one exists', () => {
    const procedures = [makeCptProcedure('45378', '2021-05-10')];
    const result = findMostRecentProcedure(procedures, '45378');
    expect(result?.performedDateTime).toBe('2021-05-10');
  });
});

// -- yearsSince -----------------------------------------------------------

describe('yearsSince', () => {
  test('returns approximately 1.0 for a date one year ago', () => {
    const oneYearAgo = yearsAgoDate(1);
    const result = yearsSince(oneYearAgo);
    // Allow a small tolerance window for test execution timing.
    expect(result).toBeGreaterThanOrEqual(0.99);
    expect(result).toBeLessThanOrEqual(1.01);
  });

  test('returns approximately 5.0 for a date five years ago', () => {
    const fiveYearsAgo = yearsAgoDate(5);
    const result = yearsSince(fiveYearsAgo);
    expect(result).toBeGreaterThanOrEqual(4.99);
    expect(result).toBeLessThanOrEqual(5.01);
  });
});

// -- evaluate -------------------------------------------------------------

describe('evaluate', () => {
  const demoPatient: FhirPatient = {
    resourceType: 'Patient',
    id: 'demo-patient-001',
    birthDate: '1971-01-15',
  };

  test('returns covered-high-risk when Z80.0 present and interval met', () => {
    // Prior procedure 6 years ago satisfies the 5-year high-risk interval.
    const result = evaluate(
      demoPatient,
      [makeIcd10Condition('Z80.0')],
      [makeCptProcedure('45378', yearsAgoDate(6))],
      undefined
    );
    expect(result.outcome).toBe('covered-high-risk');
    expect(result.highRiskIndicator).toBe(true);
    expect(result.meetsIntervalRequirement).toBe(true);
  });

  test('returns missing-documentation when Z80.0 is absent', () => {
    const result = evaluate(
      demoPatient,
      [makeIcd10Condition('E11.9')],   // diabetes, not a high-risk CRC code
      [makeCptProcedure('45378', yearsAgoDate(6))],
      undefined
    );
    expect(result.outcome).toBe('missing-documentation');
    expect(result.highRiskIndicator).toBe(false);
  });

  test('returns interval-not-met when high-risk but prior procedure too recent', () => {
    // Prior procedure 2 years ago does NOT satisfy the 5-year interval.
    const result = evaluate(
      demoPatient,
      [makeIcd10Condition('Z80.0')],
      [makeCptProcedure('45378', yearsAgoDate(2))],
      undefined
    );
    expect(result.outcome).toBe('interval-not-met');
    expect(result.highRiskIndicator).toBe(true);
    expect(result.meetsIntervalRequirement).toBe(false);
  });

  test('meetsIntervalRequirement is true when no prior procedure exists', () => {
    // No prior colonoscopy on record — first-time screening is always covered.
    const result = evaluate(
      demoPatient,
      [makeIcd10Condition('Z80.0')],
      [],    // empty procedures array
      undefined
    );
    expect(result.meetsIntervalRequirement).toBe(true);
    expect(result.yearsSincePriorProcedure).toBeNull();
  });

  test('patientAge is null when patient is undefined', () => {
    const result = evaluate(undefined, [], [], undefined);
    expect(result.patientAge).toBeNull();
  });
});
```

### 10.4 `tests/routes/discovery.test.ts` [CREATE]

Route tests use Hono's `app.request()` method to call route handlers without
starting a real HTTP server. The call signature is:

```typescript
app.request(path, requestInit?)
```

Where `requestInit` is the same options object as the browser's `fetch()`.
The returned value is a standard `Response` object.

```typescript
// Integration tests for GET /cds-services
// Run with: bun test tests/routes/discovery.test.ts

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { discoveryHandler } from '../../src/routes/discovery.js';

// Create a minimal Hono app with only the discovery route registered.
// This is the same setup as index.ts but isolated for testing.
const app = new Hono();
app.get('/cds-services', discoveryHandler);

describe('GET /cds-services', () => {
  test('returns HTTP 200', async () => {
    const res = await app.request('/cds-services');
    expect(res.status).toBe(200);
  });

  test('Content-Type is application/json', async () => {
    const res = await app.request('/cds-services');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  test('response body has a services array', async () => {
    const res = await app.request('/cds-services');
    const body = await res.json() as { services: unknown[] };
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.services.length).toBeGreaterThan(0);
  });

  test('services[0].hook is order-sign', async () => {
    const res = await app.request('/cds-services');
    const body = await res.json() as { services: Array<{ hook: string }> };
    expect(body.services[0]?.hook).toBe('order-sign');
  });

  test('services[0].id is crd-order-sign', async () => {
    const res = await app.request('/cds-services');
    const body = await res.json() as { services: Array<{ id: string }> };
    expect(body.services[0]?.id).toBe('crd-order-sign');
  });

  test('prefetch declares all four required keys', async () => {
    const res = await app.request('/cds-services');
    const body = await res.json() as {
      services: Array<{ prefetch: Record<string, unknown> }>
    };
    const prefetch = body.services[0]?.prefetch ?? {};
    expect(prefetch).toHaveProperty('patient');
    expect(prefetch).toHaveProperty('conditions');
    expect(prefetch).toHaveProperty('coverage');
    expect(prefetch).toHaveProperty('priorProcedures');
  });
});
```

### 10.5 `tests/routes/crd.test.ts` [CREATE]

```typescript
// Integration tests for POST /cds-services/crd-order-sign
// Run with: bun test tests/routes/crd.test.ts

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { crdHandler } from '../../src/routes/crd.js';
import type { CdsHooksRequest } from '../../src/types/cdsHooks.js';

const app = new Hono();
app.post('/cds-services/crd-order-sign', crdHandler);

// -- Test data factory ----------------------------------------------------

// Builds a date string N years ago from today.
function yearsAgoDate(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split('T')[0]!;
}

// Builds a complete, valid CDS Hooks order-sign request body.
// Optional overrides allow individual tests to mutate specific fields
// without duplicating the entire object.
function makeValidRequest(
  overrides: Partial<CdsHooksRequest> = {}
): CdsHooksRequest {
  return {
    hook: 'order-sign',
    hookInstance: '00000000-0000-0000-0000-000000000001',
    fhirServer: 'http://localhost:8000/fhir',
    context: {
      userId: 'PractitionerRole/demo-clinician',
      patientId: 'demo-patient-001',
      encounterId: 'demo-encounter-001',
      draftOrders: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [],
      },
    },
    prefetch: {
      patient: {
        resourceType: 'Patient',
        id: 'demo-patient-001',
        birthDate: '1971-01-15',
        gender: 'male',
        name: [{ family: 'Doe', given: ['John'] }],
      },
      // High-risk condition: Z80.0 family history of colorectal cancer.
      conditions: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [
          {
            resource: {
              resourceType: 'Condition',
              id: 'demo-condition-z80',
              code: {
                coding: [
                  {
                    system: 'http://hl7.org/fhir/sid/icd-10-cm',
                    code: 'Z80.0',
                    display: 'Family history of malignant neoplasm of digestive organs',
                  },
                ],
              },
            },
          },
        ],
      },
      // Prior colonoscopy 6 years ago — satisfies the 5-year high-risk interval.
      priorProcedures: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [
          {
            resource: {
              resourceType: 'Procedure',
              id: 'demo-prior-colonoscopy',
              status: 'completed',
              code: {
                coding: [
                  {
                    system: 'http://www.ama-assn.org/go/cpt',
                    code: '45378',
                    display: 'Colonoscopy, flexible',
                  },
                ],
              },
              performedDateTime: yearsAgoDate(6),
            },
          },
        ],
      },
      coverage: {
        resourceType: 'Coverage',
        id: 'demo-coverage-001',
        status: 'active',
      },
    },
    ...overrides,
  };
}

// Sends a POST request to the test app and returns the Response.
async function postRequest(body: unknown): Promise<Response> {
  return app.request('/cds-services/crd-order-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// -- Tests ----------------------------------------------------------------

describe('POST /cds-services/crd-order-sign — success paths', () => {
  test('returns HTTP 200 for a valid high-risk request', async () => {
    const res = await postRequest(makeValidRequest());
    expect(res.status).toBe(200);
  });

  test('response body has a cards array', async () => {
    const res = await postRequest(makeValidRequest());
    const body = await res.json() as { cards: unknown[] };
    expect(Array.isArray(body.cards)).toBe(true);
  });

  test('high-risk path returns an info card', async () => {
    const res = await postRequest(makeValidRequest());
    const body = await res.json() as { cards: Array<{ indicator: string }> };
    expect(body.cards[0]?.indicator).toBe('info');
  });

  test('missing-documentation path returns a warning card', async () => {
    // Override conditions to an empty bundle — no Z80.0 code present.
    const request = makeValidRequest();
    request.prefetch!.conditions = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 0,
      entry: [],
    };
    const res = await postRequest(request);
    const body = await res.json() as { cards: Array<{ indicator: string }> };
    expect(body.cards[0]?.indicator).toBe('warning');
  });

  test('interval-not-met path returns a warning card', async () => {
    // Z80.0 present but prior procedure only 2 years ago.
    const request = makeValidRequest();
    request.prefetch!.priorProcedures = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [
        {
          resource: {
            resourceType: 'Procedure',
            id: 'recent-colonoscopy',
            status: 'completed',
            code: {
              coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '45378' }],
            },
            performedDateTime: yearsAgoDate(2),
          },
        },
      ],
    };
    const res = await postRequest(request);
    const body = await res.json() as { cards: Array<{ indicator: string }> };
    expect(body.cards[0]?.indicator).toBe('warning');
  });
});

describe('POST /cds-services/crd-order-sign — validation', () => {
  test('returns 400 when hook field is missing', async () => {
    const { hook, ...bodyWithoutHook } = makeValidRequest();
    const res = await postRequest(bodyWithoutHook);
    expect(res.status).toBe(400);
  });

  test('returns 400 when hook is not order-sign', async () => {
    const res = await postRequest(makeValidRequest({ hook: 'patient-view' }));
    expect(res.status).toBe(400);
  });

  test('returns 400 when context is missing', async () => {
    const { context, ...bodyWithoutContext } = makeValidRequest();
    const res = await postRequest(bodyWithoutContext);
    expect(res.status).toBe(400);
  });

  test('returns 400 for malformed JSON', async () => {
    const res = await app.request('/cds-services/crd-order-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not valid json',
    });
    expect(res.status).toBe(400);
  });
});
```

### 10.6 Run the Full Test Suite

```bash
bun test
```

All tests should pass. To see each test name as it runs:

```bash
bun test --verbose
```

To run a single file while debugging:

```bash
bun test tests/rules/colonoscopyRuleEngine.test.ts --verbose
```

---

## Section 11 — End-to-End Verification

### 11.1 Start Both Services

Open two terminal windows.

**Terminal 1 — Payer CRD Service:**

```bash
cd payer-crd
bun run dev
```

Expected output: `Payer CRD listening on port 8080`

**Terminal 2 — Provider EHR:**

```bash
cd provider-ehr
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Expected output: `Uvicorn running on http://127.0.0.1:8000`

### 11.2 Browser Test

Open `http://localhost:8000` in a browser. Navigate to the demo patient's
chart. Click **Check Coverage Requirements**.

Expected behavior:
- The "Checking coverage requirements…" spinner appears briefly
- CDS Cards render in the panel below the button
- The card's indicator color and summary text reflect the high-risk covered scenario (the demo patient has Z80.0 and a prior procedure 5 years ago)

### 11.3 Trigger via curl

Alternatively, trigger the CRD exchange from the command line without a browser:

```bash
curl -X POST http://localhost:8000/orders/colonoscopy/crd
```

This calls the Python EHR's trigger endpoint, which assembles the FHIR context and sends the CDS Hooks request to the Bun payer. The response is the HTML fragment that would normally be injected into the browser page.

### 11.4 Final Checklist

Before considering Phase 1 complete, verify each item:

- [ ] `GET /cds-services` returns HTTP 200 with the `crd-order-sign` service listed
- [ ] `POST /cds-services/crd-order-sign` with Z80.0 + 6-year-old procedure returns an `info` card
- [ ] `POST /cds-services/crd-order-sign` without Z80.0 returns a `warning` card
- [ ] `POST /cds-services/crd-order-sign` with Z80.0 + 2-year-old procedure returns a `warning` card
- [ ] Missing or wrong `hook` returns HTTP 400
- [ ] Missing `context` returns HTTP 400
- [ ] Unknown paths return HTTP 404
- [ ] `bun test` passes all tests
- [ ] Clicking "Check Coverage Requirements" in the browser renders CDS Cards
